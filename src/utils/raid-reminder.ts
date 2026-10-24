import { EmbedBuilder } from 'discord.js';
import { Colors } from '../embeds/colors.js';
import { clipPlexText, escapePlexMarkdown } from './plex-card.js';

/**
 * Pure part of `/erinnerung`: weekday/time arithmetic in a time zone (DST-safe), input parsing and
 * sanitising, the due/stale decision and the reminder embed. No I/O, so every branch is testable.
 * Reminders are user defined (kind, weekday, time, optional text); no Blizzard API, no assumed raid times.
 */

export type ReminderKind = 'raid' | 'mythicplus' | 'other';

export const REMINDER_KINDS: readonly ReminderKind[] = ['raid', 'mythicplus', 'other'];
export const KIND_LABEL: Record<ReminderKind, string> = { raid: 'Raid', mythicplus: 'Mythic+', other: 'Sonstiges' };
const KIND_EMOJI: Record<ReminderKind, string> = { raid: '🏰', mythicplus: '🗝️', other: '⏰' };

/** Index = JS weekday (0 = Sunday), same convention as `localScheduleParts`. */
export const WEEKDAY_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'] as const;

export const MAX_REMINDERS_PER_USER = 5;
export const MAX_REMINDER_TEXT = 100;
/** A reminder that is more overdue than this (bot was down) is skipped, never sent late. */
export const REMINDER_GRACE_MS = 15 * 60_000;
export const DISCORD_CANNOT_DM_USER = 50007;

export function isReminderKind(value: string): value is ReminderKind {
  return (REMINDER_KINDS as readonly string[]).includes(value);
}

/** `18:30`, `9:05`, `18.30` or just `18`; null when out of range. */
export function parseReminderTime(raw: string): { hour: number; minute: number } | null {
  const m = /^\s*(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(?:uhr)?\s*$/i.exec(raw);
  if (!m) return null;
  const hour = Number.parseInt(m[1]!, 10);
  const minute = m[2] === undefined ? 0 : Number.parseInt(m[2], 10);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function formatReminderTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Clipped to 100 visible chars, control characters removed, markdown/mention syntax escaped; null when empty. */
export function sanitizeReminderText(raw: string | null | undefined): string | null {
  // Invisible / bidi-override characters are dropped first (they could disguise the text); then clip + escape.
  const visible = (raw ?? '').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '');
  const clipped = clipPlexText(visible, MAX_REMINDER_TEXT);
  return clipped ? escapePlexMarkdown(clipped) : null;
}

// ---- time zone arithmetic ---------------------------------------------------------------------------

interface LocalFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function localFields(ts: number, timeZone: string): LocalFields {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ts));
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** Offset of `timeZone` from UTC at `ts`, in ms (wall clock minus UTC). */
function zoneOffsetMs(ts: number, timeZone: string): number {
  const f = localFields(ts, timeZone);
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute) - Math.floor(ts / 60_000) * 60_000;
}

/**
 * UTC instant of a local wall-clock time. Ambiguous times (clocks go back) resolve to the first
 * occurrence; non-existent times (clocks go forward) resolve to the same offset shifted past the gap
 * (02:30 → 03:30 local), so a reminder is never skipped.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const before = zoneOffsetMs(wall - 86_400_000, timeZone);
  const after = zoneOffsetMs(wall + 86_400_000, timeZone);
  const matches = (candidate: number): boolean => {
    const f = localFields(candidate, timeZone);
    return f.year === year && f.month === month && f.day === day && f.hour === hour && f.minute === minute;
  };
  const candidates = [wall - before, wall - after].filter(matches);
  if (candidates.length > 0) return Math.min(...candidates);
  return wall - before;
}

/**
 * First instant strictly after `after` that is `hour:minute` local on weekday `day` (0 = Sunday)
 * in `timeZone`. Always within the next 8 local days.
 */
export function nextWeeklyOccurrence(after: number, timeZone: string, day: number, hour: number, minute: number): number {
  const start = localFields(after, timeZone);
  for (let offset = 0; offset <= 8; offset += 1) {
    const d = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));
    if (d.getUTCDay() !== day) continue;
    const t = zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute, timeZone);
    if (t > after) return t;
  }
  throw new Error('nextWeeklyOccurrence: no occurrence found'); // unreachable for valid input
}

// ---- due decision -------------------------------------------------------------------------------------

export type DueDecision = 'send' | 'stale' | 'wait';

/** `send` while at most 15 min overdue, `stale` when the bot missed it longer ago, `wait` when not due. */
export function decideDue(nextDueAt: number, now: number, graceMs: number = REMINDER_GRACE_MS): DueDecision {
  if (nextDueAt > now) return 'wait';
  return now - nextDueAt <= graceMs ? 'send' : 'stale';
}

// ---- display ------------------------------------------------------------------------------------------

export interface ReminderView {
  id: number;
  kind: ReminderKind;
  day: number;
  hour: number;
  minute: number;
  text: string | null;
  recurring: boolean;
  channelId: string | null;
  nextDueAt: number;
  pausedReason: string | null;
}

export const PAUSE_REASON_TEXT: Record<string, string> = {
  dm_closed: 'DMs vom Server sind für dich gesperrt – aktiviere Direktnachrichten und nutze `/erinnerung fortsetzen`',
  channel_unavailable: 'der Kanal ist nicht erreichbar oder dem Bot fehlen Rechte – prüfe das und nutze `/erinnerung fortsetzen`',
};

export function describeReminder(r: ReminderView): string {
  const when = `${WEEKDAY_NAMES[r.day] ?? '?'} ${formatReminderTime(r.hour, r.minute)}`;
  const repeat = r.recurring ? 'wöchentlich' : 'einmalig';
  const where = r.channelId ? `<#${r.channelId}>` : 'DM';
  const text = r.text ? ` · „${r.text}“` : '';
  const state = r.pausedReason
    ? `⏸️ pausiert: ${PAUSE_REASON_TEXT[r.pausedReason] ?? 'bitte `/erinnerung fortsetzen`'}`
    : `nächste: <t:${Math.floor(r.nextDueAt / 1000)}:F> (<t:${Math.floor(r.nextDueAt / 1000)}:R>)`;
  return `**#${r.id}** ${KIND_EMOJI[r.kind]} ${KIND_LABEL[r.kind]} · ${when} · ${repeat} · ${where}${text}\n${state}`;
}

export const REMINDER_FOOTER = 'MagguuBot  ·  /erinnerung aus zum Abbestellen';

export function buildReminderEmbed(r: Pick<ReminderView, 'kind' | 'text' | 'recurring'>): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.info)
    .setTitle(`${KIND_EMOJI[r.kind]}  ${KIND_LABEL[r.kind]}-Erinnerung`)
    .setDescription(r.text ?? 'Es ist soweit!')
    .setFooter({ text: REMINDER_FOOTER })
    .setTimestamp(new Date());
}

// ---- message payloads (strict mention handling) ---------------------------------------------------------

/** DM payload: nothing in it may ping anyone. */
export function reminderDmPayload(embed: EmbedBuilder): { embeds: EmbedBuilder[]; allowedMentions: { parse: never[] } } {
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

/** Channel payload: pings exactly the subscriber (never @everyone/@here/roles/other users). */
export function reminderChannelPayload(
  userId: string,
  embed: EmbedBuilder,
): { content: string; embeds: EmbedBuilder[]; allowedMentions: { parse: never[]; users: string[] } } {
  return { content: `<@${userId}>`, embeds: [embed], allowedMentions: { parse: [], users: [userId] } };
}
