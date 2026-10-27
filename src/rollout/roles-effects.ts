/**
 * Effects = the only write operations the role tooling knows. Each effect can be (a) simulated on a snapshot,
 * (b) turned into exactly one REST call and (c) described in the diff. Apply and restore both plan as effects, so
 * every safety rule is checked on the SIMULATED result before anything is sent, and again on the live result after.
 */
import type { RestLike } from './execute.js';
import {
  BOT_POST_REQUIRED, CATEGORY_TYPE, CRITICAL_PERMS, P, basePermissions, botRoleIds, channelPermissions, cloneSnapshot, permNames,
  type ChannelRec, type OverwriteRec, type RoleRec, type RolesSnapshot,
} from './roles-model.js';

export type RoleChanges = Partial<Pick<RoleRec, 'name' | 'permissions' | 'mentionable' | 'hoist' | 'color'>>;

export type Effect =
  | { t: 'roleUpdate'; id: string; changes: RoleChanges }
  | { t: 'roleDelete'; id: string }
  | { t: 'roleCreate'; id: string; role: Pick<RoleRec, 'name' | 'permissions' | 'color' | 'hoist' | 'mentionable' | 'position'> }
  | { t: 'overwrite'; channelId: string; target: string; type: 0 | 1; allow: string; deny: string }
  | { t: 'memberAddRole'; userId: string; roleId: string }
  | { t: 'rolePositions'; items: Array<{ id: string; position: number }> };

export interface Step {
  effect: Effect;
  /** Human label for the diff (role/channel names only, never user ids). */
  label: string;
  /** Execution order: additive things first, removals last. */
  phase: number;
}

export const isPending = (id: string): boolean => id.startsWith('new:');

// ─── Simulation ───────────────────────────────────────────────────────────
export function applyEffect(snap: RolesSnapshot, e: Effect): void {
  switch (e.t) {
    case 'roleUpdate': {
      const r = snap.roles.find((x) => x.id === e.id);
      if (r) Object.assign(r, e.changes);
      return;
    }
    case 'roleDelete': {
      snap.roles = snap.roles.filter((r) => r.id !== e.id);
      if (snap.members) for (const k of Object.keys(snap.members)) snap.members[k] = (snap.members[k] ?? []).filter((id) => id !== e.id);
      for (const c of snap.channels) c.overwrites = c.overwrites.filter((o) => !(o.type === 0 && o.id === e.id));
      return;
    }
    case 'roleCreate':
      snap.roles.push({ id: e.id, managed: false, flags: 0, unicodeEmoji: null, tags: null, ...e.role });
      return;
    case 'overwrite': {
      const c = snap.channels.find((x) => x.id === e.channelId);
      if (!c) return;
      c.overwrites = c.overwrites.filter((o) => !(o.id === e.target && o.type === e.type));
      if (e.allow !== '0' || e.deny !== '0') c.overwrites.push({ id: e.target, type: e.type, allow: e.allow, deny: e.deny });
      return;
    }
    case 'memberAddRole': {
      if (!snap.members) return;
      const list = snap.members[e.userId] ?? (snap.members[e.userId] = []);
      if (!list.includes(e.roleId)) list.push(e.roleId);
      return;
    }
    case 'rolePositions':
      for (const it of e.items) {
        const r = snap.roles.find((x) => x.id === it.id);
        if (r) r.position = it.position;
      }
  }
}

export function simulate(snap: RolesSnapshot, steps: readonly Step[]): RolesSnapshot {
  const out = cloneSnapshot(snap);
  for (const s of steps) applyEffect(out, s.effect);
  return out;
}

// ─── Invariants ───────────────────────────────────────────────────────────
export interface InvariantContext {
  /** Members that must keep their access: owner, configured admins, administrators, staff-role holders. Not the bot. */
  guardedUserIds: readonly string[];
  /** Channels the bot posts to (database channel keys etc.). */
  postingChannelIds: ReadonlySet<string>;
}

const textLike = (c: ChannelRec): boolean => c.type !== CATEGORY_TYPE && c.type !== 2 && c.type !== 13;

/**
 * Violations of the hard rules between a state and its successor (counts and channel names only – no user ids):
 *  - the bot keeps VIEW everywhere it could view and keeps View/Send/Embed/History in every posting channel (also before),
 *  - guarded members keep every critical guild permission and every channel they could view.
 */
export function checkInvariants(before: RolesSnapshot, after: RolesSnapshot, ctx: InvariantContext): string[] {
  const out: string[] = [];
  if (!before.members || !after.members) return ['Mitgliederliste nicht lesbar: Zugriffsprüfung unmöglich'];
  const afterChannel = new Map(after.channels.map((c) => [c.id, c]));
  const botId = before.botUserId;
  if (!after.members[botId] && !before.members[botId]) out.push('Bot-Mitglied nicht in der Mitgliederliste gefunden');

  const botBefore = basePermissions(before, botId);
  const botAfter = basePermissions(after, botId);
  if ((botBefore & P.ADMINISTRATOR) !== 0n && (botAfter & P.ADMINISTRATOR) === 0n) out.push('Bot würde Administrator verlieren');
  const botLostView: string[] = [];
  const botPostBad: string[] = [];
  const botPreBad: string[] = [];
  for (const c of before.channels) {
    const a = afterChannel.get(c.id);
    if (!a) continue;
    const b0 = channelPermissions(before, c, botId);
    const b1 = channelPermissions(after, a, botId);
    if ((b0 & P.VIEW_CHANNEL) !== 0n && (b1 & P.VIEW_CHANNEL) === 0n) botLostView.push(c.name);
    if (ctx.postingChannelIds.has(c.id) && textLike(c)) {
      if ((b0 & BOT_POST_REQUIRED) !== BOT_POST_REQUIRED) botPreBad.push(c.name);
      if ((b1 & BOT_POST_REQUIRED) !== BOT_POST_REQUIRED) botPostBad.push(c.name);
    }
  }
  if (botLostView.length) out.push(`Bot verliert Sichtrecht in: ${botLostView.join(', ')}`);
  const newPostBad = botPostBad.filter((n) => !botPreBad.includes(n));
  if (newPostBad.length) out.push(`Bot ohne View/Send/Embed/History in Post-Kanal: ${newPostBad.join(', ')}`);
  if (botPreBad.length) out.push(`Bot hat schon VOR dem Lauf nicht alle Post-Rechte (${botPreBad.join(', ')}): erst reparieren, dann aufräumen`);

  let lostCritical = 0;
  const lostChannels = new Set<string>();
  for (const uid of ctx.guardedUserIds) {
    if (uid === botId) continue;
    const b0 = basePermissions(before, uid);
    const b1 = basePermissions(after, uid);
    if ((b0 & CRITICAL_PERMS & ~b1) !== 0n) lostCritical++;
    for (const c of before.channels) {
      const a = afterChannel.get(c.id);
      if (!a) continue;
      if ((channelPermissions(before, c, uid) & P.VIEW_CHANNEL) !== 0n && (channelPermissions(after, a, uid) & P.VIEW_CHANNEL) === 0n) lostChannels.add(c.name);
    }
  }
  if (lostCritical) out.push(`${lostCritical} geschützte(r) Nutzer (Owner/Admins/Mods) würden kritische Rechte verlieren`);
  if (lostChannels.size) out.push(`geschützte Nutzer (Owner/Admins/Mods) verlieren Sichtrecht in: ${[...lostChannels].join(', ')}`);
  return out;
}

/** Per-member loss check for merges: nothing a member could do or see before may be lost (all bits, all channels). */
export function memberLoss(before: RolesSnapshot, after: RolesSnapshot, userIds: readonly string[]): string[] {
  const lostPerms = new Set<string>();
  const lostChannels = new Set<string>();
  const afterChannel = new Map(after.channels.map((c) => [c.id, c]));
  for (const uid of userIds) {
    const lost = basePermissions(before, uid) & ~basePermissions(after, uid);
    for (const n of permNames(lost)) lostPerms.add(n);
    for (const c of before.channels) {
      const a = afterChannel.get(c.id);
      if (a && (channelPermissions(before, c, uid) & P.VIEW_CHANNEL) !== 0n && (channelPermissions(after, a, uid) & P.VIEW_CHANNEL) === 0n) lostChannels.add(c.name);
    }
  }
  const out: string[] = [];
  if (lostPerms.size) out.push(`Rechte gingen verloren: ${[...lostPerms].join(', ')}`);
  if (lostChannels.size) out.push(`Sichtrecht ginge verloren in: ${[...lostChannels].join(', ')}`);
  return out;
}

/** Everyone who must never be locked out: owner, bot-independent. See InvariantContext. */
export function guardedUsers(snap: RolesSnapshot, staffRoleNames: readonly string[], extraProtected: readonly string[]): string[] {
  const set = new Set<string>();
  if (snap.ownerId) set.add(snap.ownerId);
  for (const id of extraProtected) set.add(id);
  const staffIds = new Set(snap.roles.filter((r) => staffRoleNames.includes(r.name) && !r.managed).map((r) => r.id));
  for (const [uid, roles] of Object.entries(snap.members ?? {})) {
    if (roles.some((r) => staffIds.has(r))) set.add(uid);
    else if ((basePermissions(snap, uid) & P.ADMINISTRATOR) !== 0n && uid !== snap.botUserId) set.add(uid);
  }
  set.delete(snap.botUserId);
  return [...set];
}

export function protectedRoleIds(snap: RolesSnapshot, extraProtected: readonly string[]): Set<string> {
  const ids = new Set<string>([snap.guildId, ...botRoleIds(snap)]);
  for (const uid of [snap.ownerId, ...extraProtected]) if (uid) for (const r of snap.members?.[uid] ?? []) ids.add(r);
  return ids;
}

// ─── REST mapping + execution ─────────────────────────────────────────────
export interface Call { method: 'PATCH' | 'PUT' | 'DELETE' | 'POST'; path: string; body?: unknown }

export function callFor(e: Effect, guildId: string): Call {
  switch (e.t) {
    case 'roleUpdate':
      return { method: 'PATCH', path: `/guilds/${guildId}/roles/${e.id}`, body: { ...e.changes } };
    case 'roleDelete':
      return { method: 'DELETE', path: `/guilds/${guildId}/roles/${e.id}` };
    case 'roleCreate': {
      const { position: _position, ...role } = e.role;
      return { method: 'POST', path: `/guilds/${guildId}/roles`, body: role };
    }
    case 'overwrite':
      return e.allow === '0' && e.deny === '0'
        ? { method: 'DELETE', path: `/channels/${e.channelId}/permissions/${e.target}` }
        : { method: 'PUT', path: `/channels/${e.channelId}/permissions/${e.target}`, body: { type: e.type, allow: e.allow, deny: e.deny } };
    case 'memberAddRole':
      return { method: 'PUT', path: `/guilds/${guildId}/members/${e.userId}/roles/${e.roleId}` };
    case 'rolePositions':
      return { method: 'PATCH', path: `/guilds/${guildId}/roles`, body: e.items };
  }
}

export interface ExecResult {
  done: number;
  failed: { label: string; status: number | null; message: string } | null;
  notRun: number;
}

function resolveIds<T>(value: T, ids: ReadonlyMap<string, string>): T {
  const text = JSON.stringify(value);
  if (text === undefined) return value;
  return JSON.parse(text.replace(/new:\d{17,20}/g, (m) => ids.get(m) ?? m)) as T;
}

/**
 * Sequential, stops at the first permanent error (rate limits are handled inside DiscordRest). Never prints bodies.
 * 404 on a delete counts as done (already gone).
 */
export async function executeSteps(rest: RestLike, guildId: string, steps: readonly Step[]): Promise<ExecResult> {
  const ids = new Map<string, string>();
  const ordered = [...steps].sort((a, b) => a.phase - b.phase);
  let done = 0;
  for (const step of ordered) {
    const call = resolveIds(callFor(step.effect, guildId), ids);
    if (/new:\d{17,20}/.test(JSON.stringify(call))) return { done, failed: { label: step.label, status: null, message: 'Rolle noch nicht angelegt (Reihenfolge)' }, notRun: ordered.length - done };
    try {
      const res = await rest.request<{ id?: string }>(call.method, call.path, call.body, call.method === 'DELETE' ? [404] : []);
      if (step.effect.t === 'roleCreate' && res?.id) ids.set(step.effect.id, res.id);
      done++;
    } catch (err) {
      // Duck-typed on purpose: importing rest.js would pull the env config + database into this pure module (and its tests).
      const raw = (err as { status?: unknown } | null)?.status;
      const status = typeof raw === 'number' ? raw : null;
      return { done, failed: { label: step.label, status, message: status ? `HTTP ${status}` : (err as Error).message.slice(0, 120) }, notRun: ordered.length - done - 1 };
    }
  }
  return { done, failed: null, notRun: 0 };
}

export const ownOverwrite = (c: ChannelRec, id: string, type: 0 | 1): OverwriteRec | undefined => c.overwrites.find((o) => o.id === id && o.type === type);
