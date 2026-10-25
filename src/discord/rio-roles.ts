import { PermissionFlagsBits } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { botSettings, rioLink } from '../db/schema.js';
import { fetchRioScore, type RioFailure, type RioResult } from '../services/raiderio.js';
import { logger } from '../utils/logger.js';
import {
  checkScoreRole,
  parseRioThresholds,
  planRoleChange,
  scoreRoleRefusal,
  serializeRioThresholds,
  type ParsedTiers,
  rioText,
  type RioCharacterInput,
  type RioTier,
} from '../utils/rio-roles.js';

/**
 * Raider.IO score roles on request. Voluntary: a member runs /rio-link, the bot reads the public Raider.IO score
 * once and gives the matching score role; /rio-unlink (or leaving the server) removes the mapping again. No
 * Battle.net OAuth, no background sync, nothing is created on the server (roles must exist, the bot only assigns).
 */

/** Numeric Discord API error code of a thrown error (kept local: this module must stay free of client imports). */
function discordErrorCode(err: unknown): number | null {
  if (!err || typeof err !== 'object' || !('code' in err)) return null;
  const code = (err as { code: unknown }).code;
  return typeof code === 'number' ? code : null;
}

// ─── thresholds (env, overridable by /rio-config; stored in bot_settings) ───

const KEY_TIERS = 'rioRoleThresholds';
const KEY_SEASON = 'rioSeasonLabel';

function readSetting(key: string): string | null {
  const row = db.select().from(botSettings)
    .where(and(eq(botSettings.guildId, config.DISCORD_GUILD_ID), eq(botSettings.key, key))).get();
  return row ? row.value : null;
}

function writeSetting(key: string, value: string): void {
  db.insert(botSettings).values({ guildId: config.DISCORD_GUILD_ID, key, value })
    .onConflictDoUpdate({ target: [botSettings.guildId, botSettings.key], set: { value, updatedAt: new Date() } }).run();
}

/**
 * Roles the startup audit refused (dangerous permission bits, @everyone, managed): roleId -> category. They are
 * filtered out of every tier list for the rest of the process. Only ids and categories, nothing else is kept.
 */
const refusedRoles = new Map<string, string>();

/** The configured tiers exactly as stored (env or /rio-config), WITHOUT the in-memory refusal filter: what edits must start from. */
export function getRioTiersUnfiltered(): ParsedTiers {
  const stored = readSetting(KEY_TIERS);
  return parseRioThresholds(stored !== null ? stored : config.RIO_ROLE_THRESHOLDS);
}

/** Forget a startup refusal (the role passed a live check, e.g. `/rio-config setzen` right now). */
export function clearRioRefusal(roleId: string): void {
  refusedRoles.delete(roleId);
}

/** Category the startup audit refused this role for, or null. */
export function rioRefusalCategory(roleId: string): string | null {
  return refusedRoles.get(roleId) ?? null;
}

/** A stored value (even an empty list) overrides the env; no stored value = env. */
export function getRioTiers(): ParsedTiers {
  const stored = readSetting(KEY_TIERS);
  const parsed = parseRioThresholds(stored !== null ? stored : config.RIO_ROLE_THRESHOLDS);
  if (refusedRoles.size === 0) return parsed;
  const problems = [...parsed.problems];
  const tiers = parsed.tiers.filter((t) => {
    const category = refusedRoles.get(t.roleId);
    if (category) problems.push(`Rolle ${t.roleId} wird nicht genutzt (${category})`);
    return !category;
  });
  return { tiers, problems };
}

/**
 * At startup: every configured tier role (env or /rio-config) is checked against the guild. Roles that are
 * @everyone, managed or carry moderation/admin bits are dropped from the tier list (warning with role id and
 * category only). A role that does not exist (or cannot be fetched) is left alone here; the assignment re-checks
 * it live and fails closed.
 */
export async function auditRioTiers(guild: Pick<RioGuildLike, 'id' | 'roles'>): Promise<{ checked: number; refused: Array<{ roleId: string; category: string }> }> {
  refusedRoles.clear();
  const parsed = getRioTiers();
  if (parsed.problems.length > 0) logger.warn({ problems: parsed.problems }, 'rio: invalid score role thresholds were dropped');
  const refused: Array<{ roleId: string; category: string }> = [];
  for (const tier of parsed.tiers) {
    let role: RioRoleLike | null;
    try {
      role = await loadRole(guild as RioGuildLike, tier.roleId);
    } catch (err) {
      logger.warn({ err, roleId: tier.roleId }, 'rio: could not check a score role at startup');
      continue;
    }
    if (!role) continue;
    const verdict = checkScoreRole(role, guild.id);
    if (!verdict.ok) {
      refusedRoles.set(tier.roleId, verdict.category);
      refused.push({ roleId: tier.roleId, category: verdict.category });
      logger.warn({ roleId: tier.roleId, category: verdict.category }, 'rio: score role refused at startup, it will not be assigned');
    }
  }
  return { checked: parsed.tiers.length, refused };
}

/** Test seam. */
export function resetRioRefusedRoles(): void {
  refusedRoles.clear();
  unsafeWarnedAt.clear();
}

/** One admin-facing warning per refused role and 24 h (a member retrying must not flood the log). */
const UNSAFE_WARN_EVERY_MS = 24 * 60 * 60_000;
const unsafeWarnedAt = new Map<string, number>();

/** Role id + category only: no user, character or permission list. Returns true when it logged. */
export function warnRioRoleUnsafeOnce(roleId: string, category: string, nowMs: number): boolean {
  const last = unsafeWarnedAt.get(roleId);
  if (last !== undefined && nowMs - last >= 0 && nowMs - last < UNSAFE_WARN_EVERY_MS) return false;
  unsafeWarnedAt.set(roleId, nowMs);
  logger.warn({ roleId, category }, 'rio: /rio-link refused a score role that is not a display role (admins: check /rio-config anzeigen)');
  return true;
}

export function saveRioTiers(tiers: readonly RioTier[]): void {
  writeSetting(KEY_TIERS, serializeRioThresholds(tiers));
}

export function getRioSeasonLabel(): string {
  const stored = readSetting(KEY_SEASON);
  return (stored !== null ? stored : config.RIO_SEASON_LABEL).trim();
}

export function saveRioSeasonLabel(label: string): void {
  writeSetting(KEY_SEASON, label.trim().slice(0, 40));
}

/** Back to the env values. */
export function resetRioConfig(): void {
  db.delete(botSettings).where(and(
    eq(botSettings.guildId, config.DISCORD_GUILD_ID),
    eq(botSettings.key, KEY_TIERS),
  )).run();
  db.delete(botSettings).where(and(
    eq(botSettings.guildId, config.DISCORD_GUILD_ID),
    eq(botSettings.key, KEY_SEASON),
  )).run();
}

// ─── mapping store ───

export interface RioLinkRow {
  guildId: string;
  userId: string;
  characterName: string;
  realm: string;
  region: string;
  lastScore: number;
  lastRoleId: string | null;
  updatedAt: number;
}

export interface RioStore {
  get(guildId: string, userId: string): RioLinkRow | null;
  upsert(row: RioLinkRow): void;
  delete(guildId: string, userId: string): boolean;
}

export const rioSqliteStore: RioStore = {
  get(guildId, userId) {
    const row = db.select().from(rioLink).where(and(eq(rioLink.guildId, guildId), eq(rioLink.userId, userId))).get();
    return row ? { ...row, updatedAt: row.updatedAt.getTime() } : null;
  },
  upsert(row) {
    const values = { ...row, updatedAt: new Date(row.updatedAt) };
    db.insert(rioLink).values(values).onConflictDoUpdate({ target: [rioLink.guildId, rioLink.userId], set: values }).run();
  },
  delete(guildId, userId) {
    const res = db.delete(rioLink).where(and(eq(rioLink.guildId, guildId), eq(rioLink.userId, userId))).run();
    return res.changes > 0;
  },
};

/** guildMemberRemove: the mapping goes with the member (the roles go with them). */
export function forgetRioLink(guildId: string, userId: string, store: RioStore = rioSqliteStore): boolean {
  return store.delete(guildId, userId);
}

// ─── cooldowns (per user, in memory) ───

export const RIO_LINK_COOLDOWN_MS = 60_000;
export const RIO_UNLINK_COOLDOWN_MS = 10_000;
const lastUse = new Map<string, number>();
const inFlight = new Set<string>();

/** Remaining seconds, or 0 when the user may run the command now (and starts the cooldown). */
export function takeRioCooldown(kind: 'link' | 'unlink', userId: string, now: number): number {
  const key = `${kind}:${userId}`;
  const wait = kind === 'link' ? RIO_LINK_COOLDOWN_MS : RIO_UNLINK_COOLDOWN_MS;
  const last = lastUse.get(key);
  if (last !== undefined && now - last < wait) return Math.ceil((wait - (now - last)) / 1000);
  lastUse.set(key, now);
  if (lastUse.size > 500) for (const [k, t] of lastUse) if (now - t > 10 * 60_000) lastUse.delete(k);
  return 0;
}

export function tryBeginRio(userId: string): boolean {
  if (inFlight.has(userId)) return false;
  inFlight.add(userId);
  return true;
}
export function endRio(userId: string): void {
  inFlight.delete(userId);
}

export function resetRioGuards(): void {
  lastUse.clear();
  inFlight.clear();
}

// ─── Discord surface (the slice we use; real discord.js objects satisfy it) ───

export interface RioRoleLike { id: string; name: string; managed: boolean; editable: boolean; permissions: unknown }
export interface RioMemberLike {
  roles: {
    cache: { has(id: string): boolean; keys(): IterableIterator<string> };
    add(roleId: string, reason?: string): Promise<unknown>;
    remove(roleId: string, reason?: string): Promise<unknown>;
  };
}
export interface RioGuildLike {
  id: string;
  members: {
    me: { permissions: { has(flag: bigint): boolean } } | null;
    fetch(userId: string): Promise<RioMemberLike>;
  };
  roles: { fetch(roleId: string): Promise<RioRoleLike | null> };
}

export type RioLinkOutcome =
  | { kind: 'not-configured' }
  | { kind: 'missing-manage-roles' }
  | { kind: 'role-missing'; roleId: string }
  | { kind: 'role-hierarchy'; roleId: string; roleName: string }
  | { kind: 'role-unsafe'; roleId: string; reason: string }
  | { kind: 'missing-permissions' }
  | { kind: 'member-missing' }
  | { kind: 'api-error'; failure: RioFailure }
  | {
      kind: 'linked';
      score: number;
      season: string | null;
      name: string;
      realm: string;
      region: string;
      profileUrl: string | null;
      roleId: string | null;
      added: boolean;
      removedRoleId: string | null;
      removeFailed: boolean;
      /** The new role was withheld because the previous one could not be removed. */
      addSkipped: boolean;
      nextTier: RioTier | null;
    };

export interface RioLinkDeps {
  guild: RioGuildLike;
  userId: string;
  input: RioCharacterInput;
  tiers: readonly RioTier[];
  store?: RioStore;
  fetchScore?: (c: RioCharacterInput) => Promise<RioResult>;
  now?: () => number;
}

async function loadRole(guild: RioGuildLike, roleId: string): Promise<RioRoleLike | null> {
  try {
    return await guild.roles.fetch(roleId);
  } catch (err) {
    if (discordErrorCode(err) === 10_011) return null; // Unknown Role
    throw err;
  }
}

/** /rio-link: look up the score, check every precondition, then (and only then) change roles and save the mapping. */
export async function linkRioCharacter(deps: RioLinkDeps): Promise<RioLinkOutcome> {
  const store = deps.store ?? rioSqliteStore;
  const now = deps.now ?? Date.now;
  const fetchScore = deps.fetchScore ?? ((c) => fetchRioScore(c));
  const { guild, userId } = deps;
  if (deps.tiers.length === 0) return { kind: 'not-configured' };
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) return { kind: 'missing-manage-roles' };

  const result = await fetchScore(deps.input);
  if (!result.ok) return { kind: 'api-error', failure: result };

  let member: RioMemberLike;
  try {
    member = await guild.members.fetch(userId);
  } catch (err) {
    if (discordErrorCode(err) === 10_007) return { kind: 'member-missing' };
    throw err;
  }

  const previous = store.get(guild.id, userId);
  const plan = planRoleChange({
    tiers: deps.tiers,
    score: result.score,
    memberRoleIds: new Set(member.roles.cache.keys()),
    lastRoleId: previous?.lastRoleId ?? null,
  });

  // Preconditions for every role we are about to touch, before anything is changed.
  // The matching score role is re-checked live on every link, held already or not (fail closed): a config that
  // pointed at a harmless role yesterday must not hand out a moderator role today.
  let addRole: RioRoleLike | null = null;
  if (plan.target) {
    const targetRole = await loadRole(guild, plan.target);
    if (!targetRole) return { kind: 'role-missing', roleId: plan.target };
    const verdict = checkScoreRole(targetRole, guild.id);
    if (!verdict.ok) {
      warnRioRoleUnsafeOnce(targetRole.id, verdict.category, now());
      return { kind: 'role-unsafe', roleId: targetRole.id, reason: scoreRoleRefusal(verdict, false) };
    }
    if (plan.add) {
      addRole = targetRole;
      if (addRole.managed || !addRole.editable) return { kind: 'role-hierarchy', roleId: addRole.id, roleName: addRole.name };
    }
  }
  let removeRole: RioRoleLike | null = null;
  if (plan.remove) {
    removeRole = await loadRole(guild, plan.remove); // a deleted role has nothing left to remove
    if (removeRole && (removeRole.managed || !removeRole.editable)) {
      return { kind: 'role-hierarchy', roleId: removeRole.id, roleName: removeRole.name };
    }
  }

  // The old bot-given role goes FIRST. If that fails the new role is not handed out and the tracking keeps pointing
  // at the old role, so the next /rio-link retries the removal and the bot never loses track of a role it gave.
  let added = false;
  let removedRoleId: string | null = null;
  let removeFailed = false;
  if (removeRole) {
    try {
      await member.roles.remove(removeRole.id, 'Raider.IO score role changed (/rio-link)');
      removedRoleId = removeRole.id;
    } catch (err) {
      removeFailed = true;
      logger.warn({ err, code: discordErrorCode(err) }, 'rio-link: could not remove the previous score role');
    }
  }
  try {
    if (addRole && !removeFailed) {
      await member.roles.add(addRole.id, 'Raider.IO score role (/rio-link)');
      added = true;
    }
  } catch (err) {
    if (discordErrorCode(err) === 50_013) return { kind: 'missing-permissions' };
    throw err;
  }

  store.upsert({
    guildId: guild.id,
    userId,
    characterName: result.name,
    realm: result.realm,
    region: result.region,
    lastScore: result.score,
    // only overwritten when the old role really went (or there was none): otherwise keep tracking it
    lastRoleId: removeFailed ? (previous?.lastRoleId ?? null) : plan.botRole,
    updatedAt: now(),
  });

  const next = [...deps.tiers].sort((a, b) => a.minScore - b.minScore).find((t) => t.minScore > result.score) ?? null;
  return {
    kind: 'linked',
    score: result.score,
    season: result.season,
    name: result.name,
    realm: result.realm,
    region: result.region,
    profileUrl: result.profileUrl,
    roleId: plan.target,
    added,
    removedRoleId,
    removeFailed,
    addSkipped: addRole !== null && !added,
    nextTier: next,
  };
}

export type RioUnlinkOutcome =
  | { kind: 'not-linked' }
  | { kind: 'unlinked'; removedRoleId: string | null; roleProblem: boolean };

/**
 * /rio-unlink: removes only the score role the bot itself gave (`last_role_id`) and always deletes the mapping,
 * also when the role could not be removed (then `roleProblem` tells the member that a moderator has to).
 */
export async function unlinkRioCharacter(deps: {
  guild: RioGuildLike;
  userId: string;
  store?: RioStore;
}): Promise<RioUnlinkOutcome> {
  const store = deps.store ?? rioSqliteStore;
  const row = store.get(deps.guild.id, deps.userId);
  if (!row) return { kind: 'not-linked' };
  let removedRoleId: string | null = null;
  let roleProblem = false;
  if (row.lastRoleId) {
    try {
      const member = await deps.guild.members.fetch(deps.userId);
      if (member.roles.cache.has(row.lastRoleId)) {
        const role = await loadRole(deps.guild, row.lastRoleId);
        if (role && (role.managed || !role.editable)) {
          roleProblem = true;
        } else if (role) {
          await member.roles.remove(role.id, 'Raider.IO score role removed (/rio-unlink)');
          removedRoleId = role.id;
        }
      }
    } catch (err) {
      if (discordErrorCode(err) !== 10_007) {
        roleProblem = true;
        logger.warn({ err, code: discordErrorCode(err) }, 'rio-unlink: could not remove the score role');
      }
    }
  }
  store.delete(deps.guild.id, deps.userId);
  return { kind: 'unlinked', removedRoleId, roleProblem };
}

// ─── German replies (pure) ───

const roleMention = (id: string): string => `<@&${id}>`;

function apiErrorMessage(f: RioFailure): string {
  switch (f.kind) {
    case 'not-found': return '❌ Raider.IO kennt diesen Charakter nicht. Prüfe Name, Realm und Region (der Charakter muss bei Raider.IO bereits erfasst sein).';
    case 'invalid-input': return '❌ Raider.IO hat die Eingabe abgelehnt. Prüfe Name, Realm und Region.';
    case 'rate-limited': return `⏳ Raider.IO ist gerade überlastet. Versuche es in etwa ${Math.max(1, f.retryAfterSec)} Sekunden erneut.`;
    case 'timeout': return '⚠️ Raider.IO hat nicht rechtzeitig geantwortet. Versuche es später erneut.';
    case 'unavailable': return '⚠️ Raider.IO ist gerade nicht erreichbar. Versuche es später erneut.';
    case 'bad-response': return '⚠️ Raider.IO hat eine unerwartete Antwort geliefert. Versuche es später erneut.';
  }
}

export const RIO_NOT_CONFIGURED_MESSAGE = 'ℹ️ Die Raider.IO-Rollen sind auf diesem Server noch nicht eingerichtet. Ein Admin muss zuerst Score-Schwellen und Rollen festlegen.';

/** The link is not verified (no OAuth) and the roles carry no rights: say so in every successful answer. */
export const RIO_DISCLAIMER = '_Hinweis: Der Charakter wird nicht verifiziert, die Score-Rolle ist nur eine Anzeige ohne Rechte._';

export function rioLinkMessage(outcome: RioLinkOutcome, seasonLabel: string): string {
  switch (outcome.kind) {
    case 'not-configured': return RIO_NOT_CONFIGURED_MESSAGE;
    case 'missing-manage-roles': return '⚠️ Ich darf hier keine Rollen vergeben („Rollen verwalten“ fehlt). Bitte einen Admin, die Bot-Rechte zu prüfen.';
    case 'role-missing': return `⚠️ Die Score-Rolle ${roleMention(outcome.roleId)} gibt es nicht mehr. Bitte einen Admin, die Schwellen zu prüfen. Ich lege keine Rollen selbst an.`;
    case 'role-hierarchy': return `⚠️ Ich kann die Rolle **${rioText(outcome.roleName, 100)}** nicht vergeben oder entfernen, weil sie über meiner eigenen Rolle liegt oder von einer Integration verwaltet wird. Bitte einen Admin, meine Rolle in der Rollenliste über die Score-Rollen zu schieben.`;
    case 'role-unsafe': return `⚠️ Die Score-Rolle ${roleMention(outcome.roleId)} vergebe ich nicht: ${outcome.reason}. Score-Rollen müssen reine Anzeige-Rollen ohne Rechte sein. Bitte einen Admin, die Schwellen zu prüfen.`;
    case 'missing-permissions': return '⚠️ Discord hat das Vergeben der Rolle abgelehnt (fehlende Rechte). Bitte einen Admin, die Bot-Rechte zu prüfen.';
    case 'member-missing': return '❌ Ich finde dich nicht auf dem Server.';
    case 'api-error': return apiErrorMessage(outcome.failure);
    case 'linked': {
      const season = rioText(seasonLabel || outcome.season || 'aktuelle Season', 40);
      const lines = [`✅ **${rioText(outcome.name, 24)}** (${rioText(outcome.realm, 40)}, ${rioText(outcome.region.toUpperCase(), 4)}) hat **${outcome.score}** M+-Punkte (${season}).`];
      if (outcome.roleId) {
        if (outcome.addSkipped) lines.push(`Die Rolle ${roleMention(outcome.roleId)} vergebe ich erst, wenn die bisherige Score-Rolle entfernt werden konnte.`);
        else lines.push(outcome.added ? `Du hast die Rolle ${roleMention(outcome.roleId)} bekommen.` : `Du hast die Rolle ${roleMention(outcome.roleId)} bereits.`);
      } else {
        lines.push('Dein Score liegt noch unter der niedrigsten Schwelle, es gibt noch keine Score-Rolle.');
      }
      if (outcome.removedRoleId) lines.push(`Die bisherige Score-Rolle ${roleMention(outcome.removedRoleId)} wurde entfernt.`);
      if (outcome.removeFailed) lines.push('⚠️ Die bisherige Score-Rolle konnte nicht entfernt werden. Ich versuche es beim nächsten `/rio-link` erneut, oder bitte einen Moderator.');
      if (outcome.nextTier) lines.push(`Nächste Stufe ab ${outcome.nextTier.minScore} Punkten (${roleMention(outcome.nextTier.roleId)}).`);
      lines.push('Der Score wird nicht automatisch aktualisiert: Führe `/rio-link` später erneut aus. Mit `/rio-unlink` löschst du die Verknüpfung wieder.');
      lines.push(RIO_DISCLAIMER);
      return lines.join('\n');
    }
  }
}

export function rioUnlinkMessage(outcome: RioUnlinkOutcome): string {
  if (outcome.kind === 'not-linked') return 'ℹ️ Du hast keinen Raider.IO-Charakter verknüpft.';
  const parts = ['✅ Deine Raider.IO-Verknüpfung wurde gelöscht.'];
  if (outcome.removedRoleId) parts.push(`Die Score-Rolle ${roleMention(outcome.removedRoleId)} wurde entfernt.`);
  if (outcome.roleProblem) parts.push('⚠️ Die Score-Rolle konnte nicht entfernt werden. Bitte einen Moderator, sie manuell zu entfernen.');
  return parts.join(' ');
}
