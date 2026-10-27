/**
 * Shared, pure model for the role tooling (backup / inventory / apply / restore).
 * No network, no database: everything here is unit-tested against fixtures in tests/roles-tools.test.ts.
 *
 * Privacy: a RolesSnapshot carries member → role lists (needed for counts, merges and the backup FILE). Nothing
 * in this module prints them; the CLIs only ever print counters and role/channel names.
 */
import { createHash } from 'node:crypto';

// ─── Permission bits (Discord API v10) ────────────────────────────────────
export const P = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  CONNECT: 1n << 20n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_GUILD_EXPRESSIONS: 1n << 30n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  MODERATE_MEMBERS: 1n << 40n,
} as const;

export type PermName = keyof typeof P;

export const ALL_PERMISSIONS = (1n << 51n) - 1n;

/** Bits that deserve a flag in the inventory ("gefährlich"). */
export const DANGEROUS_PERMS: readonly PermName[] = [
  'ADMINISTRATOR', 'MANAGE_GUILD', 'MANAGE_ROLES', 'MANAGE_CHANNELS', 'MANAGE_WEBHOOKS', 'KICK_MEMBERS', 'BAN_MEMBERS',
  'MENTION_EVERYONE', 'MANAGE_MESSAGES', 'MODERATE_MEMBERS', 'MANAGE_NICKNAMES', 'MANAGE_GUILD_EXPRESSIONS',
  'VIEW_AUDIT_LOG', 'MANAGE_THREADS', 'MANAGE_EVENTS',
];

/** Only these may ever be removed from @everyone by the tooling (never VIEW/SEND/READ …). */
export const EVERYONE_REMOVABLE: ReadonlySet<PermName> = new Set<PermName>([...DANGEROUS_PERMS, 'CREATE_INSTANT_INVITE']);

/** What the bot needs in every channel it posts to. */
export const BOT_POST_REQUIRED = P.VIEW_CHANNEL | P.SEND_MESSAGES | P.EMBED_LINKS | P.READ_MESSAGE_HISTORY;
export const BOT_CHANNEL_ALLOW =
  P.VIEW_CHANNEL | P.SEND_MESSAGES | P.EMBED_LINKS | P.ATTACH_FILES | P.READ_MESSAGE_HISTORY | P.MANAGE_MESSAGES | P.ADD_REACTIONS;

/** Bits a guarded member (bot, owner, admins, staff) must never lose. */
export const CRITICAL_PERMS =
  P.ADMINISTRATOR | P.MANAGE_GUILD | P.MANAGE_ROLES | P.MANAGE_CHANNELS | P.MANAGE_MESSAGES | P.KICK_MEMBERS | P.BAN_MEMBERS
  | P.MODERATE_MEMBERS | P.VIEW_AUDIT_LOG | P.VIEW_CHANNEL | P.SEND_MESSAGES;

export function permNames(bits: bigint, among: readonly PermName[] = Object.keys(P) as PermName[]): PermName[] {
  return among.filter((n) => (bits & P[n]) !== 0n);
}

export function parsePermNames(names: readonly string[]): bigint {
  let bits = 0n;
  for (const n of names) {
    if (!(n in P)) throw new Error(`Unbekannte Berechtigung: ${n}`);
    bits |= P[n as PermName];
  }
  return bits;
}

// ─── Snapshot ─────────────────────────────────────────────────────────────
export interface RoleRec {
  id: string;
  name: string;
  position: number;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  /** Decimal string. */
  permissions: string;
  managed: boolean;
  flags: number;
  unicodeEmoji: string | null;
  /** Managed-role origin (bot/integration) when Discord reports tags. */
  tags: { botId?: string; integrationId?: string; premiumSubscriber?: boolean } | null;
}

export interface OverwriteRec {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
}

export interface ChannelRec {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
  position: number;
  overwrites: OverwriteRec[];
}

export interface RolesSnapshot {
  guildId: string;
  ownerId: string | null;
  botUserId: string;
  botHighestRolePosition: number;
  roles: RoleRec[];
  channels: ChannelRec[];
  /** userId → role ids. `null` = member list unreadable. NEVER print this. */
  members: Record<string, string[]> | null;
  notes: string[];
  /**
   * Channel ids the bot's own database points at that are missing from the HTTP channel list. Since 2026-11-16
   * Discord omits channels without VIEW_CHANNEL there; > 0 means the snapshot is incomplete and apply refuses.
   */
  missingKnownChannels?: number;
}

export const CATEGORY_TYPE = 4;

export function cloneSnapshot(s: RolesSnapshot): RolesSnapshot {
  return {
    ...s,
    roles: s.roles.map((r) => ({ ...r, tags: r.tags ? { ...r.tags } : null })),
    channels: s.channels.map((c) => ({ ...c, overwrites: c.overwrites.map((o) => ({ ...o })) })),
    members: s.members ? Object.fromEntries(Object.entries(s.members).map(([k, v]) => [k, [...v]])) : null,
    notes: [...s.notes],
  };
}

// ─── Effective permissions (Discord's documented algorithm) ───────────────
function roleById(snap: RolesSnapshot, id: string): RoleRec | undefined {
  return snap.roles.find((r) => r.id === id);
}

export function basePermissions(snap: RolesSnapshot, userId: string, rolesOverride?: readonly string[]): bigint {
  if (snap.ownerId === userId) return ALL_PERMISSIONS;
  const everyone = roleById(snap, snap.guildId);
  let bits = BigInt(everyone?.permissions ?? '0');
  for (const id of rolesOverride ?? snap.members?.[userId] ?? []) {
    const r = roleById(snap, id);
    if (r) bits |= BigInt(r.permissions);
  }
  return (bits & P.ADMINISTRATOR) !== 0n ? ALL_PERMISSIONS : bits;
}

export function channelPermissions(snap: RolesSnapshot, channel: ChannelRec, userId: string, rolesOverride?: readonly string[]): bigint {
  const base = basePermissions(snap, userId, rolesOverride);
  if ((base & P.ADMINISTRATOR) !== 0n || snap.ownerId === userId) return ALL_PERMISSIONS;
  let bits = base;
  const everyoneOw = channel.overwrites.find((o) => o.id === snap.guildId);
  if (everyoneOw) bits = (bits & ~BigInt(everyoneOw.deny)) | BigInt(everyoneOw.allow);
  const roleIds = new Set(rolesOverride ?? snap.members?.[userId] ?? []);
  let allow = 0n;
  let deny = 0n;
  for (const o of channel.overwrites) {
    if (o.type === 0 && o.id !== snap.guildId && roleIds.has(o.id)) {
      allow |= BigInt(o.allow);
      deny |= BigInt(o.deny);
    }
  }
  bits = (bits & ~deny) | allow;
  const member = channel.overwrites.find((o) => o.type === 1 && o.id === userId);
  if (member) bits = (bits & ~BigInt(member.deny)) | BigInt(member.allow);
  // No VIEW_CHANNEL → nothing else counts.
  return (bits & P.VIEW_CHANNEL) === 0n ? 0n : bits;
}

/** Same algorithm for a synthetic role set (visibility matrix): `roleIds` instead of a real member. */
export function permissionsForRoles(snap: RolesSnapshot, channel: ChannelRec | null, roleIds: readonly string[]): bigint {
  const fake = '__synthetic__';
  const s = { ...snap, ownerId: null };
  return channel ? channelPermissions(s, { ...channel, overwrites: channel.overwrites.filter((o) => o.type === 0) }, fake, roleIds) : basePermissions(s, fake, roleIds);
}

export const canView = (snap: RolesSnapshot, ch: ChannelRec, userId: string): boolean =>
  (channelPermissions(snap, ch, userId) & P.VIEW_CHANNEL) !== 0n;

// ─── Roles helpers ────────────────────────────────────────────────────────
export function memberCounts(snap: RolesSnapshot): Map<string, number> | null {
  if (!snap.members) return null;
  const counts = new Map<string, number>();
  for (const roles of Object.values(snap.members)) for (const id of roles) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

export function membersOf(snap: RolesSnapshot, roleId: string): string[] {
  return snap.members ? Object.entries(snap.members).filter(([, roles]) => roles.includes(roleId)).map(([id]) => id) : [];
}

export function botRoleIds(snap: RolesSnapshot): string[] {
  return snap.members?.[snap.botUserId] ?? [];
}

/** Number of channels that carry a non-empty overwrite for this role (a role with overwrites is "in use"). */
export function overwriteTargetsUsed(snap: RolesSnapshot, roleId: string): number {
  return snap.channels.filter((c) => c.overwrites.some((o) => o.type === 0 && o.id === roleId && (o.allow !== '0' || o.deny !== '0'))).length;
}

// ─── Fingerprint / checksum ───────────────────────────────────────────────
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, sort(x)]));
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Hash of everything roles/overwrites/channels-structure; members are deliberately excluded (they change all day). */
export function stateFingerprint(snap: RolesSnapshot): string {
  const roles = [...snap.roles].sort((a, b) => (a.id < b.id ? -1 : 1));
  const channels = [...snap.channels]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((c) => ({ ...c, overwrites: [...c.overwrites].sort((a, b) => (a.id < b.id ? -1 : 1)).map((o) => ({ ...o, allow: BigInt(o.allow).toString(), deny: BigInt(o.deny).toString() })) }));
  return sha256(canonicalJson({ roles: roles.map((r) => ({ ...r, permissions: BigInt(r.permissions).toString() })), channels }));
}

export const SNOWFLAKE = /^\d{17,20}$/;
