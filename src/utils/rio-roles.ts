/**
 * Raider.IO score roles on request: pure helpers (threshold parsing/validation, tier choice, role change plan,
 * input normalisation). No Discord, no network, no DB - see src/discord/rio-roles.ts for the wiring.
 */

import { PermissionFlagsBits } from 'discord.js';
import { clipPlexText, escapePlexMarkdown } from './plex-card.js';

export interface RioTier {
  minScore: number;
  roleId: string;
}

export const RIO_REGIONS = ['eu', 'us', 'kr', 'tw', 'cn'] as const;
export type RioRegion = (typeof RIO_REGIONS)[number];

const SNOWFLAKE = /^\d{17,20}$/;
export const RIO_MAX_SCORE = 10_000;
export const RIO_MAX_TIERS = 15;

// ─── role safety ────────────────────────────────────────────────────────────

/**
 * Permission bits a score role must NEVER carry. A score role is a display role without rights: if an admin picks a
 * moderator/admin role by mistake (or the role gains such a bit later), the bot must not hand it out. Anything that
 * manages the server, moderates members, pings everyone or reads internal logs is on the list.
 */
export const RIO_FORBIDDEN_PERMISSION_NAMES = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageMessages',
  'ManageThreads',
  'ManageWebhooks',
  'ManageNicknames',
  'ManageEvents',
  'ManageGuildExpressions',
  'KickMembers',
  'BanMembers',
  'ModerateMembers',
  'MuteMembers',
  'DeafenMembers',
  'MoveMembers',
  'MentionEveryone',
  'ViewAuditLog',
  'ViewGuildInsights',
  'ViewCreatorMonetizationAnalytics',
  'PinMessages',
  'BypassSlowmode',
] as const satisfies readonly (keyof typeof PermissionFlagsBits)[];

export const RIO_FORBIDDEN_PERMISSIONS: bigint = RIO_FORBIDDEN_PERMISSION_NAMES.reduce(
  (all, name) => all | PermissionFlagsBits[name],
  0n,
);

/**
 * Allowlist (the real gate): the only permission bits a score role may carry are the harmless ones every ordinary
 * member has anyway (read, write, react, voice participation, own nickname, slash commands, ...). A role is safe only
 * when ALL of its bits are in this set, so a permission Discord adds in the future is refused until someone reviews
 * and lists it here. `permissions == 0` (the recommended shape) is always safe. The forbidden list above stays as the
 * explicit "never" list: it names the worst offenders in the refusal text and a test pins that the two never overlap.
 * Deliberately NOT listed: TTS, priority speaker, create events / expressions, everything that manages or moderates.
 */
export const RIO_ALLOWED_PERMISSION_NAMES = [
  'CreateInstantInvite',
  'ViewChannel',
  'SendMessages',
  'SendMessagesInThreads',
  'CreatePublicThreads',
  'CreatePrivateThreads',
  'EmbedLinks',
  'AttachFiles',
  'AddReactions',
  'UseExternalEmojis',
  'UseExternalStickers',
  'ReadMessageHistory',
  'UseApplicationCommands',
  'UseExternalApps',
  'SendPolls',
  'SendVoiceMessages',
  'Connect',
  'Speak',
  'Stream',
  'UseVAD',
  'UseEmbeddedActivities',
  'UseSoundboard',
  'UseExternalSounds',
  'RequestToSpeak',
  'ChangeNickname',
] as const satisfies readonly (keyof typeof PermissionFlagsBits)[];

export const RIO_ALLOWED_PERMISSIONS: bigint = RIO_ALLOWED_PERMISSION_NAMES.reduce(
  (all, name) => all | PermissionFlagsBits[name],
  0n,
);

/** Names of the bits in `bits` that are NOT on the allowlist (known flag name, else `Bit<n>` for a bit this build does not know). */
export function disallowedPermissionNames(bits: bigint): string[] {
  const out: string[] = [];
  const known = Object.entries(PermissionFlagsBits) as Array<[string, bigint]>;
  for (let n = 0; n < 64; n += 1) {
    const bit = 1n << BigInt(n);
    if ((bits & bit) === 0n || (RIO_ALLOWED_PERMISSIONS & bit) !== 0n) continue;
    out.push(known.find(([, v]) => v === bit)?.[0] ?? `Bit${n}`);
  }
  return out;
}

/** Names of the forbidden bits set in `bits`. */
export function forbiddenPermissionNames(bits: bigint): string[] {
  return RIO_FORBIDDEN_PERMISSION_NAMES.filter((name) => (bits & PermissionFlagsBits[name]) !== 0n);
}

/** The bitfield of a role as discord.js (PermissionsBitField), the API (decimal string) or a bigint; null = unreadable. */
export function rolePermissionBits(permissions: unknown): bigint | null {
  if (typeof permissions === 'bigint') return permissions;
  if (typeof permissions === 'string' && /^\d{1,20}$/.test(permissions)) return BigInt(permissions);
  if (permissions && typeof permissions === 'object' && 'bitfield' in permissions) {
    const field = (permissions as { bitfield: unknown }).bitfield;
    if (typeof field === 'bigint') return field;
  }
  return null;
}

export type ScoreRoleVerdict =
  | { ok: true }
  | { ok: false; category: 'everyone' | 'managed' | 'dangerous' | 'unreadable'; permissions: string[] };

/**
 * Can this role be a score role? Fail closed: @everyone, managed roles (bot, integration, booster), a role carrying
 * ANY permission bit outside the allowlist (so also every forbidden bit and every bit Discord adds later) and a role
 * whose permissions cannot be read are all refused.
 */
export function checkScoreRole(
  role: { id: string; managed?: boolean; permissions?: unknown },
  guildId: string,
): ScoreRoleVerdict {
  if (role.id === guildId) return { ok: false, category: 'everyone', permissions: [] };
  if (role.managed !== false) return { ok: false, category: 'managed', permissions: [] };
  const bits = rolePermissionBits(role.permissions);
  if (bits === null) return { ok: false, category: 'unreadable', permissions: [] };
  // allowlist: anything outside it is refused; the explicitly forbidden bits are listed first
  const rest = disallowedPermissionNames(bits);
  if (rest.length > 0) {
    const worst = forbiddenPermissionNames(bits);
    return { ok: false, category: 'dangerous', permissions: [...worst, ...rest.filter((n) => !worst.includes(n))] };
  }
  return { ok: true };
}

/** German reason (no permission list for members, only the category). */
export function scoreRoleRefusal(verdict: Extract<ScoreRoleVerdict, { ok: false }>, detailed: boolean): string {
  switch (verdict.category) {
    case 'everyone': return '@everyone kann keine Score-Rolle sein';
    case 'managed': return 'die Rolle wird von einer Integration, einem Bot oder dem Server-Boost verwaltet';
    case 'unreadable': return 'ich kann die Rechte der Rolle nicht lesen';
    case 'dangerous': return detailed
      ? `die Rolle hat Moderations-/Admin-Rechte (${verdict.permissions.join(', ')})`
      : 'die Rolle hat Moderations-/Admin-Rechte';
  }
}

export interface ParsedTiers {
  tiers: RioTier[];
  /** Human-readable problems; invalid entries are dropped, the rest stays usable. */
  problems: string[];
}

/** Scores are stored and compared with one decimal (the same rounding wherever a threshold is created or looked up). */
export function roundRioScore(score: number): number {
  return Math.round(score * 10) / 10;
}

/** Untrusted text (API names, realm, season, admin label) for Discord markdown: one line, clipped, mentions/markdown inert. */
export function rioText(value: string | null | undefined, max = 60): string {
  return escapePlexMarkdown(clipPlexText(value, max));
}

function normaliseTier(minScore: unknown, roleId: unknown, problems: string[], label: string): RioTier | null {
  const score = typeof minScore === 'number' ? minScore : typeof minScore === 'string' && minScore.trim() !== '' ? Number(minScore.trim()) : NaN;
  const role = typeof roleId === 'string' ? roleId.trim() : typeof roleId === 'number' ? String(roleId) : '';
  if (!Number.isFinite(score) || score < 0 || score > RIO_MAX_SCORE) {
    problems.push(`${label}: ungültiger Score`);
    return null;
  }
  if (!SNOWFLAKE.test(role)) {
    problems.push(`${label}: ungültige Rollen-ID`);
    return null;
  }
  return { minScore: roundRioScore(score), roleId: role };
}

/**
 * `RIO_ROLE_THRESHOLDS` accepts a JSON array `[{"minScore":1000,"roleId":"123..."}]` or the short form
 * `1000=123...,2000=456...`. Result: ascending by score, one entry per score (the last one wins), at most
 * `RIO_MAX_TIERS`. Empty/blank input = no tiers (feature not set up).
 */
export function parseRioThresholds(raw: string | null | undefined): ParsedTiers {
  const text = (raw ?? '').trim();
  const problems: string[] = [];
  const found: RioTier[] = [];
  if (!text) return { tiers: [], problems };

  if (text.startsWith('[') || text.startsWith('{')) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { tiers: [], problems: ['kein gültiges JSON'] };
    }
    if (!Array.isArray(data)) return { tiers: [], problems: ['JSON muss eine Liste sein'] };
    data.forEach((item, index) => {
      const rec = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const tier = normaliseTier(rec.minScore, rec.roleId, problems, `Eintrag ${index + 1}`);
      if (tier) found.push(tier);
    });
  } else {
    text.split(',').map((p) => p.trim()).filter(Boolean).forEach((part, index) => {
      const [score, role, ...rest] = part.split('=');
      if (role === undefined || rest.length > 0) {
        problems.push(`Eintrag ${index + 1}: erwartet score=roleId`);
        return;
      }
      const tier = normaliseTier(score, role, problems, `Eintrag ${index + 1}`);
      if (tier) found.push(tier);
    });
  }

  const byScore = new Map<number, RioTier>();
  for (const t of found) byScore.set(t.minScore, t);
  let tiers = [...byScore.values()].sort((a, b) => a.minScore - b.minScore);
  if (tiers.length > RIO_MAX_TIERS) {
    problems.push(`mehr als ${RIO_MAX_TIERS} Schwellen, der Rest wird ignoriert`);
    tiers = tiers.slice(0, RIO_MAX_TIERS);
  }
  return { tiers, problems };
}

/** Canonical short form, parseable again by `parseRioThresholds`. */
export function serializeRioThresholds(tiers: readonly RioTier[]): string {
  return [...tiers].sort((a, b) => a.minScore - b.minScore).map((t) => `${t.minScore}=${t.roleId}`).join(',');
}

/** Highest tier whose minimum the score reaches; `null` below the lowest tier. */
export function tierForScore(tiers: readonly RioTier[], score: number): RioTier | null {
  let best: RioTier | null = null;
  for (const t of tiers) if (score >= t.minScore && (!best || t.minScore >= best.minScore)) best = t;
  return best;
}

export interface RolePlan {
  /** Role that matches the score (or null below the lowest tier). */
  target: string | null;
  /** Role to add: the target when the member does not hold it yet. */
  add: string | null;
  /** The bot-assigned role that is no longer right and still held: remove (never a role the bot did not give). */
  remove: string | null;
  /** The role the bot is responsible for after this change (stored as `last_role_id`). */
  botRole: string | null;
}

/**
 * Role change for one member. Only the role the bot assigned earlier (`lastRoleId`) may ever be removed.
 * A target the member already holds without the bot having given it is left alone and not claimed.
 */
export function planRoleChange(input: {
  tiers: readonly RioTier[];
  score: number;
  memberRoleIds: ReadonlySet<string>;
  lastRoleId: string | null;
}): RolePlan {
  const target = tierForScore(input.tiers, input.score)?.roleId ?? null;
  const last = input.lastRoleId;
  const holdsTarget = target !== null && input.memberRoleIds.has(target);
  const add = target !== null && !holdsTarget ? target : null;
  const remove = last !== null && last !== target && input.memberRoleIds.has(last) ? last : null;
  let botRole: string | null;
  if (target === null) botRole = null;
  else if (add !== null) botRole = target;
  else botRole = last === target ? target : null;
  return { target, add, remove, botRole };
}

// ─── input ──────────────────────────────────────────────────────────────────

export interface RioCharacterInput {
  name: string;
  realm: string;
  region: RioRegion;
}

export type RioInputResult = { ok: true; value: RioCharacterInput } | { ok: false; reason: string };

/** Characters: 2-12 letters (any alphabet); realms: letters/digits/space/apostrophe/hyphen/parentheses, up to 40. */
export function normaliseRioInput(name: string, realm: string, region: string): RioInputResult {
  const n = name.normalize('NFC').trim();
  const r = realm.normalize('NFC').trim().replace(/\s+/g, ' ');
  const reg = region.trim().toLowerCase();
  if (!(RIO_REGIONS as readonly string[]).includes(reg)) return { ok: false, reason: `Region muss eine von ${RIO_REGIONS.join(', ')} sein.` };
  if (!/^\p{L}{2,12}$/u.test(n)) return { ok: false, reason: 'Der Charaktername muss aus 2 bis 12 Buchstaben bestehen.' };
  if (r.length < 2 || r.length > 40 || !/^[\p{L}\p{N} '\-()]+$/u.test(r)) return { ok: false, reason: 'Der Realm-Name ist ungültig.' };
  return { ok: true, value: { name: n, realm: r, region: reg as RioRegion } };
}

export function rioCacheKey(c: RioCharacterInput): string {
  return `${c.region}/${c.realm.toLowerCase()}/${c.name.toLowerCase()}`;
}
