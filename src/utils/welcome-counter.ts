import { EmbedBuilder } from 'discord.js';
import { Colors } from '../embeds/colors.js';

/**
 * Welcome counter card (public welcome channel): pure part. ONE self-editing message that shows two plain numbers.
 * No names, ids, pings, avatars or images, so a join never exposes a person in the public channel.
 */

export const WELCOME_COUNTER_FOOTER = 'MagguuBot · Willkommen-Zähler';

/** Minimum time between two refreshes triggered by joins/leaves (a join wave collapses into one edit). */
export const WELCOME_COUNTER_WINDOW_MS = 60_000;

export interface WelcomeCounterStats {
  /** Gateway cache `guild.memberCount`; null when the guild is not cached yet. */
  members: number | null;
  /** Distinct members who (re)joined since local Monday 00:00 of the current week. */
  newThisWeek: number;
  /** Local Monday of the week as YYYY-MM-DD. */
  weekStart: string;
}

function num(n: number): string {
  return new Intl.NumberFormat('de-DE').format(n);
}

function germanDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return y && m && d ? `${d}.${m}.${y}` : isoDate;
}

/** No timestamp: the content hash must only change with the numbers. */
export function buildWelcomeCounterEmbed(stats: WelcomeCounterStats): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setTitle('👋 Willkommen')
    .setDescription(`Schön, dass du da bist. Regeln und Rollen findest du in den angepinnten Karten hier.\nWoche seit ${germanDate(stats.weekStart)} (Mo–So)`)
    .addFields(
      { name: 'Mitglieder', value: stats.members === null ? '–' : num(Math.max(0, Math.trunc(stats.members))), inline: true },
      { name: 'Neu diese Woche', value: num(Math.max(0, Math.trunc(stats.newThisWeek))), inline: true },
    )
    .setFooter({ text: WELCOME_COUNTER_FOOTER });
}

export interface CoalescedTriggerOptions {
  run: () => Promise<unknown>;
  windowMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onError?: (err: unknown) => void;
}

/**
 * Leading + trailing throttle: `request()` runs at once when the last run is older than the window, otherwise it
 * schedules ONE run at the end of the window. Any number of requests inside a window result in at most one run, and the
 * last request is never lost (the trailing run sees the final numbers).
 */
export class CoalescedTrigger {
  private readonly windowMs: number;
  private lastRun: number | null = null;
  private timer: unknown = null;
  private running = false;
  private again = false;

  constructor(private readonly opts: CoalescedTriggerOptions) {
    this.windowMs = opts.windowMs ?? WELCOME_COUNTER_WINDOW_MS;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  request(): void {
    if (this.timer !== null) return;
    if (this.running) {
      this.again = true;
      return;
    }
    const wait = this.lastRun === null ? 0 : Math.max(0, this.lastRun + this.windowMs - this.now());
    if (wait === 0) {
      void this.fire();
      return;
    }
    const set = this.opts.setTimer ?? ((fn, ms) => {
      const handle = setTimeout(fn, ms);
      handle.unref();
      return handle;
    });
    this.timer = set(() => {
      this.timer = null;
      void this.fire();
    }, wait);
  }

  private async fire(): Promise<void> {
    this.running = true;
    this.lastRun = this.now();
    try {
      await this.opts.run();
    } catch (err) {
      this.opts.onError?.(err);
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        this.request();
      }
    }
  }

  /** Tests: drop a pending run AND forget the last run time (next request runs at once). */
  reset(): void {
    this.cancel();
    this.lastRun = null;
  }

  /** Shutdown: drop a pending trailing run. */
  cancel(): void {
    if (this.timer !== null) {
      (this.opts.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout)))(this.timer);
      this.timer = null;
    }
    this.again = false;
  }
}
