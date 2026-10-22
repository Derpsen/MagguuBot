/**
 * Pure planning logic for the Discord server rollout. Takes a plain snapshot
 * of the guild (as returned by REST v10) and returns an ordered list of
 * actions. No network, no database — unit-tested in tests/discord-rollout.test.ts.
 */
import { CHANNEL_CATALOG, type ChannelKey } from '../discord/channel-catalog.js';
import {
  ARCHIVE_CATEGORY_NAME,
  CHANNEL,
  LAYOUT_CATEGORY_NAMES,
  PERM,
  PROTECTED_CATEGORY_NAMES,
  PROTECTED_CHANNEL_NAMES,
  ROLE,
  ROLES,
  STAFF_ROLE_NAMES,
  STRUCTURE,
  channelPlanForRef,
  type ChannelPlan,
  type RolePlan,
} from '../discord/server-layout.js';
import { NEWCOMER_ROLE_SENTINEL } from '../discord/auto-role-setting.js';

export const CHANNEL_TYPE = { text: 0, voice: 2, category: 4, announcement: 5, stage: 13, forum: 15 } as const;

export interface SnapOverwrite {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
}

export interface SnapChannel {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
  position: number;
  topic?: string | null;
  permission_overwrites: SnapOverwrite[];
}

export interface SnapRole {
  id: string;
  name: string;
  color: number;
  position: number;
  permissions: string;
  managed: boolean;
  hoist: boolean;
  mentionable: boolean;
}

export interface GuildSnapshot {
  guildId: string;
  botUserId: string;
  /** Position of the bot's highest role; roles at or above it cannot be edited by the bot. */
  botHighestRolePosition: number;
  features: string[];
  rulesChannelId: string | null;
  publicUpdatesChannelId: string | null;
  verificationLevel: number;
  explicitContentFilter: number;
  channels: SnapChannel[];
  roles: SnapRole[];
  /** userId → role ids (from GET /guilds/{id}/members). `null` = member list unavailable. */
  members: Record<string, string[]> | null;
  channelConfig: Partial<Record<ChannelKey, string>>;
  autoRoleSetting: string | null;
  onboarding: { enabled: boolean; promptTitles: string[]; defaultChannelIds: string[] } | null;
  welcomeScreen: { description: string | null; channelIds: string[] } | null;
}

/** A reference is either a live snowflake or `new:<kind>:<name>` for something created earlier in the run. */
export type Ref = string;
export const newRef = (kind: 'category' | 'channel' | 'role', name: string): Ref => `new:${kind}:${name}`;
export const isNewRef = (ref: Ref): boolean => ref.startsWith('new:');

export interface OverwriteSpec {
  target: Ref;
  type: 0 | 1;
  allow: string;
  deny: string;
}

export interface OnboardingSpec {
  defaultChannels: Ref[];
  prompts: Array<{
    title: string;
    singleSelect: boolean;
    required: boolean;
    options: Array<{ title: string; description: string; emoji: string; channels: Ref[]; roles: Ref[] }>;
  }>;
}

export interface WelcomeScreenSpec {
  description: string;
  channels: Array<{ channel: Ref; description: string; emoji: string }>;
}

export type Action =
  | { kind: 'createCategory'; ref: Ref; name: string; overwrites: OverwriteSpec[] }
  | { kind: 'createChannel'; ref: Ref; name: string; type: 0 | 2; parent: Ref; topic?: string; overwrites: OverwriteSpec[] }
  | {
    kind: 'updateChannel';
    id: string;
    current: string;
    changes: { name?: string; parent?: Ref; topic?: string; overwrites?: OverwriteSpec[] };
    why: string[];
  }
  | { kind: 'archiveChannel'; id: string; name: string; from: string | null; archive: Ref; overwrites: OverwriteSpec[] }
  | { kind: 'hideCategory'; id: string; name: string; overwrites: OverwriteSpec[] }
  | { kind: 'createRole'; ref: Ref; plan: RolePlan }
  | {
    kind: 'updateRole';
    id: string;
    current: string;
    changes: { name?: string; permissions?: string; mentionable?: boolean };
    blocked?: string;
  }
  | { kind: 'migrateMembers'; fromRole: string; toRole: Ref; toName: string; userIds: string[] }
  | { kind: 'setChannelKey'; key: ChannelKey; target: Ref; targetName: string; previous: string | null }
  | { kind: 'setAutoRole'; target: Ref; previous: string | null }
  | { kind: 'enableCommunity'; rules: Ref; updates: Ref; verificationLevel: number; explicitContentFilter: number }
  | { kind: 'putOnboarding'; spec: OnboardingSpec }
  | { kind: 'putWelcomeScreen'; spec: WelcomeScreenSpec }
  | { kind: 'reorder'; items: Array<{ ref: Ref; position: number; name: string }> };

export interface RolloutPlan {
  actions: Action[];
  /** Things the script cannot do and that need a manual click in Discord. */
  manual: string[];
  /** Plan channel name → resolved ref (live id or new:…). */
  channelRefs: Record<string, Ref>;
  roleRefs: Record<string, Ref>;
  archiveRef: Ref | null;
}

const BOT_CHANNEL_ALLOW =
  PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.EMBED_LINKS | PERM.ATTACH_FILES
  | PERM.READ_MESSAGE_HISTORY | PERM.MANAGE_MESSAGES | PERM.ADD_REACTIONS;
const BOT_CATEGORY_ALLOW = BOT_CHANNEL_ALLOW | PERM.MANAGE_CHANNELS;

function ow(target: Ref, type: 0 | 1, allow: bigint, deny: bigint): OverwriteSpec {
  return { target, type, allow: allow.toString(), deny: deny.toString() };
}

/** Desired overwrites for a layout channel — mirrors `applyChannelPermissions` in setup-server. */
export function desiredOverwrites(
  plan: ChannelPlan,
  everyoneId: string,
  botUserId: string,
  roleRefs: Record<string, Ref | undefined>,
): OverwriteSpec[] {
  const out: OverwriteSpec[] = [];
  const isVoice = plan.kind === 'voice';
  const gatedTo = plan.adminOnly
    ? [...STAFF_ROLE_NAMES]
    : plan.allowedRoles?.length
      ? [...new Set([...plan.allowedRoles, ...STAFF_ROLE_NAMES])]
      : null;
  if (gatedTo) {
    out.push(ow(everyoneId, 0, 0n, PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES));
    for (const name of gatedTo) {
      const ref = roleRefs[name];
      if (!ref) continue;
      const staff = (STAFF_ROLE_NAMES as readonly string[]).includes(name);
      let allow = PERM.VIEW_CHANNEL | PERM.READ_MESSAGE_HISTORY;
      let deny = 0n;
      if (plan.readOnly) deny |= PERM.SEND_MESSAGES;
      else allow |= PERM.SEND_MESSAGES;
      if (staff) allow |= PERM.MANAGE_MESSAGES;
      if (isVoice) allow |= PERM.CONNECT;
      out.push(ow(ref, 0, allow, deny));
    }
  } else if (plan.readOnly) {
    out.push(ow(everyoneId, 0, PERM.VIEW_CHANNEL, PERM.SEND_MESSAGES));
  }
  out.push(ow(botUserId, 1, isVoice ? BOT_CATEGORY_ALLOW : BOT_CHANNEL_ALLOW, 0n));
  return out;
}

export function archiveOverwrites(everyoneId: string, botUserId: string, roleRefs: Record<string, Ref | undefined>): OverwriteSpec[] {
  const out: OverwriteSpec[] = [ow(everyoneId, 0, 0n, PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES)];
  for (const name of STAFF_ROLE_NAMES) {
    const ref = roleRefs[name];
    if (ref) out.push(ow(ref, 0, PERM.VIEW_CHANNEL | PERM.READ_MESSAGE_HISTORY, PERM.SEND_MESSAGES));
  }
  out.push(ow(botUserId, 1, BOT_CATEGORY_ALLOW, 0n));
  return out;
}

function categoryOverwrites(botUserId: string): OverwriteSpec[] {
  return [ow(botUserId, 1, BOT_CATEGORY_ALLOW, 0n)];
}

/** Order-independent comparison; only live ids can match (pending refs always differ). */
export function overwritesEqual(live: SnapOverwrite[], wanted: OverwriteSpec[]): boolean {
  if (wanted.some((w) => isNewRef(w.target))) return false;
  const norm = (list: Array<{ id: string; type: number; allow: string; deny: string }>): string =>
    list
      .filter((o) => o.allow !== '0' || o.deny !== '0')
      .map((o) => `${o.id}:${o.type}:${BigInt(o.allow)}:${BigInt(o.deny)}`)
      .sort()
      .join('|');
  return norm(live) === norm(wanted.map((w) => ({ id: w.target, type: w.type, allow: w.allow, deny: w.deny })));
}

function stripMentionEveryone(perms: string): string {
  return (BigInt(perms) & ~PERM.MENTION_EVERYONE).toString();
}

/** Legacy channel that lived in a protected category but is merged into the layout. */
const LEGACY_TICKET_LOG_NAME = 'ticket-logs';

function isProtectedChannel(ch: SnapChannel, byId: Map<string, SnapChannel>): boolean {
  if (PROTECTED_CHANNEL_NAMES.has(ch.name)) return true;
  if (ch.name === LEGACY_TICKET_LOG_NAME) return false;
  const parent = ch.parent_id ? byId.get(ch.parent_id) : undefined;
  return Boolean(parent && PROTECTED_CATEGORY_NAMES.has(parent.name));
}

export function planRollout(snap: GuildSnapshot): RolloutPlan {
  const actions: Action[] = [];
  const manual: string[] = [];
  const everyoneId = snap.guildId;
  const byId = new Map(snap.channels.map((c) => [c.id, c]));
  const categories = snap.channels.filter((c) => c.type === CHANNEL_TYPE.category);

  // ─── 1. Roles (first, so overwrites can reference them) ────────────────
  const roleRefs: Record<string, Ref> = {};
  const claimedRoles = new Set<string>();
  const findRole = (name: string): SnapRole | undefined =>
    snap.roles.find((r) => r.name === name && !r.managed && !claimedRoles.has(r.id));
  const roleUpdates: Action[] = [];
  for (const plan of ROLES) {
    const live = findRole(plan.name) ?? plan.oldNames?.map(findRole).find(Boolean);
    if (!live) {
      const ref = newRef('role', plan.name);
      roleRefs[plan.name] = ref;
      actions.push({ kind: 'createRole', ref, plan });
      continue;
    }
    claimedRoles.add(live.id);
    roleRefs[plan.name] = live.id;
    const changes: { name?: string; permissions?: string; mentionable?: boolean } = {};
    if (live.name !== plan.name) changes.name = plan.name;
    if (BigInt(live.permissions) !== BigInt(plan.permissions)) changes.permissions = plan.permissions;
    if ((plan.mentionable ?? false) !== live.mentionable) changes.mentionable = plan.mentionable ?? false;
    if (Object.keys(changes).length) {
      roleUpdates.push({
        kind: 'updateRole',
        id: live.id,
        current: live.name,
        changes,
        blocked: live.position >= snap.botHighestRolePosition
          ? `Rolle „${live.name}“ steht über/auf der Bot-Rolle (Position ${live.position} ≥ ${snap.botHighestRolePosition})`
          : undefined,
      });
    }
  }
  // MENTION_EVERYONE: only Admin keeps it (via Administrator). Strip it from @everyone and every other role.
  for (const role of snap.roles) {
    if (role.managed || claimedRoles.has(role.id)) continue;
    if ((BigInt(role.permissions) & PERM.MENTION_EVERYONE) === 0n) continue;
    roleUpdates.push({
      kind: 'updateRole',
      id: role.id,
      current: role.name,
      changes: { permissions: stripMentionEveryone(role.permissions) },
      blocked: role.id !== everyoneId && role.position >= snap.botHighestRolePosition
        ? `Rolle „${role.name}“ steht über/auf der Bot-Rolle`
        : undefined,
    });
  }
  actions.push(...roleUpdates);
  for (const a of roleUpdates) {
    if (a.kind === 'updateRole' && a.blocked) {
      manual.push(`${a.blocked}: in Servereinstellungen → Rollen die Bot-Rolle „MagguuBot“ über Admin/Moderator ziehen und erneut --apply, oder von Hand setzen: ${describeRoleChanges(a.changes)}`);
    }
  }

  // ─── 2. Categories ─────────────────────────────────────────────────────
  const claimedChannels = new Set<string>();
  const categoryRefs: Record<string, Ref> = {};
  for (const plan of STRUCTURE) {
    const live = [plan.name, ...(plan.oldNames ?? [])]
      .map((n) => categories.find((c) => c.name === n && !claimedChannels.has(c.id)))
      .find(Boolean);
    if (!live) {
      const ref = newRef('category', plan.name);
      categoryRefs[plan.name] = ref;
      actions.push({ kind: 'createCategory', ref, name: plan.name, overwrites: categoryOverwrites(snap.botUserId) });
      continue;
    }
    claimedChannels.add(live.id);
    categoryRefs[plan.name] = live.id;
    const why: string[] = [];
    const changes: { name?: string; overwrites?: OverwriteSpec[] } = {};
    if (live.name !== plan.name) {
      changes.name = plan.name;
      why.push(`umbenennen ${live.name} → ${plan.name}`);
    }
    const wanted = categoryOverwrites(snap.botUserId);
    const liveBot = live.permission_overwrites.filter((o) => o.id === snap.botUserId);
    if (!overwritesEqual(liveBot, wanted)) {
      // keep foreign overwrites on categories, only ensure the bot entry
      changes.overwrites = [
        ...live.permission_overwrites.filter((o) => o.id !== snap.botUserId).map((o) => ({ target: o.id, type: o.type, allow: o.allow, deny: o.deny })),
        ...wanted,
      ];
      why.push('Bot-Rechte auf Kategorie');
    }
    if (why.length) actions.push({ kind: 'updateChannel', id: live.id, current: live.name, changes, why });
  }

  // ─── 3. Channels ───────────────────────────────────────────────────────
  const channelRefs: Record<string, Ref> = {};
  for (const cat of STRUCTURE) {
    const parentRef = categoryRefs[cat.name] as Ref;
    for (const plan of cat.channels) {
      const type: 0 | 2 = plan.kind === 'voice' ? CHANNEL_TYPE.voice : CHANNEL_TYPE.text;
      const matchesType = (c: SnapChannel): boolean =>
        type === CHANNEL_TYPE.text ? c.type === CHANNEL_TYPE.text || c.type === CHANNEL_TYPE.announcement : c.type === type;
      const candidates = snap.channels.filter((c) => matchesType(c) && !claimedChannels.has(c.id) && !isProtectedChannel(c, byId));
      const exact = candidates.filter((c) => c.name === plan.name);
      const live = exact.find((c) => c.parent_id === parentRef)
        ?? exact[0]
        ?? (plan.oldNames ?? []).map((n) => candidates.find((c) => c.name === n)).find(Boolean);
      const overwrites = desiredOverwrites(plan, everyoneId, snap.botUserId, roleRefs);
      if (!live) {
        const ref = newRef('channel', plan.name);
        channelRefs[plan.name] = ref;
        actions.push({ kind: 'createChannel', ref, name: plan.name, type, parent: parentRef, topic: plan.topic, overwrites });
        continue;
      }
      claimedChannels.add(live.id);
      channelRefs[plan.name] = live.id;
      const changes: { name?: string; parent?: Ref; topic?: string; overwrites?: OverwriteSpec[] } = {};
      const why: string[] = [];
      if (live.name !== plan.name) {
        changes.name = plan.name;
        why.push(`umbenennen ${live.name} → ${plan.name}`);
      }
      if (live.parent_id !== parentRef) {
        changes.parent = parentRef;
        why.push(`verschieben nach ${cat.name}`);
      }
      if (type === CHANNEL_TYPE.text && plan.topic && (live.topic ?? '') !== plan.topic) {
        changes.topic = plan.topic;
        why.push('Thema');
      }
      if (!overwritesEqual(live.permission_overwrites, overwrites)) {
        changes.overwrites = overwrites;
        why.push('Rechte');
      }
      if (why.length) actions.push({ kind: 'updateChannel', id: live.id, current: live.name, changes, why });
    }
  }

  // ─── 4. Archive everything else (no deletion here) ─────────────────────
  const archiveLive = categories.find((c) => c.name === ARCHIVE_CATEGORY_NAME);
  const toArchive = snap.channels.filter((c) =>
    c.type !== CHANNEL_TYPE.category
    && !claimedChannels.has(c.id)
    && !isProtectedChannel(c, byId),
  );
  let archiveRef: Ref | null = archiveLive?.id ?? null;
  const archOw = archiveOverwrites(everyoneId, snap.botUserId, roleRefs);
  if (toArchive.length && !archiveLive) {
    archiveRef = newRef('category', ARCHIVE_CATEGORY_NAME);
    actions.push({ kind: 'createCategory', ref: archiveRef, name: ARCHIVE_CATEGORY_NAME, overwrites: archOw });
  } else if (archiveLive && !overwritesEqual(archiveLive.permission_overwrites, archOw)) {
    actions.push({ kind: 'updateChannel', id: archiveLive.id, current: archiveLive.name, changes: { overwrites: archOw }, why: ['Archiv-Rechte'] });
  }
  for (const ch of toArchive) {
    if (!archiveRef) break;
    // Already in the archive with archive overwrites → nothing to do.
    if (ch.parent_id === archiveRef && overwritesEqual(ch.permission_overwrites, archOw)) continue;
    actions.push({
      kind: 'archiveChannel',
      id: ch.id,
      name: ch.name,
      from: ch.parent_id ? byId.get(ch.parent_id)?.name ?? null : null,
      archive: archiveRef,
      overwrites: archOw,
    });
  }
  // Legacy categories that end up empty are hidden (deleted only by the gated delete step).
  const remainingParents = new Set<string>();
  for (const ch of snap.channels) {
    if (ch.type === CHANNEL_TYPE.category || !ch.parent_id) continue;
    if (claimedChannels.has(ch.id) || toArchive.includes(ch)) continue;
    remainingParents.add(ch.parent_id);
  }
  const hiddenOw = (cat: SnapChannel): OverwriteSpec[] => [
    ow(everyoneId, 0, 0n, PERM.VIEW_CHANNEL),
    ...cat.permission_overwrites.filter((o) => o.id !== everyoneId).map((o) => ({ target: o.id, type: o.type, allow: o.allow, deny: o.deny })),
  ];
  for (const cat of categories) {
    if (claimedChannels.has(cat.id) || LAYOUT_CATEGORY_NAMES.has(cat.name) || PROTECTED_CATEGORY_NAMES.has(cat.name)) continue;
    if (remainingParents.has(cat.id)) continue;
    const wanted = hiddenOw(cat);
    if (overwritesEqual(cat.permission_overwrites, wanted)) continue;
    actions.push({ kind: 'hideCategory', id: cat.id, name: cat.name, overwrites: wanted });
  }

  // ─── 4b. Order: layout categories first (STRUCTURE order), channels in plan order ─
  const reorder: Array<{ ref: Ref; position: number; name: string }> = [];
  const positionOf = (ref: Ref): number | undefined => (isNewRef(ref) ? undefined : byId.get(ref)?.position);
  const checkOrder = (items: Array<{ ref: Ref; name: string }>): void => {
    const live = items.map((i) => positionOf(i.ref));
    const ordered = live.every((p, idx) => p !== undefined && (idx === 0 || (live[idx - 1] as number) < p));
    if (!ordered) items.forEach((i, idx) => reorder.push({ ref: i.ref, position: idx, name: i.name }));
  };
  checkOrder(STRUCTURE.map((c) => ({ ref: categoryRefs[c.name] as Ref, name: c.name })));
  for (const cat of STRUCTURE) {
    // Discord sorts voice below text on its own; only text channels are ordered here.
    checkOrder(cat.channels.filter((c) => c.kind !== 'voice').map((c) => ({ ref: channelRefs[c.name] as Ref, name: c.name })));
  }
  const layoutCategoryIds = new Set(STRUCTURE.map((c) => categoryRefs[c.name]));
  const maxLayoutPos = Math.max(-1, ...STRUCTURE.map((c) => positionOf(categoryRefs[c.name] as Ref) ?? -1));
  if (categories.some((c) => !layoutCategoryIds.has(c.id) && c.position < maxLayoutPos)) {
    // Something foreign sits between layout categories → force layout categories to the top.
    if (!reorder.some((r) => layoutCategoryIds.has(r.ref))) {
      STRUCTURE.forEach((c, idx) => reorder.push({ ref: categoryRefs[c.name] as Ref, position: idx, name: c.name }));
    }
    let pos = STRUCTURE.length;
    for (const c of [...categories].sort((a, b) => a.position - b.position)) {
      if (!layoutCategoryIds.has(c.id)) reorder.push({ ref: c.id, position: pos++, name: c.name });
    }
  }
  if (reorder.length) actions.push({ kind: 'reorder', items: reorder });

  // ─── 5. Members of merged roles → new ping/rank roles ──────────────────
  if (snap.members) {
    for (const plan of ROLES) {
      for (const fromName of plan.mergeFrom ?? []) {
        const from = snap.roles.find((r) => r.name === fromName && !claimedRoles.has(r.id));
        if (!from) continue;
        const target = roleRefs[plan.name] as Ref;
        const userIds = Object.entries(snap.members)
          .filter(([, roles]) => roles.includes(from.id) && !roles.includes(target))
          .map(([userId]) => userId)
          .sort();
        if (userIds.length) actions.push({ kind: 'migrateMembers', fromRole: from.name, toRole: target, toName: plan.name, userIds });
      }
    }
  } else {
    manual.push('Mitgliederliste nicht lesbar (GUILD_MEMBERS-Intent?): Rollen-Migration übersprungen.');
  }

  // ─── 6. Bot channel keys + auto role ───────────────────────────────────
  for (const entry of CHANNEL_CATALOG) {
    const plan = channelPlanForRef(entry.key);
    if (!plan) continue;
    const target = channelRefs[plan.name] as Ref;
    const previous = snap.channelConfig[entry.key] ?? null;
    if (previous !== target) actions.push({ kind: 'setChannelKey', key: entry.key, target, targetName: plan.name, previous });
  }
  const newcomer = roleRefs[ROLE.newcomer] as Ref;
  const auto = snap.autoRoleSetting;
  const autoIsLiveRole = auto !== null && snap.roles.some((r) => r.id === auto);
  if (auto === null || auto === '' || auto === NEWCOMER_ROLE_SENTINEL || !autoIsLiveRole) {
    if (auto !== newcomer) actions.push({ kind: 'setAutoRole', target: newcomer, previous: auto });
  }

  // ─── 7. Community, onboarding, welcome screen ──────────────────────────
  const rules = channelRefs[CHANNEL.welcome] as Ref;
  const updates = channelRefs[CHANNEL.status] as Ref;
  const verificationLevel = Math.max(1, snap.verificationLevel);
  if (
    !snap.features.includes('COMMUNITY')
    || snap.rulesChannelId !== rules
    || snap.publicUpdatesChannelId !== updates
    || snap.explicitContentFilter !== 2
    || snap.verificationLevel < 1
  ) {
    actions.push({ kind: 'enableCommunity', rules, updates, verificationLevel, explicitContentFilter: 2 });
  }
  const onboarding = desiredOnboarding(channelRefs, roleRefs);
  if (!onboardingMatches(snap.onboarding, onboarding)) actions.push({ kind: 'putOnboarding', spec: onboarding });
  const welcome = desiredWelcomeScreen(channelRefs);
  if (!welcomeScreenMatches(snap.welcomeScreen, welcome)) actions.push({ kind: 'putWelcomeScreen', spec: welcome });

  return { actions, manual, channelRefs, roleRefs, archiveRef };
}

function describeRoleChanges(changes: { name?: string; permissions?: string; mentionable?: boolean }): string {
  const parts: string[] = [];
  if (changes.name) parts.push(`Name → ${changes.name}`);
  if (changes.permissions !== undefined) {
    const p = BigInt(changes.permissions);
    parts.push(p === PERM.ADMINISTRATOR
      ? 'Rechte → nur Administrator'
      : p === 0n ? 'Rechte → keine (erbt @everyone)' : `Rechte → Bitmaske ${changes.permissions}`);
  }
  if (changes.mentionable !== undefined) parts.push(`erwähnbar → ${changes.mentionable ? 'ja' : 'nein'}`);
  return parts.join(', ');
}

export function desiredOnboarding(ch: Record<string, Ref>, roles: Record<string, Ref>): OnboardingSpec {
  const c = (name: string): Ref => ch[name] as Ref;
  const r = (name: string): Ref => roles[name] as Ref;
  return {
    defaultChannels: [
      CHANNEL.welcome, CHANNEL.announcements, CHANNEL.updates, CHANNEL.help,
      CHANNEL.suggestions, CHANNEL.chat, CHANNEL.requests, CHANNEL.newOnPlex,
    ].map(c),
    prompts: [
      {
        title: 'Wofür bist du hier?',
        singleSelect: false,
        required: false,
        options: [
          { title: 'MagguuUI', description: 'Releases, Hilfe und Update-Pings', emoji: '🎨', channels: [c(CHANNEL.updates), c(CHANNEL.help)], roles: [r(ROLE.pingMagguuui)] },
          { title: 'Plex', description: 'Anfragen und neue Filme/Serien', emoji: '🎬', channels: [c(CHANNEL.requests), c(CHANNEL.newOnPlex)], roles: [r(ROLE.pingMovies), r(ROLE.pingSeries)] },
          { title: 'WoW', description: 'Blue-Posts, Hotfixes, PTR', emoji: '🎮', channels: [c(CHANNEL.blizzard)], roles: [r(ROLE.pingWow)] },
        ],
      },
      {
        title: 'Welche Pings willst du?',
        singleSelect: false,
        required: false,
        options: [
          { title: 'Filme', description: 'Neue Filme', emoji: '🎬', channels: [], roles: [r(ROLE.pingMovies)] },
          { title: 'Serien', description: 'Neue Episoden', emoji: '📺', channels: [], roles: [r(ROLE.pingSeries)] },
          { title: '4K & Anime', description: '2160p-Releases und Anime', emoji: '✨', channels: [], roles: [r(ROLE.pingExtras)] },
          { title: 'Ankündigungen', description: 'Server-News', emoji: '📢', channels: [], roles: [r(ROLE.pingAnnouncements)] },
        ],
      },
    ],
  };
}

export function desiredWelcomeScreen(ch: Record<string, Ref>): WelcomeScreenSpec {
  const c = (name: string): Ref => ch[name] as Ref;
  return {
    description: 'Magguu Homelab: MagguuUI, Plex und Community.',
    channels: [
      { channel: c(CHANNEL.welcome), description: 'Regeln und Ping-Rollen', emoji: '👋' },
      { channel: c(CHANNEL.help), description: 'Fragen zu MagguuUI', emoji: '❓' },
      { channel: c(CHANNEL.updates), description: 'MagguuUI-Releases', emoji: '📰' },
      { channel: c(CHANNEL.requests), description: 'Film oder Serie anfragen', emoji: '📝' },
      { channel: c(CHANNEL.chat), description: 'Einfach quatschen', emoji: '💬' },
    ],
  };
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
}

export function onboardingMatches(live: GuildSnapshot['onboarding'], wanted: OnboardingSpec): boolean {
  if (!live?.enabled) return false;
  if (wanted.defaultChannels.some(isNewRef)) return false;
  return sameSet(live.defaultChannelIds, wanted.defaultChannels)
    && live.promptTitles.join('|') === wanted.prompts.map((p) => p.title).join('|');
}

export function welcomeScreenMatches(live: GuildSnapshot['welcomeScreen'], wanted: WelcomeScreenSpec): boolean {
  if (!live) return false;
  return live.description === wanted.description
    && live.channelIds.join('|') === wanted.channels.map((c) => c.channel).join('|');
}

// ─── Deletion planning (separate, gated step) ─────────────────────────────

export interface DeletionPlan {
  channels: Array<{ id: string; name: string }>;
  skippedChannels: Array<{ id: string; name: string; reasons: string[] }>;
  categories: Array<{ id: string; name: string }>;
  roles: Array<{ id: string; name: string }>;
  skippedRoles: Array<{ id: string; name: string; reason: string }>;
}

/**
 * Delete only what the rollout archived: channels inside 🗄️ ARCHIV that no
 * open bot card / DB reference still points to, legacy categories that are
 * empty afterwards, and empty roles that are not part of the layout.
 */
export function planDeletion(
  snap: GuildSnapshot,
  blockers: Record<string, string[]>,
): DeletionPlan {
  const plan: DeletionPlan = { channels: [], skippedChannels: [], categories: [], roles: [], skippedRoles: [] };
  const archive = snap.channels.find((c) => c.type === CHANNEL_TYPE.category && c.name === ARCHIVE_CATEGORY_NAME);
  const deleted = new Set<string>();
  if (archive) {
    for (const ch of snap.channels.filter((c) => c.parent_id === archive.id)) {
      const reasons = blockers[ch.id] ?? [];
      if (reasons.length) plan.skippedChannels.push({ id: ch.id, name: ch.name, reasons });
      else {
        plan.channels.push({ id: ch.id, name: ch.name });
        deleted.add(ch.id);
      }
    }
  }
  for (const cat of snap.channels.filter((c) => c.type === CHANNEL_TYPE.category)) {
    if (LAYOUT_CATEGORY_NAMES.has(cat.name)) continue;
    if (PROTECTED_CATEGORY_NAMES.has(cat.name) && cat.name !== ARCHIVE_CATEGORY_NAME) continue;
    if ((blockers[cat.id] ?? []).length) continue;
    const children = snap.channels.filter((c) => c.parent_id === cat.id && !deleted.has(c.id));
    if (children.length === 0) plan.categories.push({ id: cat.id, name: cat.name });
  }
  const layoutRoleNames = new Set(ROLES.map((r) => r.name));
  for (const role of snap.roles) {
    if (role.managed || role.id === snap.guildId || layoutRoleNames.has(role.name)) continue;
    if (ROLES.some((r) => r.oldNames?.includes(role.name))) {
      plan.skippedRoles.push({ id: role.id, name: role.name, reason: 'wird erst umbenannt (--apply zuerst)' });
      continue;
    }
    if (role.position >= snap.botHighestRolePosition) {
      plan.skippedRoles.push({ id: role.id, name: role.name, reason: 'über der Bot-Rolle' });
      continue;
    }
    if (!snap.members) {
      plan.skippedRoles.push({ id: role.id, name: role.name, reason: 'Mitgliederzahl unbekannt' });
      continue;
    }
    const count = Object.values(snap.members).filter((roles) => roles.includes(role.id)).length;
    if (count > 0) {
      plan.skippedRoles.push({ id: role.id, name: role.name, reason: `${count} Mitglied(er)` });
      continue;
    }
    if ((blockers[role.id] ?? []).length) {
      plan.skippedRoles.push({ id: role.id, name: role.name, reason: (blockers[role.id] ?? []).join(', ') });
      continue;
    }
    plan.roles.push({ id: role.id, name: role.name });
  }
  return plan;
}

// ─── Simulation (dry-run "after" view and idempotency tests) ──────────────

/** Apply actions to a snapshot copy the way Discord would. New ids are `sim-<n>`. */
export function simulate(snap: GuildSnapshot, actions: Action[]): GuildSnapshot {
  const next: GuildSnapshot = JSON.parse(JSON.stringify(snap)) as GuildSnapshot;
  const ids = new Map<Ref, string>();
  let n = 0;
  const resolve = (ref: Ref): string => (isNewRef(ref) ? ids.get(ref) ?? ref : ref);
  const toLive = (list: OverwriteSpec[]): SnapOverwrite[] =>
    list.map((o) => ({ id: resolve(o.target), type: o.type, allow: o.allow, deny: o.deny }));
  for (const a of actions) {
    switch (a.kind) {
      case 'createRole': {
        const id = `sim-${++n}`;
        ids.set(a.ref, id);
        next.roles.push({ id, name: a.plan.name, color: a.plan.color, position: 1, permissions: a.plan.permissions, managed: false, hoist: a.plan.hoist ?? false, mentionable: a.plan.mentionable ?? false });
        break;
      }
      case 'updateRole': {
        if (a.blocked) break;
        const role = next.roles.find((r) => r.id === a.id);
        if (!role) break;
        if (a.changes.name) role.name = a.changes.name;
        if (a.changes.permissions !== undefined) role.permissions = a.changes.permissions;
        if (a.changes.mentionable !== undefined) role.mentionable = a.changes.mentionable;
        break;
      }
      case 'createCategory':
      case 'createChannel': {
        const id = `sim-${++n}`;
        ids.set(a.ref, id);
        next.channels.push({
          id,
          name: a.name,
          type: a.kind === 'createCategory' ? CHANNEL_TYPE.category : a.type,
          parent_id: a.kind === 'createChannel' ? resolve(a.parent) : null,
          position: 99,
          topic: a.kind === 'createChannel' ? a.topic ?? null : null,
          permission_overwrites: toLive(a.overwrites),
        });
        break;
      }
      case 'updateChannel': {
        const ch = next.channels.find((c) => c.id === a.id);
        if (!ch) break;
        if (a.changes.name) ch.name = a.changes.name;
        if (a.changes.parent) ch.parent_id = resolve(a.changes.parent);
        if (a.changes.topic !== undefined) ch.topic = a.changes.topic;
        if (a.changes.overwrites) ch.permission_overwrites = toLive(a.changes.overwrites);
        break;
      }
      case 'archiveChannel': {
        const ch = next.channels.find((c) => c.id === a.id);
        if (!ch) break;
        ch.parent_id = resolve(a.archive);
        ch.permission_overwrites = toLive(a.overwrites);
        break;
      }
      case 'hideCategory': {
        const ch = next.channels.find((c) => c.id === a.id);
        if (ch) ch.permission_overwrites = toLive(a.overwrites);
        break;
      }
      case 'migrateMembers': {
        if (!next.members) break;
        for (const userId of a.userIds) next.members[userId]?.push(resolve(a.toRole));
        break;
      }
      case 'setChannelKey':
        next.channelConfig[a.key] = resolve(a.target);
        break;
      case 'setAutoRole':
        next.autoRoleSetting = resolve(a.target);
        break;
      case 'enableCommunity':
        if (!next.features.includes('COMMUNITY')) next.features.push('COMMUNITY');
        next.rulesChannelId = resolve(a.rules);
        next.publicUpdatesChannelId = resolve(a.updates);
        next.verificationLevel = a.verificationLevel;
        next.explicitContentFilter = a.explicitContentFilter;
        break;
      case 'putOnboarding':
        next.onboarding = {
          enabled: true,
          promptTitles: a.spec.prompts.map((p) => p.title),
          defaultChannelIds: a.spec.defaultChannels.map(resolve),
        };
        break;
      case 'putWelcomeScreen':
        next.welcomeScreen = { description: a.spec.description, channelIds: a.spec.channels.map((c) => resolve(c.channel)) };
        break;
      case 'reorder':
        for (const item of a.items) {
          const ch = next.channels.find((c) => c.id === resolve(item.ref));
          if (ch) ch.position = item.position;
        }
        break;
    }
  }
  return next;
}

/** One human-readable line per action (German, for the text report). */
export function describeAction(a: Action): string {
  switch (a.kind) {
    case 'createRole': return `Rolle anlegen: ${a.plan.name}`;
    case 'updateRole': return `Rolle ${a.current}: ${describeRoleChanges(a.changes)}${a.blocked ? ' (BLOCKIERT: manuell)' : ''}`;
    case 'createCategory': return `Kategorie anlegen: ${a.name}`;
    case 'createChannel': return `Kanal anlegen: ${a.type === CHANNEL_TYPE.voice ? '🔊' : '#'}${a.name}`;
    case 'updateChannel': return `${a.current}: ${a.why.join(', ')}`;
    case 'archiveChannel': return `archivieren: ${a.name}${a.from ? ` (aus ${a.from})` : ''} → ${ARCHIVE_CATEGORY_NAME}`;
    case 'hideCategory': return `leere Alt-Kategorie verstecken: ${a.name}`;
    case 'migrateMembers': return `Mitglieder ${a.fromRole} → ${a.toName}: ${a.userIds.length}`;
    case 'setChannelKey': return `Bot-Key ${a.key} → ${a.targetName}`;
    case 'setAutoRole': return `autoRoleId → Newcomer (vorher ${a.previous ?? '–'})`;
    case 'enableCommunity': return 'Community aktivieren (Regeln: 👋・willkommen, Updates: 🩺・status, Verifizierung ≥ niedrig, Filter: alle)';
    case 'putOnboarding': return `Onboarding: ${a.spec.prompts.length} Fragen, ${a.spec.defaultChannels.length} Standardkanäle`;
    case 'putWelcomeScreen': return `Welcome Screen: ${a.spec.channels.length} Kanäle`;
    case 'reorder': return `Reihenfolge: ${a.items.length} Positionen`;
  }
}
