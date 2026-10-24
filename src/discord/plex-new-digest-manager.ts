import type { EmbedBuilder } from 'discord.js';
import {
  DIGEST_FIRST_WINDOW_MS,
  DIGEST_PAUSE_MS,
  DIGEST_GRACE_MS,
  buildDigestEmbed,
  catchUpDeadline,
  decideDigest,
  lastScheduledRun,
} from '../utils/plex-new-digest.js';
import type { NeuItem } from '../utils/plex-new.js';
import { discordErrorCode, isPermanentDiscordError } from './plex-card-manager.js';
import type { PlexNewSinceResult } from './plex-new.js';

export interface PlexNewDigestRecord {
  lastScheduledAt: number | null;
  lastRunAt: number | null;
  lastPostedAt: number | null;
  lastMessageId: string | null;
  pausedUntil: number | null;
}

export interface PlexNewDigestStore {
  load(): PlexNewDigestRecord | null;
  save(record: PlexNewDigestRecord): void;
}

export interface PlexNewDigestDeps {
  store: PlexNewDigestStore;
  /** Posts exactly one embed (strict allowed_mentions is the gateway's job) and returns the message id. */
  post: (channelId: string, embed: EmbedBuilder) => Promise<string>;
  fetchSince: (sinceMs: number) => Promise<PlexNewSinceResult>;
  posterFor: (item: NeuItem) => Promise<string | null>;
  channelId: () => string | undefined;
  timeZone: string;
  day: number;
  hour: number;
  now?: () => number;
  pauseMs?: number;
  log?: (level: 'debug' | 'info' | 'warn', msg: string, data?: Record<string, unknown>) => void;
}

export type PlexNewDigestResult =
  | 'posted'
  | 'empty'
  | 'not-due'
  | 'done'
  | 'stale'
  | 'paused'
  | 'no-channel'
  | 'unavailable'
  | 'error';

const EMPTY: PlexNewDigestRecord = {
  lastScheduledAt: null,
  lastRunAt: null,
  lastPostedAt: null,
  lastMessageId: null,
  pausedUntil: null,
};

/**
 * Weekly "Neu hinzugefügt" digest. One run per schedule slot (persisted by slot start, DST-safe), delivered at the
 * slot or within the 15 minute grace window after it. Once a digest has run before (stored `lastRunAt` /
 * `lastScheduledAt`), an outage no longer loses the week: the slot is still delivered until Sunday 23:59 local time
 * (`catchUpDeadline`), exactly once. The very first digest keeps the strict 15 minute window (no surprise post on
 * deploy or after changing day/hour). Later it is skipped quietly; the next digest then covers the longer window.
 * Nothing new = nothing posted. A Tautulli/Discord hiccup is not recorded, so every tick retries; warn logs are
 * written once per slot and kind (then debug), permanent Discord errors pause the digest for 30 minutes
 * (warn log only, never an alarm).
 */
export class PlexNewDigestManager {
  private readonly now: () => number;
  private readonly pauseMs: number;
  private running = false;
  /** Fallback when the DB write after a successful post failed: this process still never posts the slot twice. */
  private memory: PlexNewDigestRecord | null = null;
  /** Slots/kinds already warned about: a multi-day catch-up must not log a warning every 5 minutes. */
  private readonly warned = new Set<string>();

  constructor(private readonly deps: PlexNewDigestDeps) {
    this.now = deps.now ?? Date.now;
    this.pauseMs = deps.pauseMs ?? DIGEST_PAUSE_MS;
  }

  private log(level: 'debug' | 'info' | 'warn', msg: string, data?: Record<string, unknown>): void {
    this.deps.log?.(level, msg, data);
  }

  private warnOnce(slot: number | null, kind: string, msg: string, data?: Record<string, unknown>): void {
    const key = `${slot ?? 'none'}|${kind}`;
    if (this.warned.has(key)) {
      this.log('debug', msg, data);
      return;
    }
    if (this.warned.size >= 50) this.warned.clear();
    this.warned.add(key);
    this.log('warn', msg, data);
  }

  async tick(): Promise<PlexNewDigestResult> {
    if (this.running) return 'not-due';
    this.running = true;
    try {
      return await this.run();
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<PlexNewDigestResult> {
    const now = this.now();
    const stored = this.deps.store.load() ?? EMPTY;
    const record =
      this.memory && (stored.lastScheduledAt ?? 0) < (this.memory.lastScheduledAt ?? 0) ? this.memory : stored;
    const scheduledAt = lastScheduledRun(now, this.deps.timeZone, this.deps.day, this.deps.hour);
    const ranBefore = record.lastRunAt !== null || record.lastScheduledAt !== null;
    const catchUpUntil = scheduledAt !== null && ranBefore ? catchUpDeadline(scheduledAt, this.deps.timeZone) : undefined;
    const decision = decideDigest(now, scheduledAt, record.lastScheduledAt, catchUpUntil);
    if (decision === 'none') return 'not-due';
    if (decision === 'done') return 'done';
    if (decision === 'stale') return 'stale';
    if (scheduledAt === null) return 'not-due';
    if (record.pausedUntil !== null && now < record.pausedUntil) return 'paused';
    const channelId = this.deps.channelId();
    if (!channelId) {
      this.log('debug', 'New-added digest skipped: no channel configured');
      return 'no-channel';
    }

    const since = record.lastRunAt ?? now - DIGEST_FIRST_WINDOW_MS;
    const result = await this.deps.fetchSince(since);
    if (!result.ok) {
      if (result.reason === 'not-configured') return 'unavailable';
      this.warnOnce(scheduledAt, 'unavailable', 'New-added digest: Tautulli data unavailable, retrying next tick', {
        reason: result.reason,
      });
      return 'unavailable';
    }

    if (result.items.length === 0) {
      // Nothing new: stay silent, but remember the slot and the data time so the next window starts here.
      this.deps.store.save({ ...record, lastScheduledAt: scheduledAt, lastRunAt: result.fetchedAt, pausedUntil: null });
      this.log('debug', 'New-added digest: nothing new, nothing posted');
      return 'empty';
    }

    let posterUrl: string | null = null;
    const first = result.items[0];
    if (first) posterUrl = await this.deps.posterFor(first).catch(() => null);
    const embed = buildDigestEmbed({ items: result.items, sinceMs: since, truncated: result.truncated, posterUrl });

    let messageId: string;
    try {
      messageId = await this.deps.post(channelId, embed);
    } catch (err) {
      if (isPermanentDiscordError(err)) {
        this.deps.store.save({ ...record, pausedUntil: now + this.pauseMs });
        this.warnOnce(scheduledAt, 'paused', 'New-added digest paused after a permanent Discord error', {
          channelId,
          code: discordErrorCode(err),
          pauseMinutes: Math.round(this.pauseMs / 60_000),
          err,
        });
        return 'paused';
      }
      this.warnOnce(scheduledAt, 'post-failed', 'New-added digest post failed, retrying next tick', { channelId, err });
      return 'error';
    }

    if (now - scheduledAt > DIGEST_GRACE_MS) {
      this.log('info', 'New-added digest delivered late (catch-up within the week)', {
        lateMinutes: Math.round((now - scheduledAt) / 60_000),
      });
    }
    const posted: PlexNewDigestRecord = {
      lastScheduledAt: scheduledAt,
      lastRunAt: result.fetchedAt,
      lastPostedAt: now,
      lastMessageId: messageId,
      pausedUntil: null,
    };
    try {
      this.deps.store.save(posted);
    } catch (err) {
      this.memory = posted;
      this.log('warn', 'New-added digest posted but state could not be saved', { err });
    }
    return 'posted';
  }
}
