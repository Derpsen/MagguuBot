import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { Colors, FOOTER_ICONS } from '../embeds/colors.js';
import type { TautulliRecentRaw } from '../services/tautulli.js';
import { clipPlexText, escapePlexMarkdown } from './plex-card.js';

/** `/neu`: new Plex titles of the last N days. Pure part (prepare, filter, paginate, embed, customId, poster guard). */

export type NeuType = 'all' | 'movies' | 'shows';
export type NeuKind = 'movie' | 'show';

export const NEU_DEFAULT_DAYS = 7;
export const NEU_MIN_DAYS = 1;
export const NEU_MAX_DAYS = 30;
export const NEU_PAGE_SIZE = 8;
/** Entries requested per media type from Tautulli; reaching it means older entries may be missing. */
export const NEU_FETCH_COUNT = 150;
export const NEU_FOOTER = 'MagguuBot  ·  /neu';
const MAX_TITLE = 80;

export interface NeuItem {
  kind: NeuKind;
  title: string;
  year: string | null;
  /** Epoch ms of the newest addition. */
  addedAt: number;
  /** e.g. `Staffel 2`, `S02E05`, `S02 · 4 Folgen`; null for movies. */
  detail: string | null;
}

export function clampNeuDays(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return NEU_DEFAULT_DAYS;
  return Math.min(NEU_MAX_DAYS, Math.max(NEU_MIN_DAYS, Math.trunc(value)));
}

function toInt(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function yearOf(value: string | number | undefined): string | null {
  const n = toInt(value);
  return n !== null && n >= 1850 && n <= 2200 ? String(n) : null;
}

function seasonOf(raw: TautulliRecentRaw): number | null {
  const idx = toInt(raw.parent_media_index);
  if (idx !== null && idx >= 0) return idx;
  const m = /(\d+)\s*$/.exec(raw.parent_title ?? '');
  return m ? Number.parseInt(m[1]!, 10) : null;
}

const pad = (n: number): string => String(n).padStart(2, '0');

interface ShowGroup {
  title: string;
  year: string | null;
  addedAt: number;
  seasonEntries: Set<number>;
  episodeSeasons: Set<number>;
  episodes: Array<{ season: number | null; episode: number | null }>;
}

function showDetail(g: ShowGroup): string | null {
  const seasons = [...new Set([...g.seasonEntries, ...g.episodeSeasons])].sort((a, b) => a - b);
  const episodes = g.episodes.length;
  if (episodes === 1 && g.seasonEntries.size === 0) {
    const e = g.episodes[0]!;
    if (e.season !== null && e.episode !== null) return `S${pad(e.season)}E${pad(e.episode)}`;
  }
  const parts: string[] = [];
  if (seasons.length === 1) parts.push(g.seasonEntries.size === 0 ? `S${pad(seasons[0]!)}` : `Staffel ${seasons[0]}`);
  else if (seasons.length > 1) parts.push(`Staffeln ${seasons.join(', ')}`);
  if (episodes > 1) parts.push(`${episodes} Folgen`);
  return parts.length ? parts.join(' · ') : null;
}

/** Turns raw Tautulli entries into display items inside the window, newest first. Posters/thumb paths are never read. */
export function prepareNeuItems(
  raw: readonly TautulliRecentRaw[],
  opts: { now: number; days: number; type: NeuType },
): NeuItem[] {
  const cutoff = opts.now - clampNeuDays(opts.days) * 86_400_000;
  const items: NeuItem[] = [];
  const shows = new Map<string, ShowGroup>();

  for (const entry of raw) {
    const added = toInt(entry.added_at);
    if (added === null || added <= 0) continue;
    const addedAt = added * 1000;
    if (addedAt < cutoff || addedAt > opts.now + 86_400_000) continue;
    const mediaType = entry.media_type ?? '';

    if (mediaType === 'movie') {
      if (opts.type === 'shows') continue;
      const title = clipPlexText(entry.title, MAX_TITLE);
      if (!title) continue;
      items.push({ kind: 'movie', title, year: yearOf(entry.year), addedAt, detail: null });
      continue;
    }
    if (mediaType !== 'show' && mediaType !== 'season' && mediaType !== 'episode') continue;
    if (opts.type === 'movies') continue;

    const showTitle = clipPlexText(mediaType === 'show' ? entry.title : entry.grandparent_title || entry.title, MAX_TITLE);
    if (!showTitle) continue;
    const key = showTitle.toLocaleLowerCase('de-DE');
    let g = shows.get(key);
    if (!g) {
      g = { title: showTitle, year: null, addedAt, seasonEntries: new Set(), episodeSeasons: new Set(), episodes: [] };
      shows.set(key, g);
    }
    g.addedAt = Math.max(g.addedAt, addedAt);
    if (mediaType === 'show') g.year = yearOf(entry.year) ?? g.year;
    if (mediaType === 'season') {
      const s = toInt(entry.media_index) ?? seasonOf(entry);
      if (s !== null) g.seasonEntries.add(s);
    }
    if (mediaType === 'episode') {
      const s = seasonOf(entry);
      if (s !== null) g.episodeSeasons.add(s);
      g.episodes.push({ season: s, episode: toInt(entry.media_index) });
    }
  }

  for (const g of shows.values()) {
    items.push({ kind: 'show', title: g.title, year: g.year, addedAt: g.addedAt, detail: showDetail(g) });
  }
  return items.sort((a, b) => b.addedAt - a.addedAt || a.title.localeCompare(b.title, 'de'));
}

export function neuPageCount(total: number, pageSize = NEU_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function neuPage<T>(items: readonly T[], page: number, pageSize = NEU_PAGE_SIZE): { items: T[]; page: number; pages: number } {
  const pages = neuPageCount(items.length, pageSize);
  const p = Math.min(pages - 1, Math.max(0, Number.isFinite(page) ? Math.trunc(page) : 0));
  return { items: items.slice(p * pageSize, (p + 1) * pageSize), page: p, pages };
}

// ---- poster guard ---------------------------------------------------------------------------------

const POSTER_HOSTS = ['image.tmdb.org', 'artworks.thetvdb.com', 'assets.fanart.tv', 'thetvdb.com'];

/**
 * Only public artwork CDNs without any query string, credentials or token are allowed as embed images.
 * Everything else (Plex/Tautulli proxy URLs, local *arr media paths) is dropped.
 */
export function safePosterUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null;
  const host = u.hostname.toLowerCase();
  if (!POSTER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  if (/token|apikey|api_key|x-plex/i.test(value)) return null;
  return u.toString();
}

export function posterKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

// ---- custom id ------------------------------------------------------------------------------------

const TYPE_CODE: Record<NeuType, string> = { all: 'a', movies: 'f', shows: 's' };
const CODE_TYPE: Record<string, NeuType> = { a: 'all', f: 'movies', s: 'shows' };

export interface NeuView {
  page: number;
  days: number;
  type: NeuType;
  userId: string;
}

export function encodeNeuId(view: NeuView): string {
  return `neu:${Math.max(0, Math.trunc(view.page))}:${clampNeuDays(view.days)}:${TYPE_CODE[view.type]}:${view.userId}`;
}

export function decodeNeuId(customId: string): NeuView | null {
  const m = /^neu:(\d{1,4}):(\d{1,2}):([afs]):(\d{5,25})$/.exec(customId);
  if (!m) return null;
  const days = Number.parseInt(m[2]!, 10);
  if (days < NEU_MIN_DAYS || days > NEU_MAX_DAYS) return null;
  return { page: Number.parseInt(m[1]!, 10), days, type: CODE_TYPE[m[3]!]!, userId: m[4]! };
}

// ---- embed ----------------------------------------------------------------------------------------

const TYPE_LABEL: Record<NeuType, string> = { all: 'Filme & Serien', movies: 'Filme', shows: 'Serien' };

function itemLine(item: NeuItem): string {
  const icon = item.kind === 'movie' ? '🎬' : '📺';
  const year = item.year ? ` (${item.year})` : '';
  const detail = item.detail ? ` · ${escapePlexMarkdown(item.detail)}` : '';
  return `${icon} **${escapePlexMarkdown(item.title)}**${year}${detail} · <t:${Math.floor(item.addedAt / 1000)}:R>`;
}

export interface NeuEmbedInput {
  items: readonly NeuItem[];
  page: number;
  days: number;
  type: NeuType;
  /** Tautulli returned the maximum count, so older entries in the window may be missing. */
  truncated?: boolean;
  posterUrl?: string | null;
}

export function buildNeuEmbed(input: NeuEmbedInput): { embed: EmbedBuilder; page: number; pages: number } {
  const slice = neuPage(input.items, input.page);
  const embed = new EmbedBuilder()
    .setColor(Colors.plex)
    .setAuthor({ name: `Plex · letzte ${input.days} ${input.days === 1 ? 'Tag' : 'Tage'} · ${TYPE_LABEL[input.type]}` })
    .setTitle('🆕  Neu auf Plex')
    .setFooter({
      text: `${NEU_FOOTER}  ·  Seite ${slice.page + 1}/${slice.pages}  ·  ${input.items.length} Titel`,
      iconURL: FOOTER_ICONS.bot,
    });
  if (slice.items.length === 0) {
    embed.setDescription(`_Keine neuen ${TYPE_LABEL[input.type]} in den letzten ${input.days} ${input.days === 1 ? 'Tag' : 'Tagen'}._`);
  } else {
    const note = input.truncated ? `\n\n_Hinweis: Sehr viele Neuzugänge – ältere Einträge können fehlen._` : '';
    embed.setDescription(slice.items.map(itemLine).join('\n') + note);
  }
  const poster = safePosterUrl(input.posterUrl);
  if (poster) embed.setThumbnail(poster);
  return { embed, page: slice.page, pages: slice.pages };
}

export function buildNeuComponents(view: NeuView, pages: number): ActionRowBuilder<ButtonBuilder>[] {
  if (pages <= 1) return [];
  const prev = new ButtonBuilder()
    .setCustomId(encodeNeuId({ ...view, page: Math.max(0, view.page - 1) }))
    .setLabel('Zurück')
    .setEmoji('◀️')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(view.page <= 0);
  const label = new ButtonBuilder()
    .setCustomId(`neu-page:${view.page}`)
    .setLabel(`${view.page + 1} / ${pages}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);
  const next = new ButtonBuilder()
    .setCustomId(encodeNeuId({ ...view, page: Math.min(pages - 1, view.page + 1) }))
    .setLabel('Weiter')
    .setEmoji('▶️')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(view.page >= pages - 1);
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(prev, label, next)];
}

export const NEU_ERROR_TEXT = '❌ Die Plex-Daten sind gerade nicht erreichbar. Bitte versuche es in ein paar Minuten noch einmal.';
export const NEU_NOT_CONFIGURED_TEXT = '❌ Plex/Tautulli ist beim Bot nicht eingerichtet, `/neu` ist daher nicht verfügbar.';
