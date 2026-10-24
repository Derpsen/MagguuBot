import { createHash, createHmac, randomBytes } from 'node:crypto';
import { EmbedBuilder } from 'discord.js';
import { Colors, truncate } from '../embeds/colors.js';
import { escapePlexMarkdown } from './plex-card.js';
import { weeklyPeriodKey } from './schedule.js';

/**
 * Server health card: pure part (week key, anonymous active-user counter, embed, hash). No Discord, no DB.
 *
 * Privacy: "active users" are counted by a keyed hash (HMAC-SHA256 with a random per-week key that lives in memory
 * only, cut to 48 bits). Neither the key nor any hash is ever written to disk or logs; only the resulting NUMBER is
 * persisted. After the week (or a restart) key and hashes are gone, so nothing can be traced back to a person.
 */

export const SERVER_HEALTH_FOOTER = 'MagguuBot · Server-Health';
export const SERVER_HEALTH_TOP_COMMANDS = 5;
const MAX_COMMAND_NAME = 32;

/** Local Monday (YYYY-MM-DD) of the week that contains `date`; the week runs Monday to Sunday. */
export function healthWeekKey(date: Date, timeZone: string): string {
  return weeklyPeriodKey(date, timeZone, 1, 0) ?? '1970-01-01';
}

/** Only real command-name shapes are counted (Discord: lowercase letters, digits, - and _). */
export function sanitizeCommandName(name: string): string | null {
  const n = name.trim().toLowerCase();
  return /^[\p{L}\p{N}_-]{1,32}$/u.test(n) && n.length <= MAX_COMMAND_NAME ? n : null;
}

export interface ActiveUserCounterOptions {
  /** The persisted number of this week from before a restart (a plain count, no ids). */
  loadBase: (week: string) => number;
  /** Persists the running number. Called only when a new distinct hash was added. */
  saveCount: (week: string, count: number) => void;
  /** Called once when a new week starts (purge of old rows). */
  onWeek?: (week: string) => void;
  /** Test seam; default is 32 random bytes. */
  randomKey?: () => Buffer;
}

export class ActiveUserCounter {
  private week: string | null = null;
  private key: Buffer = Buffer.alloc(0);
  private seen = new Set<string>();
  private base = 0;

  constructor(private readonly opts: ActiveUserCounterOptions) {}

  private roll(week: string): void {
    this.week = week;
    this.key = (this.opts.randomKey ?? (() => randomBytes(32)))();
    this.seen = new Set();
    this.base = Math.max(0, Math.floor(this.opts.loadBase(week)) || 0);
    this.opts.onWeek?.(week);
  }

  private ensure(week: string): void {
    if (this.week !== week) this.roll(week);
  }

  /** Counts a user once per week (and per process run); never stores or returns the id. */
  record(userId: string, week: string): void {
    if (!userId) return;
    this.ensure(week);
    const digest = createHmac('sha256', this.key).update(userId).digest('hex').slice(0, 12);
    if (this.seen.has(digest)) return;
    this.seen.add(digest);
    this.opts.saveCount(week, this.base + this.seen.size);
  }

  count(week: string): number {
    this.ensure(week);
    return this.base + this.seen.size;
  }

  /** Hash set size, for tests (no ids exposed). */
  get distinctInMemory(): number {
    return this.seen.size;
  }
}

export interface ServerHealthStats {
  members: number | null;
  activeUsers: number;
  commandsTotal: number;
  /** Most used first. */
  topCommands: { name: string; count: number }[];
  weekStart: string;
}

function germanDate(dayKey: string): string {
  const [y, m, d] = dayKey.split('-');
  return `${d}.${m}.${y}`;
}

function num(n: number): string {
  return new Intl.NumberFormat('de-DE').format(n);
}

/** One embed; no timestamp (the hash must only change with the content). */
export function buildServerHealthEmbed(stats: ServerHealthStats): EmbedBuilder {
  const top = stats.topCommands.slice(0, SERVER_HEALTH_TOP_COMMANDS);
  const lines = top.map((c, i) => `${i + 1}. /${escapePlexMarkdown(c.name.slice(0, MAX_COMMAND_NAME))} · ${num(c.count)}×`);
  return new EmbedBuilder()
    .setColor(Colors.info)
    .setTitle('📊 Server-Health')
    .setDescription(`Woche seit ${germanDate(stats.weekStart)} (Mo–So)`)
    .addFields(
      { name: 'Mitglieder', value: stats.members === null ? '–' : num(stats.members), inline: true },
      { name: 'Aktive Nutzer', value: num(stats.activeUsers), inline: true },
      { name: 'Befehle', value: num(stats.commandsTotal), inline: true },
      { name: 'Top-Befehle', value: truncate(lines.length > 0 ? lines.join('\n') : 'Noch keine Befehle.', 1024) },
    )
    .setFooter({ text: SERVER_HEALTH_FOOTER });
}

export function serverHealthHash(embed: EmbedBuilder): string {
  const json = { ...embed.toJSON() } as Record<string, unknown>;
  delete json.timestamp;
  return createHash('sha256').update(JSON.stringify(json)).digest('hex');
}
