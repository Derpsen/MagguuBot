/**
 * Declarative role plan + planner for discord-roles-apply. Pure: snapshot + plan + bot references in, steps/skips/
 * violations out. Every candidate change is accepted only if the SIMULATED result still satisfies all hard gates;
 * otherwise it is listed under "nicht ausgeführt" with its category instead of being run.
 */
import { z } from 'zod';
import {
  ARCHIVE_CATEGORY_NAME, ROLES, STRUCTURE, roleNameCandidates, STAFF_ROLE_NAMES,
} from '../discord/server-layout.js';
import {
  applyEffect, checkInvariants, guardedUsers, memberLoss, protectedRoleIds, type Effect, type InvariantContext, type Step,
} from './roles-effects.js';
import {
  BOT_CHANNEL_ALLOW, CATEGORY_TYPE, EVERYONE_REMOVABLE, P, cloneSnapshot, memberCounts, membersOf, overwriteTargetsUsed, parsePermNames, permNames,
  type ChannelRec, type PermName, type RoleRec, type RolesSnapshot,
} from './roles-model.js';
import type { RoleRefs } from './roles-refs.js';

export const DEFAULT_MAX_MEMBERS = 25;

/** Dangerous bits removed from @everyone by the default plan. CREATE_INSTANT_INVITE is a proposal, not default. */
export const DEFAULT_EVERYONE_REMOVE: readonly PermName[] = [
  'ADMINISTRATOR', 'MENTION_EVERYONE', 'MANAGE_GUILD', 'MANAGE_ROLES', 'MANAGE_CHANNELS', 'MANAGE_WEBHOOKS', 'KICK_MEMBERS',
  'BAN_MEMBERS', 'MANAGE_MESSAGES', 'MODERATE_MEMBERS', 'MANAGE_NICKNAMES', 'MANAGE_GUILD_EXPRESSIONS', 'VIEW_AUDIT_LOG',
  'MANAGE_THREADS', 'MANAGE_EVENTS',
];

const decimal = z.string().regex(/^\d+$/, 'Berechtigungen als Dezimalzahl (String)');

export const rolesPlanSchema = z.object({
  version: z.literal(1),
  everyone: z.object({ remove: z.array(z.string()).default([]) }).default({ remove: [] }),
  roles: z.array(z.object({
    name: z.string().min(1),
    oldNames: z.array(z.string()).optional(),
    permissions: decimal.optional(),
    mentionable: z.boolean().optional(),
    hoist: z.boolean().optional(),
  })).default([]),
  merge: z.array(z.object({
    from: z.string().min(1),
    into: z.string().min(1),
    maxMembers: z.number().int().min(0).max(1000).optional(),
    keepSource: z.boolean().optional(),
  })).default([]),
  delete: z.array(z.string().min(1)).default([]),
  visibility: z.object({
    staffRoles: z.array(z.string().min(1)).min(1),
    staffOnlyChannels: z.array(z.string()).default([]),
    staffOnlyCategories: z.array(z.string()).default([]),
  }),
  maxMembers: z.number().int().min(0).max(1000).default(DEFAULT_MAX_MEMBERS),
}).strict();

export type RolesPlan = z.infer<typeof rolesPlanSchema>;

/** Parse + validate a plan file; @everyone removals are limited to the whitelist of dangerous bits (+ invites). */
export function parseRolesPlan(text: string): RolesPlan {
  const plan = rolesPlanSchema.parse(JSON.parse(text));
  for (const n of plan.everyone.remove) {
    if (!EVERYONE_REMOVABLE.has(n as PermName)) throw new Error(`@everyone: „${n}“ darf das Werkzeug nicht entziehen (erlaubt: ${[...EVERYONE_REMOVABLE].join(', ')})`);
  }
  parsePermNames(plan.everyone.remove);
  return plan;
}

/** The plan implied by the server layout (src/discord/server-layout.ts) – `--print-plan` shows it as JSON. */
export function defaultRolesPlan(): RolesPlan {
  const staffOnlyChannels = STRUCTURE.flatMap((c) => c.channels).filter((c) => c.adminOnly).map((c) => c.name);
  return {
    version: 1,
    everyone: { remove: [...DEFAULT_EVERYONE_REMOVE] },
    roles: ROLES.map((r) => ({
      name: r.name,
      ...(r.oldNames ? { oldNames: [...r.oldNames] } : {}),
      permissions: r.permissions,
      mentionable: r.mentionable ?? false,
    })),
    merge: ROLES.flatMap((r) => (r.mergeFrom ?? []).map((from) => ({ from, into: r.name }))),
    delete: [],
    visibility: { staffRoles: [...STAFF_ROLE_NAMES], staffOnlyChannels, staffOnlyCategories: [] },
    maxMembers: DEFAULT_MAX_MEMBERS,
  };
}

// ─── Result types ─────────────────────────────────────────────────────────
export type SkipCategory =
  | 'managed' | 'über-bot-rolle' | 'geschützt' | 'referenziert' | 'mitglieder-limit' | 'nicht-leer' | 'in-benutzung'
  | 'rechteverlust' | 'zugriff' | 'nicht-gefunden' | 'mitglieder-unbekannt' | 'ziel-fehlt' | 'name-belegt';

export interface Skip { category: SkipCategory; label: string; reason: string; count?: number }

export interface ApplyPlan {
  steps: Step[];
  skipped: Skip[];
  /** Hard-gate violations: any entry blocks --execute. */
  violations: string[];
  /** Counters for the summary line. */
  counters: Record<string, number>;
  after: RolesSnapshot;
  guardedCount: number;
}

export interface PlanOptions {
  /** Merge limit when the plan entry has none (default 25). */
  maxMembers?: number;
  /** Extra protected users (ADMIN_USER_IDS). Never printed. */
  protectedUserIds?: readonly string[];
}

const PHASE = { memberAdd: 0, allowOverwrite: 1, roleUpdate: 2, denyOverwrite: 3, everyone: 4, roleDelete: 5 } as const;

const findRole = (snap: RolesSnapshot, name: string): RoleRec | undefined => snap.roles.find((r) => r.name === name && !r.managed && r.id !== snap.guildId);

export function planRolesApply(snap: RolesSnapshot, plan: RolesPlan, refs: RoleRefs, opts: PlanOptions = {}): ApplyPlan {
  const cur = cloneSnapshot(snap);
  const steps: Step[] = [];
  const skipped: Skip[] = [];
  const violations: string[] = [];
  const counters: Record<string, number> = { rollenAktualisiert: 0, zusammengelegt: 0, mitgliederUmgehängt: 0, gelöscht: 0, kanäleSichtbarkeit: 0, everyone: 0 };
  const protectedUsers = opts.protectedUserIds ?? [];
  const guarded = guardedUsers(snap, plan.visibility.staffRoles, protectedUsers);
  const protectedRoles = protectedRoleIds(snap, protectedUsers);
  const staffIds = new Set(snap.roles.filter((r) => plan.visibility.staffRoles.includes(r.name) && !r.managed).map((r) => r.id));
  for (const id of staffIds) protectedRoles.add(id);
  const ctx: InvariantContext = { guardedUserIds: guarded, postingChannelIds: refs.channelIds };
  const counts = memberCounts(snap);

  if (snap.missingKnownChannels) violations.push(`${snap.missingKnownChannels} Kanal-ID(s) aus der Bot-Datenbank fehlen in der Kanalliste (Discord-Änderung 2026-11-16 oder gelöscht): Bild unvollständig – mit --allow-missing-channels bewusst bestätigen`);
  if (!snap.members) violations.push('Mitgliederliste nicht lesbar: nichts ausführbar');
  if (!snap.ownerId) violations.push('Server-Owner nicht lesbar');
  if (!snap.members?.[snap.botUserId]) violations.push('Bot-Mitglied nicht gefunden');
  const staffMissing = plan.visibility.staffRoles.filter((n) => !findRole(snap, n));
  if (staffMissing.length === plan.visibility.staffRoles.length) violations.push('Keine der Staff-Rollen existiert live: Sichtbarkeit kann nicht sicher gesetzt werden');

  const accept = (effects: Step[]): boolean => {
    for (const s of effects) applyEffect(cur, s.effect);
    steps.push(...effects);
    return true;
  };
  const trial = (effects: Step[]): RolesSnapshot => {
    const t = cloneSnapshot(cur);
    for (const s of effects) applyEffect(t, s.effect);
    return t;
  };
  const roleGate = (r: RoleRec, label: string): Skip | null => {
    if (r.managed) return { category: 'managed', label, reason: 'Integrations-/Bot-Rolle (managed) wird nie angefasst' };
    if (r.position >= snap.botHighestRolePosition) return { category: 'über-bot-rolle', label, reason: `Position ${r.position} ≥ Bot-Rolle ${snap.botHighestRolePosition}` };
    return null;
  };

  // 1. role updates (rename / permissions / mentionable / hoist)
  const claimed = new Set<string>();
  for (const pr of plan.roles) {
    const live = findRole(cur, pr.name) ?? (pr.oldNames ?? []).map((n) => findRole(cur, n)).find((r): r is RoleRec => Boolean(r) && !claimed.has((r as RoleRec).id));
    if (!live) { skipped.push({ category: 'nicht-gefunden', label: pr.name, reason: 'Rolle existiert live nicht (legt discord-rollout --apply an)' }); continue; }
    claimed.add(live.id);
    const changes: Effect & { t: 'roleUpdate' } = { t: 'roleUpdate', id: live.id, changes: {} };
    if (live.name !== pr.name) {
      if (cur.roles.some((r) => r.name === pr.name && r.id !== live.id)) { skipped.push({ category: 'name-belegt', label: live.name, reason: `Zielname „${pr.name}“ ist schon vergeben` }); continue; }
      changes.changes.name = pr.name;
    }
    if (pr.permissions !== undefined && BigInt(live.permissions) !== BigInt(pr.permissions)) changes.changes.permissions = pr.permissions;
    if (pr.mentionable !== undefined && live.mentionable !== pr.mentionable) changes.changes.mentionable = pr.mentionable;
    if (pr.hoist !== undefined && live.hoist !== pr.hoist) changes.changes.hoist = pr.hoist;
    if (!Object.keys(changes.changes).length) continue;
    const gate = roleGate(live, live.name);
    if (gate) { skipped.push(gate); continue; }
    if (changes.changes.permissions !== undefined && protectedRoles.has(live.id) && (BigInt(live.permissions) & ~BigInt(changes.changes.permissions)) !== 0n) {
      skipped.push({ category: 'geschützt', label: live.name, reason: 'Rolle gehört Bot/Owner/Admins/Staff: Rechte dürfen nur wachsen, nie sinken' });
      continue;
    }
    const desc = Object.entries(changes.changes).map(([k, v]) => k === 'permissions' ? `Rechte ${permNames(BigInt(live.permissions)).length}→${permNames(BigInt(v as string)).length} Bits` : `${k}=${String(v)}`).join(', ');
    const step: Step = { effect: changes, label: `Rolle ${live.name}: ${desc}`, phase: PHASE.roleUpdate };
    const after = trial([step]);
    const bad = checkInvariants(cur, after, ctx);
    if (bad.length) { skipped.push({ category: 'zugriff', label: live.name, reason: bad.join('; ') }); continue; }
    accept([step]);
    counters.rollenAktualisiert!++;
  }

  // 2. @everyone: only removals of whitelisted dangerous bits
  {
    const mask = parsePermNames(plan.everyone.remove);
    const everyone = cur.roles.find((r) => r.id === snap.guildId);
    if (everyone && mask !== 0n) {
      const before = BigInt(everyone.permissions);
      const next = before & ~mask;
      if (next !== before) {
        const removed = permNames(before & mask);
        const step: Step = { effect: { t: 'roleUpdate', id: everyone.id, changes: { permissions: next.toString() } }, label: `@everyone: entziehen ${removed.join(', ')}`, phase: PHASE.everyone };
        const bad = checkInvariants(cur, trial([step]), ctx);
        if (bad.length) skipped.push({ category: 'zugriff', label: '@everyone', reason: bad.join('; ') });
        else { accept([step]); counters.everyone = removed.length; }
      }
    }
  }

  // 3. merges (members get the target role; the source role is deleted only when every member provably has the target)
  for (const m of plan.merge) {
    const label = `${m.from} → ${m.into}`;
    const from = findRole(cur, m.from);
    if (!from) continue; // already merged
    const into = findRole(cur, m.into) ?? roleNameCandidates(m.into).map((n) => findRole(cur, n)).find(Boolean);
    if (!into) { skipped.push({ category: 'ziel-fehlt', label, reason: `Zielrolle „${m.into}“ existiert nicht` }); continue; }
    if (from.id === into.id) continue;
    const gate = roleGate(from, label);
    if (gate) { skipped.push(gate); continue; }
    if (into.managed) { skipped.push({ category: 'managed', label, reason: 'Zielrolle ist managed' }); continue; }
    if (!snap.members || !counts) { skipped.push({ category: 'mitglieder-unbekannt', label, reason: 'Mitgliederliste nicht lesbar' }); continue; }
    if (protectedRoles.has(from.id)) { skipped.push({ category: 'geschützt', label, reason: 'Quellrolle gehört Bot/Owner/Admins/Staff' }); continue; }
    const refList = [...(refs.ids.get(from.id) ?? []), ...(refs.names.get(from.name) ?? [])];
    if (refList.length) { skipped.push({ category: 'referenziert', label, reason: `Bot verweist darauf: ${refList.slice(0, 3).join('; ')}` }); continue; }
    const holders = membersOf(cur, from.id);
    const limit = m.maxMembers ?? plan.maxMembers ?? opts.maxMembers ?? DEFAULT_MAX_MEMBERS;
    if (holders.length > limit) { skipped.push({ category: 'mitglieder-limit', label, reason: `${holders.length} Mitglieder > Limit ${limit}`, count: holders.length }); continue; }
    const toAdd = holders.filter((u) => !(cur.members?.[u] ?? []).includes(into.id));
    const effects: Step[] = toAdd.map((u) => ({ effect: { t: 'memberAddRole', userId: u, roleId: into.id }, label: `Mitglied bekommt ${into.name}`, phase: PHASE.memberAdd }));
    if (!m.keepSource) effects.push({ effect: { t: 'roleDelete', id: from.id }, label: `Rolle ${from.name} löschen (nach Umhängen auf ${into.name})`, phase: PHASE.roleDelete });
    const after = trial(effects);
    const loss = [...memberLoss(cur, after, holders), ...checkInvariants(cur, after, ctx)];
    if (loss.length) { skipped.push({ category: 'rechteverlust', label, reason: loss.join('; ') }); continue; }
    accept(effects);
    counters.zusammengelegt!++;
    counters.mitgliederUmgehängt! += toAdd.length;
  }

  // 4. plain deletes: only empty AND unused roles
  for (const name of plan.delete) {
    const r = cur.roles.find((x) => x.name === name && x.id !== snap.guildId);
    if (!r) continue;
    const gate = roleGate(r, name);
    if (gate) { skipped.push(gate); continue; }
    if (!counts) { skipped.push({ category: 'mitglieder-unbekannt', label: name, reason: 'Mitgliederliste nicht lesbar' }); continue; }
    if (protectedRoles.has(r.id)) { skipped.push({ category: 'geschützt', label: name, reason: 'Rolle gehört Bot/Owner/Admins/Staff' }); continue; }
    const n = membersOf(cur, r.id).length;
    if (n > 0) { skipped.push({ category: 'nicht-leer', label: name, reason: `${n} Mitglied(er)`, count: n }); continue; }
    const refList = [...(refs.ids.get(r.id) ?? []), ...(refs.names.get(r.name) ?? [])];
    if (refList.length) { skipped.push({ category: 'referenziert', label: name, reason: `Bot verweist darauf: ${refList.slice(0, 3).join('; ')}` }); continue; }
    const ow = overwriteTargetsUsed(cur, r.id);
    if (ow > 0) { skipped.push({ category: 'in-benutzung', label: name, reason: `${ow} Kanal-Overwrite(s)`, count: ow }); continue; }
    const step: Step = { effect: { t: 'roleDelete', id: r.id }, label: `Rolle ${r.name} löschen (leer, ungenutzt)`, phase: PHASE.roleDelete };
    const bad = checkInvariants(cur, trial([step]), ctx);
    if (bad.length) { skipped.push({ category: 'zugriff', label: name, reason: bad.join('; ') }); continue; }
    accept([step]);
    counters.gelöscht!++;
  }

  // 5. visibility: staff-only channels
  if (staffMissing.length < plan.visibility.staffRoles.length) {
    const staffRoles = cur.roles.filter((r) => plan.visibility.staffRoles.includes(r.name) && !r.managed);
    const byName = (n: string): ChannelRec[] => cur.channels.filter((c) => c.name === n);
    const targets = new Map<string, ChannelRec>();
    for (const n of plan.visibility.staffOnlyChannels) for (const c of byName(n)) targets.set(c.id, c);
    for (const n of plan.visibility.staffOnlyCategories) {
      for (const cat of byName(n).filter((c) => c.type === CATEGORY_TYPE)) {
        targets.set(cat.id, cat);
        for (const c of cur.channels.filter((x) => x.parentId === cat.id)) targets.set(c.id, c);
      }
    }
    for (const n of [...plan.visibility.staffOnlyChannels, ...plan.visibility.staffOnlyCategories]) {
      if (byName(n).length === 0) skipped.push({ category: 'nicht-gefunden', label: n, reason: 'Kanal/Kategorie existiert live nicht' });
    }
    if (staffMissing.length) skipped.push({ category: 'nicht-gefunden', label: staffMissing.join(', '), reason: 'Staff-Rolle fehlt live (übrige Staff-Rollen genügen)' });
    for (const ch of targets.values()) {
      if (ch.name === ARCHIVE_CATEGORY_NAME) continue;
      const kept: string[] = [];
      const effects = visibilityEffects(cur, ch, staffRoles, protectedRoles, kept);
      if (kept.length) skipped.push({ category: 'geschützt', label: `#${ch.name}`, reason: `Rolle(n) ${[...new Set(kept)].join(', ')} behalten Sicht (gehören Bot/Owner/Admins/Staff): Kanal nicht ganz team-only` });
      if (!effects.length) continue;
      const after = trial(effects);
      const bad = checkInvariants(cur, after, ctx);
      if (bad.length) { skipped.push({ category: 'zugriff', label: `#${ch.name}`, reason: bad.join('; ') }); continue; }
      accept(effects);
      counters.kanäleSichtbarkeit!++;
    }
  }

  // Final belt-and-braces check of the whole plan against the untouched snapshot.
  violations.push(...checkInvariants(snap, cur, ctx));
  return { steps, skipped, violations, counters, after: cur, guardedCount: guarded.length };
}

/** Overwrites that make `ch` staff-only: @everyone and member roles lose VIEW, staff roles and the bot are allowed. */
function visibilityEffects(snap: RolesSnapshot, ch: ChannelRec, staff: readonly RoleRec[], protectedRoles: ReadonlySet<string>, kept: string[] = []): Step[] {
  const out: Step[] = [];
  const put = (target: string, type: 0 | 1, allow: bigint, deny: bigint, label: string, phase: number): void => {
    const old = ch.overwrites.find((o) => o.id === target && o.type === type);
    if (old && BigInt(old.allow) === allow && BigInt(old.deny) === deny) return;
    if (!old && allow === 0n && deny === 0n) return;
    out.push({ effect: { t: 'overwrite', channelId: ch.id, target, type, allow: allow.toString(), deny: deny.toString() }, label: `#${ch.name}: ${label}`, phase });
  };
  const get = (id: string, type: 0 | 1): { allow: bigint; deny: bigint } => {
    const o = ch.overwrites.find((x) => x.id === id && x.type === type);
    return { allow: BigInt(o?.allow ?? '0'), deny: BigInt(o?.deny ?? '0') };
  };
  const isCategory = ch.type === CATEGORY_TYPE;
  const need = P.VIEW_CHANNEL | (isCategory ? 0n : P.READ_MESSAGE_HISTORY);
  // Allow first (phase 1): staff roles and the bot.
  for (const r of staff) {
    const o = get(r.id, 0);
    put(r.id, 0, o.allow | need, o.deny & ~need, `${r.name} darf sehen`, PHASE.allowOverwrite);
  }
  const bot = get(snap.botUserId, 1);
  put(snap.botUserId, 1, bot.allow | BOT_CHANNEL_ALLOW, bot.deny & ~BOT_CHANNEL_ALLOW, 'Bot behält Zugriff', PHASE.allowOverwrite);
  // Then deny (phase 3): @everyone and every non-staff role overwrite that grants VIEW.
  const ev = get(snap.guildId, 0);
  put(snap.guildId, 0, ev.allow & ~P.VIEW_CHANNEL, ev.deny | P.VIEW_CHANNEL, '@everyone sieht nichts', PHASE.denyOverwrite);
  const staffIds = new Set(staff.map((r) => r.id));
  for (const o of ch.overwrites) {
    if (o.type !== 0 || o.id === snap.guildId || staffIds.has(o.id)) continue;
    const role = snap.roles.find((r) => r.id === o.id);
    if (!role || role.managed) continue;
    if ((BigInt(o.allow) & P.VIEW_CHANNEL) === 0n) continue;
    if (protectedRoles.has(role.id)) { kept.push(role.name); continue; }
    put(o.id, 0, BigInt(o.allow) & ~P.VIEW_CHANNEL, BigInt(o.deny) | P.VIEW_CHANNEL, `${role.name} verliert Sicht`, PHASE.denyOverwrite);
  }
  return out;
}

export function formatApplyPlan(plan: ApplyPlan, mode: 'dry-run' | 'execute'): string {
  const L: string[] = [];
  L.push(`MagguuBot Rollen-Aufräumen · Modus: ${mode}`);
  const c = plan.counters;
  L.push(`Plan: ${plan.steps.length} Schritte · Rollen ${c.rollenAktualisiert} · @everyone-Bits ${c.everyone} · Zusammenlegungen ${c.zusammengelegt} (${c.mitgliederUmgehängt} Mitglieder umhängen) · Löschungen ${c.gelöscht} · Kanäle staff-only ${c.kanäleSichtbarkeit} · geschützte Nutzer ${plan.guardedCount} · nicht ausgeführt ${plan.skipped.length}`);
  const groups: Array<[string, (s: Step) => boolean]> = [
    ['Rollen/@everyone', (s) => s.effect.t === 'roleUpdate'],
    ['Zusammenlegen', (s) => s.effect.t === 'roleDelete' && /nach Umhängen/.test(s.label)],
    ['Löschen', (s) => s.effect.t === 'roleDelete' && !/nach Umhängen/.test(s.label)],
    ['Sichtbarkeit', (s) => s.effect.t === 'overwrite'],
  ];
  for (const [title, test] of groups) {
    const list = [...plan.steps].filter(test).sort((a, b) => a.phase - b.phase);
    if (!list.length) continue;
    L.push(`${title}:`);
    for (const s of list) L.push(`  + ${s.label}`);
  }
  const adds = plan.steps.filter((s) => s.effect.t === 'memberAddRole').length;
  if (adds) L.push(`Mitglieder umhängen: ${adds} Zuweisungen (keine Namen/IDs im Output)`);
  if (plan.skipped.length) {
    L.push('Nicht ausgeführt (nur aufgelistet):');
    const byCat = new Map<string, Skip[]>();
    for (const s of plan.skipped) byCat.set(s.category, [...(byCat.get(s.category) ?? []), s]);
    for (const [cat, list] of byCat) {
      L.push(`  [${cat}] ${list.length}`);
      for (const s of list) L.push(`    · ${s.label}: ${s.reason}`);
    }
  }
  if (plan.violations.length) {
    L.push('ABBRUCH-GRÜNDE (harte Gitter):');
    for (const v of plan.violations) L.push(`  ✖ ${v}`);
  }
  if (!plan.steps.length) L.push('Nichts zu tun.');
  return `${L.join('\n')}\n`;
}
