import { logger } from '../utils/logger.js';
import { rioCacheKey, type RioCharacterInput } from '../utils/rio-roles.js';

/**
 * Raider.IO character profile, read only, no API key. Endpoint and fields as documented at https://raider.io/api
 * (GET /api/v1/characters/profile, `fields=mythic_plus_scores_by_season:current`; limit 300 requests/min).
 * Observed behaviour (checked against the live API): unknown characters answer HTTP 400 with the message
 * "Could not find requested character" (not 404); malformed queries answer HTTP 400 "Invalid request query input".
 * Both 404 and that 400 are treated as "not found".
 */

export const RIO_API_BASE = 'https://raider.io/api/v1/characters/profile';
export const RIO_TIMEOUT_MS = 8_000;
export const RIO_CACHE_TTL_MS = 2 * 60_000;
export const RIO_MAX_RETRY_AFTER_SEC = 3_600;
/**
 * Own ceiling for all users together, well below the documented 300/min. Every user is already held to one
 * `/rio-link` per minute (cooldown), so this only matters when many members link at once.
 */
export const RIO_GLOBAL_LIMIT = 100;
export const RIO_GLOBAL_WINDOW_MS = 60_000;
/**
 * A request that hits the ceiling (or a short Retry-After block) waits for the slot when it opens within this time
 * instead of being turned away; only a longer wait answers rate-limited. At most `RIO_MAX_WAITERS` wait at once.
 */
export const RIO_MAX_QUEUE_WAIT_MS = 3_000;
export const RIO_MAX_WAITERS = 10;

export type RioFailure =
  | { ok: false; kind: 'not-found' }
  | { ok: false; kind: 'invalid-input' }
  | { ok: false; kind: 'rate-limited'; retryAfterSec: number }
  | { ok: false; kind: 'timeout' }
  | { ok: false; kind: 'unavailable' }
  | { ok: false; kind: 'bad-response' };

export interface RioScore {
  ok: true;
  score: number;
  /** Season slug as reported by the API (e.g. the current season), or null when the character has no season entry. */
  season: string | null;
  name: string;
  realm: string;
  region: string;
  profileUrl: string | null;
  cached: boolean;
}

export type RioResult = RioScore | RioFailure;

export interface RioClientDeps {
  fetchFn?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  /** Test seam for the short queue wait. */
  sleep?: (ms: number) => Promise<void>;
}

interface CacheEntry { at: number; value: RioScore }

const cache = new Map<string, CacheEntry>();
let blockedUntil = 0;
let windowCalls: number[] = [];
let waiters = 0;

/** Test seam. */
export function resetRioClient(): void {
  cache.clear();
  blockedUntil = 0;
  windowCalls = [];
  waiters = 0;
}

/** Retry-After: delta seconds or an HTTP date; clamped to 1..3600, default 60. */
export function parseRetryAfter(header: string | null, now: number): number {
  if (!header) return 60;
  const secs = Number(header.trim());
  if (Number.isFinite(secs) && secs >= 0) return Math.min(RIO_MAX_RETRY_AFTER_SEC, Math.max(1, Math.ceil(secs)));
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.min(RIO_MAX_RETRY_AFTER_SEC, Math.max(1, Math.ceil((at - now) / 1000)));
  return 60;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Pure response mapping: the body of a 200 answer to a score. */
export function parseRioProfile(body: unknown): Omit<RioScore, 'cached'> | null {
  if (!isRecord(body)) return null;
  const name = typeof body.name === 'string' ? body.name : null;
  const realm = typeof body.realm === 'string' ? body.realm : null;
  const region = typeof body.region === 'string' ? body.region : null;
  if (!name || !realm || !region) return null;
  const seasons = body.mythic_plus_scores_by_season;
  let score = 0;
  let season: string | null = null;
  if (Array.isArray(seasons) && seasons.length > 0) {
    const first = seasons[0];
    if (!isRecord(first) || !isRecord(first.scores)) return null;
    const all = first.scores.all;
    if (typeof all !== 'number' || !Number.isFinite(all) || all < 0) return null;
    score = all;
    season = typeof first.season === 'string' ? first.season : null;
  } else if (seasons !== undefined && !Array.isArray(seasons)) {
    return null;
  }
  const profileUrl = typeof body.profile_url === 'string' && body.profile_url.startsWith('https://raider.io/') ? body.profile_url : null;
  return { ok: true, score, season, name, realm, region, profileUrl };
}

export async function fetchRioScore(character: RioCharacterInput, deps: RioClientDeps = {}): Promise<RioResult> {
  const now = deps.now ?? Date.now;
  const fetchFn = deps.fetchFn ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const key = rioCacheKey(character);

  // Cache, Retry-After block and the global ceiling are re-evaluated after every short wait (the cache may have
  // been filled meanwhile by someone linking the same character).
  for (let round = 0; ; round += 1) {
    const t = now();
    const hit = cache.get(key);
    if (hit && t - hit.at < RIO_CACHE_TTL_MS) return { ...hit.value, cached: true };
    windowCalls = windowCalls.filter((at) => t - at < RIO_GLOBAL_WINDOW_MS);
    const blockWait = t < blockedUntil ? blockedUntil - t : 0;
    const windowWait = windowCalls.length >= RIO_GLOBAL_LIMIT ? (windowCalls[0] ?? t) + RIO_GLOBAL_WINDOW_MS - t : 0;
    const wait = Math.max(blockWait, windowWait);
    if (wait <= 0) {
      windowCalls.push(t);
      break;
    }
    if (wait > RIO_MAX_QUEUE_WAIT_MS || round >= 5 || waiters >= RIO_MAX_WAITERS) {
      return { ok: false, kind: 'rate-limited', retryAfterSec: Math.max(1, Math.ceil(wait / 1000)) };
    }
    waiters += 1;
    try {
      await sleep(wait);
    } catch {
      return { ok: false, kind: 'unavailable' };
    } finally {
      waiters = Math.max(0, waiters - 1);
    }
  }

  const url = new URL(RIO_API_BASE);
  url.searchParams.set('region', character.region);
  url.searchParams.set('realm', character.realm);
  url.searchParams.set('name', character.name);
  url.searchParams.set('fields', 'mythic_plus_scores_by_season:current');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? RIO_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, {
      signal: ctl.signal,
      redirect: 'error',
      headers: { accept: 'application/json', 'user-agent': 'MagguuBot (Discord score roles on request)' },
    });
    if (res.status === 429) {
      const retryAfterSec = parseRetryAfter(res.headers.get('retry-after'), now());
      blockedUntil = Math.max(blockedUntil, now() + retryAfterSec * 1000);
      logger.warn({ retryAfterSec }, 'raider.io rate limit (429)');
      return { ok: false, kind: 'rate-limited', retryAfterSec };
    }
    if (res.status === 404) return { ok: false, kind: 'not-found' };
    if (res.status === 400) {
      const message = await res.json().then((b: unknown) => (isRecord(b) && typeof b.message === 'string' ? b.message : '')).catch(() => '');
      return { ok: false, kind: /could not find/i.test(message) ? 'not-found' : 'invalid-input' };
    }
    if (res.status >= 500) {
      logger.warn({ status: res.status }, 'raider.io server error');
      return { ok: false, kind: 'unavailable' };
    }
    if (!res.ok) {
      logger.warn({ status: res.status }, 'raider.io unexpected status');
      return { ok: false, kind: 'bad-response' };
    }
    const parsed = parseRioProfile(await res.json().catch(() => null));
    if (!parsed) {
      logger.warn('raider.io response had an unexpected shape');
      return { ok: false, kind: 'bad-response' };
    }
    cache.set(key, { at: now(), value: { ...parsed, cached: false } });
    if (cache.size > 200) {
      for (const [k, v] of cache) if (now() - v.at >= RIO_CACHE_TTL_MS) cache.delete(k);
    }
    return { ...parsed, cached: false };
  } catch (err) {
    const aborted = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
    logger.warn({ err }, aborted ? 'raider.io request timed out' : 'raider.io request failed');
    return { ok: false, kind: aborted ? 'timeout' : 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}
