import type { EmbedBuilder } from 'discord.js';
import {
  applyPlexCardEvent,
  buildPlexCardEmbed,
  closePlexCardSessions,
  emptyPlexCardState,
  plexCardHash,
  PLEX_CARD_SESSION_TTL_MS,
  type PlexCardEvent,
  type PlexCardSession,
  type PlexCardState,
} from '../utils/plex-card.js';

/**
 * One Plex activity card per channel, edited in place.
 *
 * - The message id is persisted (`PlexCardStore`) so a restart edits the same message.
 * - Events only change the stored state and arm a debounce timer; a burst becomes one edit.
 * - A flush with an unchanged embed hash does nothing (no edit, no post).
 * - A new message is posted only when there is none yet or the old one is gone
 *   (Unknown Message 10008, not our own message 50005) or edits kept failing.
 * - State changes are synchronous store writes (atomic in the single JS thread); all Discord
 *   calls run through one promise queue, so parallel events/flushes can never double-post.
 */

export interface PlexCardRecord {
  channelId: string;
  messageId: string | null;
  contentHash: string | null;
  state: PlexCardState;
  postedAt: number | null;
}

export interface PlexCardStore {
  load(channelId: string): PlexCardRecord | null;
  save(record: PlexCardRecord): void;
}

export interface PlexCardGateway {
  post(channelId: string, embed: EmbedBuilder): Promise<string>;
  edit(channelId: string, messageId: string, embed: EmbedBuilder): Promise<void>;
}

export interface PlexCardTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PlexCardManagerOptions {
  store: PlexCardStore;
  gateway: PlexCardGateway;
  now?: () => number;
  timers?: PlexCardTimers;
  debounceMs?: number;
  maxWaitMs?: number;
  retryMs?: number;
  /** Consecutive failed edits (non-gone errors) before giving up on the message and posting a new one. */
  maxEditFailures?: number;
  /** Minimum gap between two reposts after repeated edit failures. */
  repostCooldownMs?: number;
  /** Minimum gap between two reposts after the message was deleted (Unknown Message). */
  goneCooldownMs?: number;
  log?: (level: 'info' | 'warn', msg: string, data?: Record<string, unknown>) => void;
}

export type PlexCardFlushResult =
  | 'unchanged'
  | 'edited'
  | 'posted'
  | 'reposted'
  | 'retry'
  | 'cooldown';

export const PLEX_CARD_DEBOUNCE_MS = 4_000;
export const PLEX_CARD_MAX_WAIT_MS = 15_000;
export const PLEX_CARD_RETRY_MS = 30_000;
export const PLEX_CARD_MAX_EDIT_FAILURES = 5;
export const PLEX_CARD_REPOST_COOLDOWN_MS = 10 * 60_000;
export const PLEX_CARD_GONE_COOLDOWN_MS = 60_000;

const DISCORD_UNKNOWN_MESSAGE = 10_008;
const DISCORD_CANNOT_EDIT_OTHERS = 50_005;

export function discordErrorCode(err: unknown): number | null {
  if (!err || typeof err !== 'object' || !('code' in err)) return null;
  const code = (err as { code: unknown }).code;
  return typeof code === 'number' ? code : null;
}

/** The stored message can never be edited again: deleted, or not authored by this bot. */
export function isMessageGone(err: unknown): boolean {
  const code = discordErrorCode(err);
  return code === DISCORD_UNKNOWN_MESSAGE || code === DISCORD_CANNOT_EDIT_OTHERS;
}

interface Pending {
  timer: unknown;
  firstAt: number;
}

export class PlexCardManager {
  private readonly store: PlexCardStore;
  private readonly gateway: PlexCardGateway;
  private readonly now: () => number;
  private readonly timers: PlexCardTimers;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly retryMs: number;
  private readonly maxEditFailures: number;
  private readonly repostCooldownMs: number;
  private readonly goneCooldownMs: number;
  private readonly log: NonNullable<PlexCardManagerOptions['log']>;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, Pending>();
  private readonly failures = new Map<string, number>();

  constructor(options: PlexCardManagerOptions) {
    this.store = options.store;
    this.gateway = options.gateway;
    this.now = options.now ?? Date.now;
    this.timers = options.timers ?? {
      setTimeout: (fn, ms) => {
        const handle = setTimeout(fn, ms);
        handle.unref?.();
        return handle;
      },
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    };
    this.debounceMs = options.debounceMs ?? PLEX_CARD_DEBOUNCE_MS;
    this.maxWaitMs = options.maxWaitMs ?? PLEX_CARD_MAX_WAIT_MS;
    this.retryMs = options.retryMs ?? PLEX_CARD_RETRY_MS;
    this.maxEditFailures = options.maxEditFailures ?? PLEX_CARD_MAX_EDIT_FAILURES;
    this.repostCooldownMs = options.repostCooldownMs ?? PLEX_CARD_REPOST_COOLDOWN_MS;
    this.goneCooldownMs = options.goneCooldownMs ?? PLEX_CARD_GONE_COOLDOWN_MS;
    this.log = options.log ?? (() => {});
  }

  private enqueue<T>(job: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private loadRecord(channelId: string): PlexCardRecord {
    return this.store.load(channelId) ?? {
      channelId,
      messageId: null,
      contentHash: null,
      state: emptyPlexCardState(),
      postedAt: null,
    };
  }

  /** Folds an event into the persisted state and schedules one debounced flush. */
  handleEvent(channelId: string, event: PlexCardEvent): boolean {
    const record = this.loadRecord(channelId);
    const state = applyPlexCardEvent(record.state, event);
    if (state === record.state) return false;
    this.store.save({ ...record, state });
    this.schedule(channelId, this.debounceMs, true);
    return true;
  }

  /** Moves sessions out of the running list; used by the stale/orphan reconcile. */
  closeSessions(channelId: string, shouldClose: (session: PlexCardSession) => boolean): number {
    const record = this.loadRecord(channelId);
    const state = closePlexCardSessions(record.state, shouldClose, this.now());
    if (state === record.state) return 0;
    this.store.save({ ...record, state });
    this.schedule(channelId, this.debounceMs, true);
    return record.state.sessions.length - state.sessions.length;
  }

  getState(channelId: string): PlexCardState {
    return this.loadRecord(channelId).state;
  }

  private schedule(channelId: string, delayMs: number, capByMaxWait = false): void {
    const now = this.now();
    const existing = this.pending.get(channelId);
    let firstAt = now;
    if (existing) {
      firstAt = existing.firstAt;
      this.timers.clearTimeout(existing.timer);
    }
    // Trailing debounce, but never wait longer than maxWait since the first unflushed event.
    const delay = capByMaxWait ? Math.max(0, Math.min(delayMs, firstAt + this.maxWaitMs - now)) : delayMs;
    const timer = this.timers.setTimeout(() => {
      this.pending.delete(channelId);
      void this.flush(channelId).catch((err: unknown) => {
        this.log('warn', 'Plex card flush failed', { channelId, error: String(err) });
      });
    }, delay);
    this.pending.set(channelId, { timer, firstAt });
  }

  /** Renders and syncs the card now. Safe to call concurrently; calls run one after another. */
  flush(channelId: string): Promise<PlexCardFlushResult> {
    return this.enqueue(() => this.flushLocked(channelId));
  }

  private async flushLocked(channelId: string): Promise<PlexCardFlushResult> {
    const record = this.loadRecord(channelId);
    const embed = buildPlexCardEmbed(record.state);
    const hash = plexCardHash(embed);

    if (record.messageId && record.contentHash === hash) return 'unchanged';
    // Nothing to show and nothing ever posted: do not create an empty card.
    if (!record.messageId && record.state.sessions.length === 0 && record.state.recent.length === 0) {
      return 'unchanged';
    }

    if (!record.messageId) return this.post(channelId, embed, hash, 'posted', 0);

    try {
      await this.gateway.edit(channelId, record.messageId, embed);
    } catch (err) {
      if (isMessageGone(err)) {
        this.log('info', 'Plex card message is gone, posting a new one', { channelId, code: discordErrorCode(err) });
        return this.post(channelId, embed, hash, 'reposted', this.goneCooldownMs);
      }
      const count = (this.failures.get(channelId) ?? 0) + 1;
      this.failures.set(channelId, count);
      this.log('warn', 'Plex card edit failed', { channelId, attempt: count, error: String(err) });
      if (count >= this.maxEditFailures) {
        return this.post(channelId, embed, hash, 'reposted', this.repostCooldownMs);
      }
      this.schedule(channelId, this.retryMs);
      return 'retry';
    }
    this.failures.delete(channelId);
    this.store.save({ ...this.loadRecord(channelId), contentHash: hash });
    return 'edited';
  }

  private async post(
    channelId: string,
    embed: EmbedBuilder,
    hash: string,
    result: 'posted' | 'reposted',
    cooldownMs: number,
  ): Promise<PlexCardFlushResult> {
    const now = this.now();
    const record = this.loadRecord(channelId);
    if (cooldownMs > 0 && record.postedAt !== null && now - record.postedAt < cooldownMs) {
      // Keep the old message id: a later flush retries the edit; reposts are rate-limited per channel.
      this.schedule(channelId, Math.max(this.retryMs, cooldownMs - (now - record.postedAt)));
      return 'cooldown';
    }
    try {
      const messageId = await this.gateway.post(channelId, embed);
      this.failures.delete(channelId);
      this.store.save({ ...this.loadRecord(channelId), messageId, contentHash: hash, postedAt: now });
      return result;
    } catch (err) {
      this.log('warn', 'Plex card post failed', { channelId, error: String(err) });
      this.schedule(channelId, this.retryMs);
      return 'retry';
    }
  }

  /**
   * Periodic housekeeping: drops sessions that had no event for the TTL and
   * flushes cards whose last flush is still outstanding (e.g. after a failed edit).
   */
  tick(channelId: string): Promise<PlexCardFlushResult> {
    const now = this.now();
    this.closeSessions(channelId, (s) => now - s.updatedAt >= PLEX_CARD_SESSION_TTL_MS);
    return this.flush(channelId);
  }

  /** Flushes anything still waiting for its debounce timer (graceful shutdown). */
  async flushAllPending(): Promise<void> {
    const channels = [...this.pending.keys()];
    for (const channelId of channels) {
      const pending = this.pending.get(channelId);
      if (pending) this.timers.clearTimeout(pending.timer);
      this.pending.delete(channelId);
      await this.flush(channelId).catch(() => undefined);
    }
  }
}
