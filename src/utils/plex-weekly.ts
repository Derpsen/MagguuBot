import { createHash } from 'node:crypto';
import { EmbedBuilder } from 'discord.js';
import { Colors, FOOTER_ICONS, truncate } from '../embeds/colors.js';
import type { TautulliDateSeries, TautulliStatRow, TautulliStatSection } from '../services/tautulli.js';
import { localScheduleParts } from './schedule.js';

/**
 * Pure part of the weekly Plex statistics card: Tautulli payloads → stats → embed,
 * plus the cron arithmetic. No I/O, so every branch is testable with fixtures.
 */

export const PLEX_WEEKLY_DAYS = 7;
/** Rows requested per Tautulli home-stat list; also the cap behind the "active users" count. */
export const PLEX_WEEKLY_STATS_COUNT = 25;
export const PLEX_WEEKLY_TOP_N = 5;
export const PLEX_WEEKLY_FOOTER = 'MagguuBot · Plex-Wochenstatistik';

export interface WeeklyItem {
  name: string;
  year: string | null;
  plays: number;
  seconds: number;
}

export interface PlexWeeklyStats {
  days: number;
  totalPlays: number;
  totalSeconds: number;
  /** Where the totals come from: per-day history series, or summed from the user ranking (fallback). */
  totalsSource: 'history' | 'users';
  userCount: number;
  userCountCapped: boolean;
  movies: WeeklyItem[];
  shows: WeeklyItem[];
  users: WeeklyItem[];
}

export interface PlexWeeklyRaw {
  home: TautulliStatSection[];
  plays?: TautulliDateSeries | null;
  duration?: TautulliDateSeries | null;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function section(sections: TautulliStatSection[], id: string): TautulliStatRow[] {
  const found = sections.find((s) => s.stat_id === id);
  return Array.isArray(found?.rows) ? found.rows : [];
}

function toItems(rows: TautulliStatRow[], kind: 'title' | 'user', limit: number): WeeklyItem[] {
  return rows
    .map((row): WeeklyItem => {
      const name = kind === 'user'
        ? (row.friendly_name?.trim() || row.user?.trim() || 'Unbekannt')
        : (row.title?.trim() || 'Unbekannt');
      const year = kind === 'title' && row.year ? String(row.year) : null;
      return { name, year, plays: num(row.total_plays), seconds: num(row.total_duration) };
    })
    .filter((item) => item.plays > 0)
    .sort((a, b) => b.plays - a.plays || b.seconds - a.seconds || a.name.localeCompare(b.name, 'de'))
    .slice(0, limit);
}

function seriesTotal(series: TautulliDateSeries | null | undefined): number | null {
  if (!series || !Array.isArray(series.series)) return null;
  let total = 0;
  for (const s of series.series) {
    if (!Array.isArray(s?.data)) continue;
    for (const value of s.data) total += num(value);
  }
  return total;
}

export function aggregatePlexWeekly(raw: PlexWeeklyRaw, topN = PLEX_WEEKLY_TOP_N): PlexWeeklyStats {
  const userRows = section(raw.home, 'top_users');
  const allUsers = toItems(userRows, 'user', Number.MAX_SAFE_INTEGER);
  const playsTotal = seriesTotal(raw.plays);
  const durationTotal = seriesTotal(raw.duration);
  const history = playsTotal !== null && durationTotal !== null;
  return {
    days: PLEX_WEEKLY_DAYS,
    totalPlays: history ? playsTotal : allUsers.reduce((sum, u) => sum + u.plays, 0),
    totalSeconds: history ? durationTotal : allUsers.reduce((sum, u) => sum + u.seconds, 0),
    totalsSource: history ? 'history' : 'users',
    userCount: allUsers.length,
    userCountCapped: userRows.length >= PLEX_WEEKLY_STATS_COUNT,
    movies: toItems(section(raw.home, 'top_movies'), 'title', topN),
    shows: toItems(section(raw.home, 'top_tv'), 'title', topN),
    users: allUsers.slice(0, topN),
  };
}

export function formatWatchTime(seconds: number): string {
  if (!(seconds > 0)) return '0 h';
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const RANK = ['🥇', '🥈', '🥉'];

function line(item: WeeklyItem, rank: number, withYear: boolean): string {
  const medal = RANK[rank] ?? `**${rank + 1}.**`;
  const year = withYear && item.year ? ` (${item.year})` : '';
  const time = item.seconds > 0 ? ` · ${formatWatchTime(item.seconds)}` : '';
  return `${medal} **${truncate(item.name, 48)}**${year} — ${item.plays} ${item.plays === 1 ? 'Play' : 'Plays'}${time}`;
}

function listField(items: WeeklyItem[], withYear: boolean, empty: string): string {
  return items.length === 0 ? `_${empty}_` : items.map((item, i) => line(item, i, withYear)).join('\n');
}

function dayLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

export function buildPlexWeeklyEmbed(stats: PlexWeeklyStats, now: Date, timeZone: string): EmbedBuilder {
  const from = new Date(now.getTime() - stats.days * 24 * 60 * 60_000);
  const users = stats.userCountCapped ? `${stats.userCount}+` : String(stats.userCount);
  const embed = new EmbedBuilder()
    .setColor(Colors.plex)
    .setAuthor({ name: `Plex · letzte ${stats.days} Tage` })
    .setTitle('📊  Plex-Wochenstatistik')
    .setTimestamp(now)
    .setFooter({ text: PLEX_WEEKLY_FOOTER, iconURL: FOOTER_ICONS.bot });

  if (stats.totalPlays === 0 && stats.movies.length === 0 && stats.shows.length === 0 && stats.users.length === 0) {
    return embed.setDescription(`${dayLabel(from, timeZone)} – ${dayLabel(now, timeZone)}\n\n_Keine Wiedergaben in den letzten ${stats.days} Tagen._`);
  }

  return embed
    .setDescription(
      `${dayLabel(from, timeZone)} – ${dayLabel(now, timeZone)}\n` +
      `▶️ **${stats.totalPlays}** ${stats.totalPlays === 1 ? 'Play' : 'Plays'} · ⏱️ **${formatWatchTime(stats.totalSeconds)}** Wiedergabe · 👥 **${users}** aktive Nutzer`,
    )
    .addFields(
      { name: '🎬 Top Filme', value: listField(stats.movies, true, 'Keine Film-Plays.'), inline: false },
      { name: '📺 Top Serien', value: listField(stats.shows, false, 'Keine Serien-Plays.'), inline: false },
      { name: '🏆 Aktivste Nutzer', value: listField(stats.users, false, 'Keine Nutzeraktivität.'), inline: false },
    );
}

/** Content hash without the timestamp: identical content ⇒ identical hash ⇒ no edit. */
export function plexWeeklyHash(embed: EmbedBuilder): string {
  const json = { ...embed.toJSON() } as Record<string, unknown>;
  delete json.timestamp;
  return createHash('sha256').update(JSON.stringify(json)).digest('hex');
}

// ─── cron arithmetic ───────────────────────────────────────────────────────

/**
 * The next weekly run strictly after `now`: first local `hour:00` on weekday `day` (0 = Sunday)
 * in `timeZone`. Scans in 15 minute steps, so it follows DST shifts and half-hour zones.
 */
export function nextWeeklyRun(now: Date, timeZone: string, day: number, hour: number): Date | null {
  const STEP = 15 * 60_000;
  let t = Math.floor(now.getTime() / STEP) * STEP + STEP;
  for (let i = 0; i < 8 * 24 * 4 + 8; i += 1, t += STEP) {
    const local = localScheduleParts(new Date(t), timeZone);
    if (local.day !== day || local.hour !== hour) continue;
    const prev = localScheduleParts(new Date(t - STEP), timeZone);
    if (prev.day === day && prev.hour === hour) continue;
    return new Date(t);
  }
  return null;
}

/**
 * Whether the weekly card is due: the schedule period (from `weeklyPeriodKey`) differs from the
 * last period that finished successfully. Returns that period key, or null when nothing is due.
 */
export function duePlexWeeklyPeriod(periodKey: string | null, lastDonePeriod: string | undefined): string | null {
  if (!periodKey) return null;
  return lastDonePeriod === periodKey ? null : periodKey;
}
