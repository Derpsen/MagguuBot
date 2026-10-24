// Read-only "unseen media" report for the Magguu dashboard (admin card). Computed from Tautulli's media-info table
// (get_libraries + get_library_media_info, both read-only; never `refresh`), cached for 24 h in memory and in
// bot_settings, and served through the authenticated GET /api/status. There is NO delete / write path anywhere:
// the report only lists title, size, library and last play. No user data is read or stored.
import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { botSettings } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { errSerializer } from '../utils/scrub.js';
import {
  classifyRow,
  parseStoredReport,
  reportIsFresh,
  selectTop,
  UNSEEN_TOP_N,
  type UnseenItem,
  type UnseenReportBlock,
} from '../utils/unseen-report.js';
import { getLibraries, getLibraryMediaInfoPage, type TautulliLibraryRaw, type TautulliMediaInfoPage } from './tautulli.js';

const SETTINGS_KEY = 'unseenReport';
export const UNSEEN_PAGE_SIZE = 200;
/** At most this many pages per library (3000 items), a bound on Tautulli load. */
export const UNSEEN_MAX_PAGES = 15;
export const UNSEEN_PAGE_PAUSE_MS = 250;

export interface UnseenReportDeps {
  getLibraries: () => Promise<TautulliLibraryRaw[] | null>;
  getPage: (sectionId: string, sectionType: 'movie' | 'show', start: number, length: number) => Promise<TautulliMediaInfoPage | null>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  minAgeDays: number;
  staleDays: number;
  topN?: number;
}

const realDeps = (): UnseenReportDeps => ({
  getLibraries,
  getPage: getLibraryMediaInfoPage,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  minAgeDays: config.PLEX_UNSEEN_REPORT_MIN_AGE_DAYS,
  staleDays: config.PLEX_UNSEEN_REPORT_STALE_DAYS,
});

/**
 * Scans every movie / show library (biggest files first) and keeps the top N qualifying items. Because each page
 * is sorted by size, the first N qualifying rows of a library are that library's top N: the scan stops there.
 * Returns null when Tautulli is unreachable (nothing is half-reported).
 */
export async function computeUnseenReport(deps: UnseenReportDeps): Promise<UnseenReportBlock | null> {
  const topN = deps.topN ?? UNSEEN_TOP_N;
  const libs = await deps.getLibraries();
  if (!libs) return null;
  const relevant = libs.filter((l) => (l.section_type === 'movie' || l.section_type === 'show') && l.section_id !== undefined && l.section_id !== null);
  const now = deps.now();
  const all: UnseenItem[] = [];
  let partial = false;
  for (const lib of relevant) {
    const type = lib.section_type as 'movie' | 'show';
    const sectionId = String(lib.section_id);
    const name = typeof lib.section_name === 'string' ? lib.section_name : sectionId;
    let found = 0;
    let start = 0;
    let exhausted = false;
    for (let page = 0; page < UNSEEN_MAX_PAGES; page++) {
      if (page > 0) await deps.sleep(UNSEEN_PAGE_PAUSE_MS);
      const res = await deps.getPage(sectionId, type, start, UNSEEN_PAGE_SIZE);
      if (!res) return null;
      for (const row of res.data) {
        const item = classifyRow(row, { library: name, type, now, minAgeDays: deps.minAgeDays, staleDays: deps.staleDays });
        if (item) {
          all.push(item);
          found++;
        }
      }
      start += res.data.length;
      if (found >= topN) { exhausted = true; break; }
      if (res.data.length === 0 || start >= res.recordsTotal) { exhausted = true; break; }
    }
    if (!exhausted) partial = true;
  }
  return {
    generatedAt: new Date(now).toISOString(),
    topN,
    minAgeDays: deps.minAgeDays,
    staleDays: deps.staleDays,
    partial,
    libraries: relevant.length,
    items: selectTop(all, topN),
  };
}

// ─── cache (memory + bot_settings raw key) ───

let memory: UnseenReportBlock | null = null;
let loadedFromDb = false;

function readStored(): string | null {
  const row = db.select().from(botSettings)
    .where(and(eq(botSettings.guildId, config.DISCORD_GUILD_ID), eq(botSettings.key, SETTINGS_KEY))).get();
  return row ? row.value : null;
}

function writeStored(block: UnseenReportBlock): void {
  const value = JSON.stringify(block);
  db.insert(botSettings).values({ guildId: config.DISCORD_GUILD_ID, key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: [botSettings.guildId, botSettings.key], set: { value, updatedAt: new Date() } }).run();
}

function cached(): UnseenReportBlock | null {
  if (!loadedFromDb) {
    loadedFromDb = true;
    try { memory = parseStoredReport(readStored()); } catch { memory = null; }
  }
  return memory;
}

/** For /api/status: the cached report (never a Tautulli call); null when disabled, never computed or Tautulli is not configured. */
export function currentUnseenReport(): UnseenReportBlock | null {
  if (!config.PLEX_UNSEEN_REPORT_ENABLED) return null;
  try { return cached(); } catch { return null; }
}

/** Test hook. */
export function resetUnseenReportCache(): void {
  memory = null;
  loadedFromDb = false;
}

let running = false;

/**
 * Hourly tick: recompute only when the cache is older than 24 h (or built with other settings). A failed run keeps
 * the previous report and retries on the next tick (warn once, no alarm). Without Tautulli config: silent no-op.
 */
export async function runUnseenReportTick(deps: UnseenReportDeps = realDeps(), enabled: () => boolean = () => config.PLEX_UNSEEN_REPORT_ENABLED): Promise<'skipped' | 'fresh' | 'updated' | 'failed'> {
  if (!enabled() || !config.TAUTULLI_URL || !config.TAUTULLI_API_KEY) return 'skipped';
  if (running) return 'skipped';
  const now = deps.now();
  if (reportIsFresh(cached(), now, deps.minAgeDays, deps.staleDays)) return 'fresh';
  running = true;
  try {
    const block = await computeUnseenReport(deps);
    if (!block) {
      logger.warn('unseen media report: Tautulli unreachable or returned an error, keeping the previous report');
      return 'failed';
    }
    memory = block;
    loadedFromDb = true;
    try { writeStored(block); } catch (err) { logger.warn({ err: errSerializer(err) }, 'unseen media report: could not persist the cache'); }
    logger.info({ items: block.items.length, libraries: block.libraries, partial: block.partial }, 'unseen media report updated');
    return 'updated';
  } catch (err) {
    logger.warn({ err: errSerializer(err) }, 'unseen media report failed');
    return 'failed';
  } finally {
    running = false;
  }
}
