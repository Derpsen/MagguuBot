// Pure part of the "unseen media" report (read-only: it only classifies rows that Tautulli already knows).
// No user data is involved: a row is title + size + added/last-played timestamps of a library item.

export const UNSEEN_TOP_N = 25;
export const UNSEEN_TITLE_MAX = 60;
export const UNSEEN_LIBRARY_MAX = 40;
const DAY_MS = 86_400_000;
/**
 * Budget for the report inside the `/api/status` JSON. Home Assistant's recorder skips ALL attributes of a sensor
 * once they exceed 16 KB in total (the state itself stays usable), and the same sensor carries the other bot fields,
 * so the report gets at most 6 KB (UTF-8 bytes of its JSON).
 */
export const UNSEEN_MAX_BYTES = 6_000;

/** One row of Tautulli `get_library_media_info` (only the fields we read; Tautulli sends numbers as number or string). */
export interface MediaInfoRow {
  title?: unknown;
  year?: unknown;
  media_type?: unknown;
  file_size?: unknown;
  added_at?: unknown;
  last_played?: unknown;
  play_count?: unknown;
}

export interface UnseenItem {
  title: string;
  library: string;
  type: 'movie' | 'show';
  sizeBytes: number;
  /** ISO timestamp of the last play; null = never played in the Tautulli history. */
  lastPlayedAt: string | null;
  addedAt: string | null;
}

export interface UnseenReportBlock {
  generatedAt: string;
  topN: number;
  /** Items must have been in the library at least this long (new additions are not "unseen" yet). */
  minAgeDays: number;
  /** A played item counts as stale when its last play is at least this long ago. */
  staleDays: number;
  /** true when a library scan hit the page limit before the top N were certain. */
  partial: boolean;
  /** Libraries (movie/show) the report covered. */
  libraries: number;
  /** true when items were dropped at the end of the list to stay within `UNSEEN_MAX_BYTES`. */
  clipped?: boolean;
  items: UnseenItem[];
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Unix seconds (number or numeric string) → ms; empty / 0 / garbage → null. */
function unixSecondsToMs(v: unknown): number | null {
  const n = toNumber(v);
  return n !== null && n > 0 ? n * 1000 : null;
}

/** Strips control / bidi / zero-width characters, collapses whitespace, clips. Titles are shown in Home Assistant, never trusted as markup. */
export function cleanTitle(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const s = v
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export interface ClassifyOptions {
  library: string;
  type: 'movie' | 'show';
  now: number;
  minAgeDays: number;
  staleDays: number;
}

/**
 * Turns one media-info row into a report item, or null when it does not belong in the report:
 * no usable size, a title-less row, added less than `minAgeDays` ago (or with an unknown add date: we cannot
 * prove it is old), or played within `staleDays`.
 */
export function classifyRow(row: MediaInfoRow, o: ClassifyOptions): UnseenItem | null {
  const size = toNumber(row.file_size);
  if (size === null || size <= 0) return null;
  const rawTitle = cleanTitle(row.title, UNSEEN_TITLE_MAX);
  if (!rawTitle) return null;
  const added = unixSecondsToMs(row.added_at);
  if (added === null || o.now - added < o.minAgeDays * DAY_MS) return null;
  const last = unixSecondsToMs(row.last_played);
  if (last !== null && o.now - last < o.staleDays * DAY_MS) return null;
  const year = toNumber(row.year);
  const title = year && year > 1800 && year < 3000 && !rawTitle.includes(`(${year})`) ? `${rawTitle} (${year})` : rawTitle;
  return {
    title,
    library: cleanTitle(o.library, UNSEEN_LIBRARY_MAX),
    type: o.type,
    sizeBytes: Math.round(size),
    lastPlayedAt: last === null ? null : new Date(last).toISOString(),
    addedAt: new Date(added).toISOString(),
  };
}

/** Biggest first, then title for a stable order; at most `n`. */
export function selectTop(items: readonly UnseenItem[], n: number = UNSEEN_TOP_N): UnseenItem[] {
  return [...items]
    .sort((a, b) => b.sizeBytes - a.sizeBytes || a.title.localeCompare(b.title) || a.library.localeCompare(b.library))
    .slice(0, Math.max(0, n));
}

/** Defensive parse of a cached block (stored JSON); anything off = null so a stale/corrupt cache is simply recomputed. */
export function parseStoredReport(raw: string | null): UnseenReportBlock | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<UnseenReportBlock> | null;
    if (!v || typeof v !== 'object' || typeof v.generatedAt !== 'string' || !Number.isFinite(Date.parse(v.generatedAt))) return null;
    if (!Array.isArray(v.items)) return null;
    const items: UnseenItem[] = [];
    for (const it of v.items) {
      if (!it || typeof it.title !== 'string' || typeof it.library !== 'string') return null;
      if ((it.type !== 'movie' && it.type !== 'show') || !Number.isFinite(it.sizeBytes)) return null;
      items.push({
        title: cleanTitle(it.title, UNSEEN_TITLE_MAX),
        library: cleanTitle(it.library, UNSEEN_LIBRARY_MAX),
        type: it.type,
        sizeBytes: it.sizeBytes,
        lastPlayedAt: typeof it.lastPlayedAt === 'string' ? it.lastPlayedAt : null,
        addedAt: typeof it.addedAt === 'string' ? it.addedAt : null,
      });
    }
    return {
      generatedAt: v.generatedAt,
      topN: Number(v.topN) || UNSEEN_TOP_N,
      minAgeDays: Number(v.minAgeDays) || 0,
      staleDays: Number(v.staleDays) || 0,
      partial: v.partial === true,
      libraries: Number(v.libraries) || 0,
      items,
    };
  } catch {
    return null;
  }
}

/** The cache is reused while it is younger than 24 h AND was built with the current settings. */
export function reportIsFresh(block: UnseenReportBlock | null, now: number, minAgeDays: number, staleDays: number): boolean {
  if (!block) return false;
  const at = Date.parse(block.generatedAt);
  return Number.isFinite(at) && now - at >= 0 && now - at < DAY_MS && block.minAgeDays === minAgeDays && block.staleDays === staleDays;
}

/** Size of a block as it goes out in the status JSON (UTF-8 bytes). */
export function unseenBlockBytes(block: UnseenReportBlock): number {
  return Buffer.byteLength(JSON.stringify(block), 'utf8');
}

/**
 * The block as it is served: smallest items (the end of the size-ordered list) are dropped until the JSON fits
 * `maxBytes`; `clipped` tells the dashboard. A block that already fits is returned unchanged (same object).
 */
export function clipUnseenBlock(block: UnseenReportBlock, maxBytes: number = UNSEEN_MAX_BYTES): UnseenReportBlock {
  if (unseenBlockBytes(block) <= maxBytes) return block;
  const items = [...block.items];
  let out: UnseenReportBlock = { ...block, clipped: true, items };
  while (items.length > 0 && unseenBlockBytes(out) > maxBytes) {
    items.pop();
    out = { ...block, clipped: true, items };
  }
  return out;
}
