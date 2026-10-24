import { EmbedBuilder } from 'discord.js';
import { Colors, FOOTER_ICONS, truncate } from '../embeds/colors.js';
import type { TautulliRecentRaw } from '../services/tautulli.js';
import { clipPlexText, escapePlexMarkdown } from './plex-card.js';
import { safePosterUrl, type NeuItem } from './plex-new.js';
import { localScheduleParts } from './schedule.js';

/** Weekly "Neu hinzugefügt" digest: pure part (schedule slot, window, embed). No Discord, no network. */

export const DIGEST_FOOTER = 'MagguuBot · Neu-hinzugefügt-Digest';
export const DIGEST_MAX_TITLES = 15;
/** A scheduled run is still delivered up to this long after its slot (restart catch-up); later ones are skipped. */
export const DIGEST_GRACE_MS = 15 * 60_000;
/** After a permanent Discord error (10003/50001/50013) the digest is not attempted for this long. */
export const DIGEST_PAUSE_MS = 30 * 60_000;
/** Window of the very first digest (nothing stored yet). */
export const DIGEST_FIRST_WINDOW_MS = 7 * 86_400_000;
const STEP = 15 * 60_000;
const MAX_TITLE = 80;

/**
 * Start of the most recent schedule slot at or before `now`: the first moment of `day` (0=Sun) whose local
 * hour is >= `hour`. Normally that is `hour`:00 local; if DST skips that hour it is the first moment after
 * the gap, and a repeated hour (DST end) counts once. Scans back in 15 minute steps (follows DST and
 * half-hour zones). Null only for an impossible schedule.
 */
export function lastScheduledRun(now: number, timeZone: string, day: number, hour: number): number | null {
  let t = Math.floor(now / STEP) * STEP;
  const hit = (ms: number): boolean => {
    const p = localScheduleParts(new Date(ms), timeZone);
    return p.day === day && p.hour >= hour;
  };
  for (let i = 0; i < 8 * 24 * 4 + 8; i += 1, t -= STEP) {
    if (hit(t) && !hit(t - STEP)) return t;
  }
  return null;
}

export type DigestDecision = 'run' | 'done' | 'stale' | 'none';

/** `run` once per slot, only within the grace window; `done` after it was handled; `stale` when too late. */
export function decideDigest(now: number, scheduledAt: number | null, lastScheduledAt: number | null): DigestDecision {
  if (scheduledAt === null) return 'none';
  if (lastScheduledAt !== null && scheduledAt <= lastScheduledAt) return 'done';
  if (now - scheduledAt > DIGEST_GRACE_MS) return 'stale';
  return 'run';
}

/** Raw Tautulli entries strictly newer than `sinceMs` (the previous digest), so shows group only their new parts. */
export function filterRawSince(raw: readonly TautulliRecentRaw[], sinceMs: number): TautulliRecentRaw[] {
  return raw.filter((e) => {
    const added = Number(e.added_at);
    return Number.isFinite(added) && added * 1000 > sinceMs;
  });
}

/** Whole days to ask `prepareNeuItems` for so its cutoff lies before `sinceMs` (it clamps to 1..30). */
export function daysForWindow(now: number, sinceMs: number): number {
  return Math.max(1, Math.ceil((now - sinceMs) / 86_400_000));
}

interface Selection {
  movies: NeuItem[];
  shows: NeuItem[];
  more: number;
}

/** At most `max` titles overall, split fairly between movies and series (series are already grouped by title). */
export function selectDigestItems(items: readonly NeuItem[], max = DIGEST_MAX_TITLES): Selection {
  const movies = items.filter((i) => i.kind === 'movie');
  const shows = items.filter((i) => i.kind === 'show');
  const total = movies.length + shows.length;
  if (total <= max) return { movies, shows, more: 0 };
  let showQuota = Math.round((max * shows.length) / total);
  if (shows.length > 0) showQuota = Math.max(1, showQuota);
  showQuota = Math.min(showQuota, shows.length);
  let movieQuota = Math.min(movies.length, max - showQuota);
  showQuota = Math.min(shows.length, max - movieQuota);
  return {
    movies: movies.slice(0, movieQuota),
    shows: shows.slice(0, showQuota),
    more: total - movieQuota - showQuota,
  };
}

function line(item: NeuItem): string {
  const title = escapePlexMarkdown(clipPlexText(item.title, MAX_TITLE));
  const year = item.year ? ` (${item.year})` : '';
  const detail = item.detail ? ` · ${escapePlexMarkdown(clipPlexText(item.detail, 40))}` : '';
  return `• **${title}**${year}${detail}`;
}

export interface DigestEmbedInput {
  items: readonly NeuItem[];
  /** Epoch ms: everything added after this is covered. */
  sinceMs: number;
  /** Tautulli returned the maximum count, so older entries of the window may be missing. */
  truncated?: boolean;
  posterUrl?: string | null;
  maxTitles?: number;
}

export function buildDigestEmbed(input: DigestEmbedInput): EmbedBuilder {
  const sel = selectDigestItems(input.items, input.maxTitles ?? DIGEST_MAX_TITLES);
  const movieCount = input.items.filter((i) => i.kind === 'movie').length;
  const showCount = input.items.length - movieCount;
  const counts: string[] = [];
  if (movieCount > 0) counts.push(`**${movieCount}** ${movieCount === 1 ? 'Film' : 'Filme'}`);
  if (showCount > 0) counts.push(`**${showCount}** ${showCount === 1 ? 'Serie' : 'Serien'}`);
  const parts = [`Neu seit <t:${Math.floor(input.sinceMs / 1000)}:D>: ${counts.join(' und ')}`];
  if (sel.movies.length > 0) parts.push(`**🎬 Filme**\n${sel.movies.map(line).join('\n')}`);
  if (sel.shows.length > 0) parts.push(`**📺 Serien**\n${sel.shows.map(line).join('\n')}`);
  if (sel.more > 0) parts.push(`_+${sel.more} weitere – alle mit \`/neu\`_`);
  if (input.truncated) parts.push('_Hinweis: Sehr viele Neuzugänge – ältere Einträge können fehlen._');
  const embed = new EmbedBuilder()
    .setColor(Colors.plex)
    .setAuthor({ name: 'Plex · Neu hinzugefügt' })
    .setTitle('🆕  Neu hinzugefügt')
    .setDescription(truncate(parts.join('\n\n'), 4000))
    .setFooter({ text: DIGEST_FOOTER, iconURL: FOOTER_ICONS.bot });
  const poster = safePosterUrl(input.posterUrl);
  if (poster) embed.setThumbnail(poster);
  return embed;
}
