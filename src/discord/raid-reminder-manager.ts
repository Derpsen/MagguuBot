import type { EmbedBuilder } from 'discord.js';
import { discordErrorCode, isPermanentDiscordError } from './plex-card-manager.js';
import {
  DISCORD_CANNOT_DM_USER,
  MAX_REMINDERS_PER_USER,
  buildReminderEmbed,
  decideDue,
  nextWeeklyOccurrence,
  pauseNoticeText,
  type ReminderKind,
  type ReminderView,
} from '../utils/raid-reminder.js';

/**
 * Subscriptions for user-defined Raid / Mythic+ reminders. Persistence and Discord are injected
 * (store + gateway), so limits, scheduling, DST, stale skipping and pausing are testable without a bot.
 * Failures are quiet by design: they are logged, never turned into an alarm message.
 */

export interface ReminderRow extends ReminderView {
  guildId: string;
  userId: string;
  /** Set once the creator was told about the pause (not set = still to be told). */
  pauseNotifiedAt?: number | null;
}

export interface NewReminder {
  guildId: string;
  userId: string;
  kind: ReminderKind;
  day: number;
  hour: number;
  minute: number;
  text: string | null;
  recurring: boolean;
  channelId: string | null;
  nextDueAt: number;
}

export interface ReminderStore {
  insert(input: NewReminder, now: number): ReminderRow;
  listByUser(guildId: string, userId: string): ReminderRow[];
  /** Active (not paused) rows whose `nextDueAt` is <= now. */
  due(now: number): ReminderRow[];
  update(
    id: number,
    patch: { nextDueAt?: number; pausedReason?: string | null; pausedAt?: number | null; pauseNotifiedAt?: number | null; lastSentAt?: number },
  ): void;
  delete(id: number): void;
  deleteAllByUser(guildId: string, userId: string): number;
}

export interface ReminderGateway {
  sendDm(userId: string, embed: EmbedBuilder): Promise<void>;
  sendChannel(channelId: string, userId: string, embed: EmbedBuilder): Promise<void>;
}

export interface RaidReminderOptions {
  store: ReminderStore;
  gateway: ReminderGateway;
  timeZone: string;
  now?: () => number;
  maxPerUser?: number;
  log?: (level: 'info' | 'warn', msg: string, data?: Record<string, unknown>) => void;
}

export type AddResult =
  | { ok: true; reminder: ReminderRow }
  | { ok: false; reason: 'limit' | 'duplicate'; limit?: number };

export interface TickSummary {
  sent: number;
  skipped: number;
  paused: number;
  failed: number;
}

export class RaidReminderManager {
  constructor(private readonly opts: RaidReminderOptions) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private log(level: 'info' | 'warn', msg: string, data?: Record<string, unknown>): void {
    this.opts.log?.(level, msg, data);
  }

  add(input: Omit<NewReminder, 'nextDueAt'>): AddResult {
    const limit = this.opts.maxPerUser ?? MAX_REMINDERS_PER_USER;
    const existing = this.opts.store.listByUser(input.guildId, input.userId);
    if (existing.length >= limit) return { ok: false, reason: 'limit', limit };
    const duplicate = existing.some(
      (r) =>
        r.kind === input.kind &&
        r.day === input.day &&
        r.hour === input.hour &&
        r.minute === input.minute &&
        r.channelId === input.channelId &&
        r.recurring === input.recurring &&
        (r.text ?? '') === (input.text ?? ''),
    );
    if (duplicate) return { ok: false, reason: 'duplicate' };
    const now = this.now();
    const nextDueAt = nextWeeklyOccurrence(now, this.opts.timeZone, input.day, input.hour, input.minute);
    return { ok: true, reminder: this.opts.store.insert({ ...input, nextDueAt }, now) };
  }

  list(guildId: string, userId: string): ReminderRow[] {
    return this.opts.store.listByUser(guildId, userId);
  }

  /** Opt-out: one subscription (by id, only the owner's) or all of them. Returns how many were removed. */
  remove(guildId: string, userId: string, id?: number): number {
    if (id === undefined) return this.opts.store.deleteAllByUser(guildId, userId);
    const row = this.opts.store.listByUser(guildId, userId).find((r) => r.id === id);
    if (!row) return 0;
    this.opts.store.delete(row.id);
    return 1;
  }

  /** Re-activates paused subscriptions; the next run is recomputed from now (nothing is sent retroactively). */
  resume(guildId: string, userId: string): number {
    const now = this.now();
    let resumed = 0;
    for (const r of this.opts.store.listByUser(guildId, userId)) {
      if (!r.pausedReason) continue;
      this.opts.store.update(r.id, {
        pausedReason: null,
        pausedAt: null,
        pauseNotifiedAt: null,
        nextDueAt: nextWeeklyOccurrence(now, this.opts.timeZone, r.day, r.hour, r.minute),
      });
      resumed += 1;
    }
    return resumed;
  }

  /**
   * Hint for the creator about paused subscriptions, returned ONCE per pause (marks them as told, so it is
   * neither repeated nor does it cause any DM attempt: the user sees it in their next /erinnerung reply).
   */
  takePauseNotice(guildId: string, userId: string): string | null {
    const pending = this.opts.store.listByUser(guildId, userId).filter((r) => r.pausedReason && !r.pauseNotifiedAt);
    const text = pauseNoticeText(pending);
    if (!text) return null;
    const now = this.now();
    for (const r of pending) this.opts.store.update(r.id, { pauseNotifiedAt: now });
    return text;
  }

  /** Moderation: remove a user's subscriptions (all or one id). Same effect as the user's own opt-out. */
  removeForModerator(guildId: string, targetUserId: string, id?: number): number {
    return this.remove(guildId, targetUserId, id);
  }

  /** The user left the server: their subscriptions are useless and are deleted. */
  removeAllForLeftUser(guildId: string, userId: string): number {
    return this.opts.store.deleteAllByUser(guildId, userId);
  }

  private advance(row: ReminderRow, now: number): void {
    if (!row.recurring) {
      this.opts.store.delete(row.id);
      return;
    }
    this.opts.store.update(row.id, {
      nextDueAt: nextWeeklyOccurrence(now, this.opts.timeZone, row.day, row.hour, row.minute),
    });
  }

  private pause(row: ReminderRow, reason: 'dm_closed' | 'channel_unavailable', now: number, code: number | null): void {
    this.opts.store.update(row.id, { pausedReason: reason, pausedAt: now, pauseNotifiedAt: null });
    this.log('warn', 'reminder subscription paused', { reminderId: row.id, reason, code });
  }

  /** One scheduler tick: send what is due (≤ 15 min overdue), skip what the bot missed, pause on permanent errors. */
  async tick(): Promise<TickSummary> {
    const now = this.now();
    const summary: TickSummary = { sent: 0, skipped: 0, paused: 0, failed: 0 };
    for (const row of this.opts.store.due(now)) {
      const decision = decideDue(row.nextDueAt, now);
      if (decision === 'wait') continue;
      if (decision === 'stale') {
        summary.skipped += 1;
        this.advance(row, now);
        continue;
      }
      const embed = buildReminderEmbed(row);
      try {
        if (row.channelId) await this.opts.gateway.sendChannel(row.channelId, row.userId, embed);
        else await this.opts.gateway.sendDm(row.userId, embed);
      } catch (err) {
        const code = discordErrorCode(err);
        if (!row.channelId && (code === DISCORD_CANNOT_DM_USER || code === 10013)) {
          // All of this user's DM subscriptions share the cause: pause them together (one log each).
          for (const sibling of this.opts.store.listByUser(row.guildId, row.userId)) {
            if (!sibling.channelId && !sibling.pausedReason) {
              this.pause(sibling, 'dm_closed', now, code);
              summary.paused += 1;
            }
          }
          continue;
        }
        if (row.channelId && isPermanentDiscordError(err)) {
          this.pause(row, 'channel_unavailable', now, code);
          summary.paused += 1;
          continue;
        }
        // Transient: the row stays due and is retried on the next tick until the 15 min grace is over.
        summary.failed += 1;
        this.log('warn', 'reminder delivery failed, will retry within the grace window', { reminderId: row.id, code });
        continue;
      }
      summary.sent += 1;
      this.opts.store.update(row.id, { lastSentAt: now });
      this.advance(row, now);
    }
    if (summary.skipped > 0) this.log('info', 'skipped overdue reminders (bot was offline)', { skipped: summary.skipped });
    return summary;
  }
}

// Per-user cooldown for creating subscriptions (in memory).
export const REMINDER_COOLDOWN_MS = 5_000;
const lastUse = new Map<string, number>();

export function reminderCooldownLeft(userId: string, now: number = Date.now(), cooldownMs: number = REMINDER_COOLDOWN_MS): number {
  const last = lastUse.get(userId);
  if (last !== undefined && now - last < cooldownMs) return cooldownMs - (now - last);
  lastUse.set(userId, now);
  if (lastUse.size > 500) for (const [id, at] of lastUse) if (now - at > cooldownMs) lastUse.delete(id);
  return 0;
}

export function resetReminderCooldown(): void {
  lastUse.clear();
}
