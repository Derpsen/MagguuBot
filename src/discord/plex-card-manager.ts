import type { EmbedBuilder } from 'discord.js';
import {
  applyPlexCardEvent,
  buildPlexUserCardEmbed,
  closePlexCardSessions,
  emptyPlexCardState,
  plexCardHash,
  PLEX_CARD_SESSION_TTL_MS,
  type PlexCardEvent,
  type PlexCardSession,
  type PlexCardState,
} from '../utils/plex-card.js';
import {
  PLEX_CARD_MAX_USERS,
  plexCardTag,
  type PlexCardUser,
} from '../utils/plex-card-users.js';

/**
 * One Plex activity card per Plex user (and channel), each edited in place.
 *
 * - The message id of every user card is persisted (`PlexCardStore`), so a restart edits the same messages.
 * - A new message is posted only when a user shows up for the first time, or when that user's old
 *   message is gone (Unknown Message 10008, not our own message 50005) or edits kept failing.
 *   An active user's card is never re-posted to move it up; it is only edited.
 * - Events only change the stored per-user state and arm that card's debounce timer; a burst becomes one edit.
 * - A flush with an unchanged embed hash does nothing (no edit, no post).
 * - State changes are synchronous store writes (atomic in the single JS thread); all Discord
 *   calls run through one promise queue, spaced out (no burst at boot), so parallel events/flushes
 *   can never double-post. Failures, backoff and cooldowns are tracked per card; a permanent
 *   Discord error (10003/50001/50013) pauses the whole channel.
 * - Logs carry a short hash of the user key, never a name or Discord id.
 */

export interface PlexCardRecord {
  channelId: string;
  /** Identity of the card within the channel (normalized display name). */
  userKey: string;
  displayName: string;
  messageId: string | null;
  contentHash: string | null;
  state: PlexCardState;
  postedAt: number | null;
}

export interface PlexCardStore {
  load(channelId: string, userKey: string): PlexCardRecord | null;
  save(record: PlexCardRecord): void;
  /** All cards of a channel in first-post order (oldest first). */
  list(channelId: string): PlexCardRecord[];
}

export interface PlexCardGateway {
  post(channelId: string, embed: EmbedBuilder): Promise<string>;
  edit(channelId: string, messageId: string, embed: EmbedBuilder): Promise<void>;
  /** Optional: delete one message by id (used only for the card's own, tracked, replaced message). */
  delete?(channelId: string, messageId: string): Promise<void>;
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
  /** How long a permanent Discord error (10003/50001/50013) pauses all Discord calls for the channel. */
  permanentPauseMs?: number;
  /** Maps the raw webhook user name to a card identity; null = no card (anonymous / excluded). */
  resolveUser?: (raw: string | undefined) => PlexCardUser | null;
  /** Upper bound of cards per channel. */
  maxUsers?: number;
  /** Minimum gap after any Discord call before a NEW card is posted (no burst when many users appear at once). */
  postSpacingMs?: number;
  /** Minimum gap after any Discord call before a card is edited. */
  editSpacingMs?: number;
  /** Waits `ms` (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
  log?: (level: 'info' | 'warn', msg: string, data?: Record<string, unknown>) => void;
}

export type PlexCardFlushResult =
  | 'unchanged'
  | 'edited'
  | 'posted'
  | 'reposted'
  | 'retry'
  | 'cooldown'
  | 'paused';

export const PLEX_CARD_DEBOUNCE_MS = 4_000;
export const PLEX_CARD_MAX_WAIT_MS = 15_000;
export const PLEX_CARD_RETRY_MS = 30_000;
export const PLEX_CARD_MAX_EDIT_FAILURES = 5;
export const PLEX_CARD_REPOST_COOLDOWN_MS = 10 * 60_000;
export const PLEX_CARD_GONE_COOLDOWN_MS = 60_000;
/** Upper bound of the exponential backoff between two real Discord attempts after a failure. */
export const PLEX_CARD_MAX_BACKOFF_MS = 10 * 60_000;
/** Pause after a permanent Discord error (missing channel / access / permission); then one new attempt. */
export const PLEX_CARD_PERMANENT_PAUSE_MS = 30 * 60_000;
export const PLEX_CARD_POST_SPACING_MS = 3_000;
export const PLEX_CARD_EDIT_SPACING_MS = 400;
const CAP_WARN_INTERVAL_MS = 10 * 60_000;

const DISCORD_UNKNOWN_MESSAGE = 10_008;
const DISCORD_CANNOT_EDIT_OTHERS = 50_005;
const DISCORD_UNKNOWN_CHANNEL = 10_003;
const DISCORD_MISSING_ACCESS = 50_001;
const DISCORD_MISSING_PERMISSIONS = 50_013;

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

/**
 * Retrying cannot help until someone fixes the server: channel deleted (10003), bot lost access
 * (50001) or lost the permission to view/send/edit (50013).
 */
export function isPermanentDiscordError(err: unknown): boolean {
  const code = discordErrorCode(err);
  return code === DISCORD_UNKNOWN_CHANNEL || code === DISCORD_MISSING_ACCESS || code === DISCORD_MISSING_PERMISSIONS;
}

interface Pending {
  timer: unknown;
  firstAt: number;
  channelId: string;
  userKey: string;
}

export interface PlexCardSyncStatus {
  /** Cards stored for the channel. */
  cards: number;
  /** Cards that have a stored message id. */
  posted: number;
  /** Cards that have content but no message yet, or whose message does not show the current state. */
  unsynced: number;
  /** The channel is paused after a permanent Discord error. */
  paused: boolean;
  /** Time of the last successful post of any card in this process (0 = none yet). */
  lastPostAt: number;
}

const cardId = (channelId: string, userKey: string): string => `${channelId}\u0000${userKey}`;

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
  private readonly permanentPauseMs: number;
  private readonly resolveUser: NonNullable<PlexCardManagerOptions['resolveUser']>;
  private readonly maxUsers: number;
  private readonly postSpacingMs: number;
  private readonly editSpacingMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: NonNullable<PlexCardManagerOptions['log']>;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, Pending>();
  /** Consecutive failed real Discord attempts per card (not timer fires, not skipped flushes). */
  private readonly failures = new Map<string, number>();
  /** No Discord call for this card before this time after a transient failure (exponential backoff). */
  private readonly backoffUntil = new Map<string, number>();
  /** No Discord call in this channel before this time after a permanent error. */
  private readonly pausedUntil = new Map<string, number>();
  private lastCallAt = 0;
  private lastPostAt = 0;
  private capWarnedAt = 0;

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
    this.permanentPauseMs = options.permanentPauseMs ?? PLEX_CARD_PERMANENT_PAUSE_MS;
    this.resolveUser = options.resolveUser ?? ((raw) => {
      const name = raw?.trim();
      return name ? { key: name.toLocaleLowerCase('de-DE'), name } : null;
    });
    this.maxUsers = options.maxUsers ?? PLEX_CARD_MAX_USERS;
    this.postSpacingMs = options.postSpacingMs ?? PLEX_CARD_POST_SPACING_MS;
    this.editSpacingMs = options.editSpacingMs ?? PLEX_CARD_EDIT_SPACING_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => {
      const handle = setTimeout(resolve, ms);
      handle.unref?.();
    }));
    this.log = options.log ?? (() => {});
  }

  private enqueue<T>(job: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private loadRecord(channelId: string, userKey: string, displayName = ''): PlexCardRecord {
    return this.store.load(channelId, userKey) ?? {
      channelId,
      userKey,
      displayName,
      messageId: null,
      contentHash: null,
      state: emptyPlexCardState(),
      postedAt: null,
    };
  }

  /**
   * Folds an event into that user's persisted state and schedules one debounced flush of that
   * user's card only. Returns false when nothing changed or the event has no card (anonymous,
   * excluded, over the user cap).
   */
  handleEvent(channelId: string, event: PlexCardEvent): boolean {
    const user = this.resolveUser(event.user);
    if (!user) return false;
    let record = this.store.load(channelId, user.key);
    if (!record) {
      if (this.store.list(channelId).length >= this.maxUsers) {
        this.warnCapped();
        return false;
      }
      record = this.loadRecord(channelId, user.key, user.name);
    }
    const state = applyPlexCardEvent(record.state, event);
    const renamed = record.displayName !== user.name;
    if (state === record.state && !renamed) return false;
    this.store.save({ ...record, displayName: user.name, state });
    this.schedule(channelId, user.key, this.debounceMs, true);
    return state !== record.state;
  }

  private warnCapped(): void {
    const now = this.now();
    if (this.capWarnedAt !== 0 && now - this.capWarnedAt < CAP_WARN_INTERVAL_MS) return;
    this.capWarnedAt = now;
    this.log('warn', 'Plex card user limit reached, new users get no card', { max: this.maxUsers });
  }

  /** Moves sessions out of the running lists; used by the stale/orphan reconcile. Returns how many were closed. */
  closeSessions(channelId: string, shouldClose: (session: PlexCardSession) => boolean): number {
    let closedTotal = 0;
    for (const record of this.store.list(channelId)) {
      const state = closePlexCardSessions(record.state, shouldClose, this.now());
      if (state === record.state) continue;
      this.store.save({ ...record, state });
      this.schedule(channelId, record.userKey, this.debounceMs, true);
      closedTotal += record.state.sessions.length - state.sessions.length;
    }
    return closedTotal;
  }

  getState(channelId: string, userKey: string): PlexCardState {
    return this.loadRecord(channelId, userKey).state;
  }

  private schedule(channelId: string, userKey: string, delayMs: number, capByMaxWait = false): void {
    const id = cardId(channelId, userKey);
    const now = this.now();
    const existing = this.pending.get(id);
    let firstAt = now;
    if (existing) {
      firstAt = existing.firstAt;
      this.timers.clearTimeout(existing.timer);
    }
    // Trailing debounce, but never wait longer than maxWait since the first unflushed event.
    const delay = capByMaxWait ? Math.max(0, Math.min(delayMs, firstAt + this.maxWaitMs - now)) : delayMs;
    const timer = this.timers.setTimeout(() => {
      this.pending.delete(id);
      void this.flushCard(channelId, userKey).catch((err: unknown) => {
        this.log('warn', 'Plex card flush failed', { card: plexCardTag(userKey), err });
      });
    }, delay);
    this.pending.set(id, { timer, firstAt, channelId, userKey });
  }

  /** Renders and syncs every card of the channel, one after another. */
  async flush(channelId: string): Promise<PlexCardFlushResult[]> {
    const results: PlexCardFlushResult[] = [];
    for (const record of this.store.list(channelId)) {
      results.push(await this.flushCard(channelId, record.userKey));
    }
    return results;
  }

  /** Renders and syncs one card now. Safe to call concurrently; calls run one after another. */
  flushCard(channelId: string, userKey: string): Promise<PlexCardFlushResult> {
    return this.enqueue(() => this.flushLocked(channelId, userKey));
  }

  private async pace(spacingMs: number): Promise<void> {
    const wait = this.lastCallAt + spacingMs - this.now();
    if (spacingMs > 0 && this.lastCallAt > 0 && wait > 0) await this.sleep(wait);
    this.lastCallAt = this.now();
  }

  private async flushLocked(channelId: string, userKey: string): Promise<PlexCardFlushResult> {
    const record = this.store.load(channelId, userKey);
    if (!record) return 'unchanged';
    const embed = buildPlexUserCardEmbed(record.displayName, record.state);
    const hash = plexCardHash(embed);
    const id = cardId(channelId, userKey);

    if (record.messageId && record.contentHash === hash) return 'unchanged';
    // Nothing to show and nothing ever posted: do not create an empty card.
    if (!record.messageId && record.state.sessions.length === 0 && record.state.recent.length === 0) {
      return 'unchanged';
    }

    // Gate: the debounce timer, the retry timer and the 30 s tick all call flush. Only a flush that
    // reaches Discord counts as an attempt; the others wait out the pause/backoff without counting.
    const now = this.now();
    const pausedUntil = this.pausedUntil.get(channelId);
    if (pausedUntil !== undefined) {
      if (now < pausedUntil) return 'paused';
      this.pausedUntil.delete(channelId);
    }
    const backoffUntil = this.backoffUntil.get(id);
    if (backoffUntil !== undefined && now < backoffUntil) {
      this.schedule(channelId, userKey, backoffUntil - now);
      return 'retry';
    }

    if (!record.messageId) return this.post(record, embed, hash, 'posted', 0);

    try {
      await this.pace(this.editSpacingMs);
      await this.gateway.edit(channelId, record.messageId, embed);
    } catch (err) {
      if (isMessageGone(err)) {
        this.log('info', 'Plex card message is gone, posting a new one', { card: plexCardTag(userKey), code: discordErrorCode(err) });
        return this.post(record, embed, hash, 'reposted', this.goneCooldownMs);
      }
      if (this.pauseOnPermanent(channelId, userKey, 'edit', err)) return 'paused';
      const count = this.recordFailure(channelId, userKey, 'edit', err);
      if (count >= this.maxEditFailures) {
        // Edits kept failing: post a fresh card, then best-effort remove the old tracked one (no duplicates left behind).
        return this.post(record, embed, hash, 'reposted', this.repostCooldownMs, record.messageId);
      }
      return 'retry';
    }
    this.clearFailures(channelId, userKey);
    this.store.save({ ...this.loadRecord(channelId, userKey), contentHash: hash });
    return 'edited';
  }

  private clearFailures(channelId: string, userKey: string): void {
    const id = cardId(channelId, userKey);
    this.failures.delete(id);
    this.backoffUntil.delete(id);
    this.pausedUntil.delete(channelId);
  }

  /** Counts one real failed attempt, arms the exponential backoff and its retry timer. */
  private recordFailure(channelId: string, userKey: string, op: 'edit' | 'post', err: unknown): number {
    const id = cardId(channelId, userKey);
    const count = (this.failures.get(id) ?? 0) + 1;
    this.failures.set(id, count);
    const delay = Math.min(this.retryMs * 2 ** (count - 1), Math.max(this.retryMs, PLEX_CARD_MAX_BACKOFF_MS));
    this.backoffUntil.set(id, this.now() + delay);
    this.log('warn', `Plex card ${op} failed`, { card: plexCardTag(userKey), attempt: count, retryInMs: delay, err });
    this.schedule(channelId, userKey, delay);
    return count;
  }

  /** Permanent Discord errors stop all calls in the channel for a while (quiet log, no Discord message, no repost). */
  private pauseOnPermanent(channelId: string, userKey: string, op: 'edit' | 'post', err: unknown): boolean {
    if (!isPermanentDiscordError(err)) return false;
    const id = cardId(channelId, userKey);
    const alreadyPaused = (this.pausedUntil.get(channelId) ?? 0) > this.now();
    this.pausedUntil.set(channelId, this.now() + this.permanentPauseMs);
    this.failures.delete(id);
    this.backoffUntil.delete(id);
    if (!alreadyPaused) {
      this.log('warn', `Plex card ${op} blocked by Discord, pausing the cards`, {
        card: plexCardTag(userKey),
        code: discordErrorCode(err),
        pauseMs: this.permanentPauseMs,
      });
    }
    return true;
  }

  private async post(
    record: PlexCardRecord,
    embed: EmbedBuilder,
    hash: string,
    result: 'posted' | 'reposted',
    cooldownMs: number,
    replacedMessageId?: string,
  ): Promise<PlexCardFlushResult> {
    const { channelId, userKey } = record;
    const now = this.now();
    if (cooldownMs > 0 && record.postedAt !== null && now - record.postedAt < cooldownMs) {
      // Keep the old message id: a later flush retries the edit; reposts are rate-limited per card.
      this.schedule(channelId, userKey, Math.max(this.retryMs, cooldownMs - (now - record.postedAt)));
      return 'cooldown';
    }
    try {
      await this.pace(this.postSpacingMs);
      const messageId = await this.gateway.post(channelId, embed);
      this.lastPostAt = this.now();
      this.clearFailures(channelId, userKey);
      this.store.save({ ...this.loadRecord(channelId, userKey), messageId, contentHash: hash, postedAt: now });
      if (replacedMessageId && replacedMessageId !== messageId) await this.deleteReplaced(channelId, userKey, replacedMessageId);
      return result;
    } catch (err) {
      if (this.pauseOnPermanent(channelId, userKey, 'post', err)) return 'paused';
      this.recordFailure(channelId, userKey, 'post', err);
      return 'retry';
    }
  }

  /** Best-effort: only the card's own previously tracked message, one delete call, every error is ignored. */
  private async deleteReplaced(channelId: string, userKey: string, messageId: string): Promise<void> {
    if (!this.gateway.delete) return;
    try {
      await this.gateway.delete(channelId, messageId);
    } catch (err) {
      this.log('info', 'old Plex card message could not be deleted (ignored)', { card: plexCardTag(userKey), code: discordErrorCode(err) });
    }
  }

  /**
   * Periodic housekeeping: drops sessions that had no event for the TTL and flushes cards whose
   * last flush is still outstanding (e.g. after a failed edit, or a card seeded by the migration).
   */
  async tick(channelId: string): Promise<PlexCardFlushResult[]> {
    const now = this.now();
    this.closeSessions(channelId, (s) => now - s.updatedAt >= PLEX_CARD_SESSION_TTL_MS);
    return this.flush(channelId);
  }

  /**
   * Whether every card of the channel shows its current state in a stored message (a full sync).
   * Used by the one-time cleanup, which must never run before the per-user cards are live.
   */
  syncStatus(channelId: string): PlexCardSyncStatus {
    const records = this.store.list(channelId);
    let unsynced = 0;
    let posted = 0;
    for (const record of records) {
      if (record.messageId) posted += 1;
      if (record.state.sessions.length === 0 && record.state.recent.length === 0) continue;
      const hash = plexCardHash(buildPlexUserCardEmbed(record.displayName, record.state));
      if (!record.messageId || record.contentHash !== hash) unsynced += 1;
    }
    return {
      cards: records.length,
      posted,
      unsynced,
      paused: (this.pausedUntil.get(channelId) ?? 0) > this.now(),
      lastPostAt: this.lastPostAt,
    };
  }

  /** Flushes anything still waiting for its debounce timer (graceful shutdown). */
  async flushAllPending(): Promise<void> {
    const entries = [...this.pending.entries()];
    for (const [id, pending] of entries) {
      this.timers.clearTimeout(pending.timer);
      this.pending.delete(id);
      await this.flushCard(pending.channelId, pending.userKey).catch(() => undefined);
    }
  }
}
