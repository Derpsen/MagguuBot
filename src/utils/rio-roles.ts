/**
 * Raider.IO score roles on request: pure helpers (threshold parsing/validation, tier choice, role change plan,
 * input normalisation). No Discord, no network, no DB - see src/discord/rio-roles.ts for the wiring.
 */

export interface RioTier {
  minScore: number;
  roleId: string;
}

export const RIO_REGIONS = ['eu', 'us', 'kr', 'tw', 'cn'] as const;
export type RioRegion = (typeof RIO_REGIONS)[number];

const SNOWFLAKE = /^\d{17,20}$/;
export const RIO_MAX_SCORE = 10_000;
export const RIO_MAX_TIERS = 15;

export interface ParsedTiers {
  tiers: RioTier[];
  /** Human-readable problems; invalid entries are dropped, the rest stays usable. */
  problems: string[];
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
  return { minScore: Math.round(score * 10) / 10, roleId: role };
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
