import { config } from '../config.js';
import { getRadarrLibrary } from '../services/radarr.js';
import { getSonarrLibrary } from '../services/sonarr.js';
import { getRecentlyAdded, type TautulliRecentRaw } from '../services/tautulli.js';
import { logger } from '../utils/logger.js';
import { daysForWindow, filterRawSince } from '../utils/plex-new-digest.js';
import {
  NEU_ERROR_TEXT,
  NEU_FETCH_COUNT,
  NEU_NOT_CONFIGURED_TEXT,
  buildNeuComponents,
  buildNeuEmbed,
  neuPage,
  NEU_PAGE_SIZE,
  posterKey,
  prepareNeuItems,
  safePosterUrl,
  type NeuItem,
  type NeuType,
  type NeuView,
} from '../utils/plex-new.js';

export const NEU_CACHE_TTL_MS = 5 * 60 * 1000;
export const NEU_COOLDOWN_MS = 5_000;
export const NEU_BUTTON_COOLDOWN_MS = 1_500;
/** After a failed Tautulli fetch no new request is made for this long (negative cache), however many clicks arrive. */
export const NEU_FAIL_TTL_MS = 45_000;
const POSTER_INDEX_TTL_MS = 30 * 60 * 1000;
const POSTER_INDEX_FAIL_TTL_MS = 5 * 60 * 1000;

/** Public artwork only: title/year → poster URL taken from the Radarr/Sonarr library (never from Plex/Tautulli). */
export interface PosterIndex {
  movies: Map<string, string>;
  shows: Map<string, string>;
}

export interface PlexNewDeps {
  configured: () => boolean;
  fetchRecent: (mediaType: 'movie' | 'show', count: number) => Promise<TautulliRecentRaw[] | null>;
  loadPosterIndex?: () => Promise<PosterIndex | null>;
  now?: () => number;
  ttlMs?: number;
  failTtlMs?: number;
}

export type PlexNewResult =
  | { ok: true; items: NeuItem[]; truncated: boolean }
  | { ok: false; reason: 'not-configured' | 'unavailable' };

export type PlexNewSinceResult =
  | { ok: true; items: NeuItem[]; truncated: boolean; fetchedAt: number }
  | { ok: false; reason: 'not-configured' | 'unavailable' };

interface CacheEntry {
  at: number;
  data: TautulliRecentRaw[] | null;
  /** While `now < failedUntil` the last fetch failed: serve `data` (stale or null) without asking Tautulli again. */
  failedUntil?: number;
}

/** Cached, de-duplicated access to Tautulli's recently-added lists plus the optional poster lookup. */
export class PlexNewService {
  private readonly cache = new Map<'movie' | 'show', CacheEntry>();
  private readonly inflight = new Map<'movie' | 'show', Promise<TautulliRecentRaw[] | null>>();
  private posterIndex: { at: number; data: PosterIndex | null } | null = null;
  private posterInflight: Promise<PosterIndex | null> | null = null;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly failTtlMs: number;

  constructor(private readonly deps: PlexNewDeps) {
    this.now = deps.now ?? Date.now;
    this.ttlMs = deps.ttlMs ?? NEU_CACHE_TTL_MS;
    this.failTtlMs = deps.failTtlMs ?? NEU_FAIL_TTL_MS;
  }

  private async raw(mediaType: 'movie' | 'show'): Promise<TautulliRecentRaw[] | null> {
    const hit = this.cache.get(mediaType);
    const now = this.now();
    if (hit?.data && now - hit.at < this.ttlMs && !hit.failedUntil) return hit.data;
    if (hit?.failedUntil && now < hit.failedUntil) return hit.data;
    const running = this.inflight.get(mediaType);
    if (running) return running;
    const p = (async () => {
      let data: TautulliRecentRaw[] | null = null;
      try {
        data = await this.deps.fetchRecent(mediaType, NEU_FETCH_COUNT);
      } catch (err) {
        logger.warn({ err, mediaType }, '/neu: recently-added fetch failed');
      } finally {
        this.inflight.delete(mediaType);
      }
      if (data) {
        this.cache.set(mediaType, { at: this.now(), data });
        return data;
      }
      // Failure: remember it briefly (negative cache) and fall back to the last good data if there is any.
      this.cache.set(mediaType, { at: hit?.at ?? 0, data: hit?.data ?? null, failedUntil: this.now() + this.failTtlMs });
      return hit?.data ?? null;
    })();
    this.inflight.set(mediaType, p);
    return p;
  }

  async get(type: NeuType, days: number): Promise<PlexNewResult> {
    if (!this.deps.configured()) return { ok: false, reason: 'not-configured' };
    const wantMovies = type !== 'shows';
    const wantShows = type !== 'movies';
    const [movies, shows] = await Promise.all([
      wantMovies ? this.raw('movie') : Promise.resolve([] as TautulliRecentRaw[]),
      wantShows ? this.raw('show') : Promise.resolve([] as TautulliRecentRaw[]),
    ]);
    if (movies === null || shows === null) return { ok: false, reason: 'unavailable' };
    const items = prepareNeuItems([...movies, ...shows], { now: this.now(), days, type });
    const truncated = (wantMovies && movies.length >= NEU_FETCH_COUNT) || (wantShows && shows.length >= NEU_FETCH_COUNT);
    return { ok: true, items, truncated };
  }

  /**
   * Everything added after `sinceMs` (both types, series grouped by title) for the weekly digest. `fetchedAt` is
   * the time of the underlying Tautulli data (the next digest starts there, and entries added after it are held back
   * for that digest, because the movie and series lists may have been fetched at different times); data older than `maxAgeMs` — e.g. a
   * stale fallback after failed fetches — counts as unavailable so no window is silently skipped.
   */
  async getSince(sinceMs: number, maxAgeMs = this.ttlMs * 2): Promise<PlexNewSinceResult> {
    if (!this.deps.configured()) return { ok: false, reason: 'not-configured' };
    const [movies, shows] = await Promise.all([this.raw('movie'), this.raw('show')]);
    if (movies === null || shows === null) return { ok: false, reason: 'unavailable' };
    const now = this.now();
    const fetchedAt = Math.min(this.cache.get('movie')?.at ?? 0, this.cache.get('show')?.at ?? 0);
    if (now - fetchedAt > maxAgeMs) return { ok: false, reason: 'unavailable' };
    const items = prepareNeuItems(filterRawSince([...movies, ...shows], sinceMs, fetchedAt), {
      now,
      days: daysForWindow(now, sinceMs),
      type: 'all',
    });
    const truncated = movies.length >= NEU_FETCH_COUNT || shows.length >= NEU_FETCH_COUNT;
    return { ok: true, items, truncated, fetchedAt };
  }

  /** Poster of the first item on the page, or null. Never throws; any failure is a quiet `warn` log. */
  async posterFor(item: NeuItem | undefined): Promise<string | null> {
    if (!item || !this.deps.loadPosterIndex) return null;
    const index = await this.index();
    if (!index) return null;
    const map = item.kind === 'movie' ? index.movies : index.shows;
    const byYear = item.year ? map.get(`${posterKey(item.title)}|${item.year}`) : undefined;
    return byYear ?? map.get(posterKey(item.title)) ?? null;
  }

  private async index(): Promise<PosterIndex | null> {
    const hit = this.posterIndex;
    if (hit && this.now() - hit.at < (hit.data ? POSTER_INDEX_TTL_MS : POSTER_INDEX_FAIL_TTL_MS)) return hit.data;
    if (this.posterInflight) return this.posterInflight;
    this.posterInflight = (async () => {
      let data: PosterIndex | null = null;
      try {
        data = (await this.deps.loadPosterIndex?.()) ?? null;
      } catch (err) {
        logger.warn({ err }, '/neu: poster index failed');
      }
      this.posterIndex = { at: this.now(), data };
      return data;
    })().finally(() => {
      this.posterInflight = null;
    });
    return this.posterInflight;
  }
}

interface ArtworkEntry {
  title?: string;
  year?: number;
  images?: Array<{ coverType?: string; remoteUrl?: string | null }>;
}

export function buildPosterMap(entries: readonly ArtworkEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.title) continue;
    const url = safePosterUrl(entry.images?.find((i) => i.coverType === 'poster')?.remoteUrl);
    if (!url) continue;
    const base = posterKey(entry.title);
    if (!base) continue;
    if (entry.year) map.set(`${base}|${entry.year}`, url);
    if (!map.has(base)) map.set(base, url);
  }
  return map;
}

/** Radarr/Sonarr are optional: with neither configured there are simply no posters. */
async function loadPosterIndex(): Promise<PosterIndex | null> {
  const [movies, shows] = await Promise.all([
    config.RADARR_URL && config.RADARR_API_KEY ? getRadarrLibrary().catch(() => null) : Promise.resolve(null),
    config.SONARR_URL && config.SONARR_API_KEY ? getSonarrLibrary().catch(() => null) : Promise.resolve(null),
  ]);
  if (!movies && !shows) return null;
  return { movies: buildPosterMap(movies ?? []), shows: buildPosterMap(shows ?? []) };
}

export const plexNewService = new PlexNewService({
  configured: () => Boolean(config.TAUTULLI_URL && config.TAUTULLI_API_KEY),
  fetchRecent: getRecentlyAdded,
  loadPosterIndex,
});

export { NEU_PAGE_SIZE };

export type NeuReply =
  | { ok: true; embeds: ReturnType<typeof buildNeuEmbed>['embed'][]; components: ReturnType<typeof buildNeuComponents>; pages: number; page: number }
  | { ok: false; content: string };

/** Builds the full `/neu` reply for one view; failures become a friendly text (details only in the log). */
export async function renderNeu(service: PlexNewService, view: NeuView): Promise<NeuReply> {
  const result = await service.get(view.type, view.days);
  if (!result.ok) {
    return { ok: false, content: result.reason === 'not-configured' ? NEU_NOT_CONFIGURED_TEXT : NEU_ERROR_TEXT };
  }
  const slice = neuPage(result.items, view.page);
  const poster = await service.posterFor(slice.items[0]).catch(() => null);
  const built = buildNeuEmbed({
    items: result.items,
    page: slice.page,
    days: view.days,
    type: view.type,
    truncated: result.truncated,
    posterUrl: poster,
  });
  return {
    ok: true,
    embeds: [built.embed],
    components: buildNeuComponents({ ...view, page: built.page }, built.pages),
    pages: built.pages,
    page: built.page,
  };
}

// Per-user command cooldown (in memory; the 5 min data cache already shields Tautulli).
const lastUse = new Map<string, number>();

/** Returns remaining ms when the user is still cooling down, otherwise records the use and returns 0. */
export function neuCooldownLeft(userId: string, now: number = Date.now(), cooldownMs: number = NEU_COOLDOWN_MS): number {
  const last = lastUse.get(userId);
  if (last !== undefined && now - last < cooldownMs) return cooldownMs - (now - last);
  lastUse.set(userId, now);
  if (lastUse.size > 500) {
    for (const [id, at] of lastUse) if (now - at > cooldownMs) lastUse.delete(id);
  }
  return 0;
}

export function resetNeuCooldown(): void {
  lastUse.clear();
  lastButtonUse.clear();
}

// Page buttons: a short separate cooldown so rapid clicking can't hammer the render path.
const lastButtonUse = new Map<string, number>();

export function neuButtonCooldownLeft(userId: string, now: number = Date.now(), cooldownMs: number = NEU_BUTTON_COOLDOWN_MS): number {
  const last = lastButtonUse.get(userId);
  if (last !== undefined && now - last < cooldownMs) return cooldownMs - (now - last);
  lastButtonUse.set(userId, now);
  if (lastButtonUse.size > 500) {
    for (const [id, at] of lastButtonUse) if (now - at > cooldownMs) lastButtonUse.delete(id);
  }
  return 0;
}
