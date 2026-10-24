import type { EmbedBuilder } from 'discord.js';
import {
  aggregatePlexWeekly,
  buildPlexWeeklyEmbed,
  plexWeeklyHash,
  type PlexWeeklyRaw,
  type PlexWeeklyStats,
} from '../utils/plex-weekly.js';
import {
  isMessageGone,
  isPermanentDiscordError,
  discordErrorCode,
  PLEX_CARD_PERMANENT_PAUSE_MS,
  type PlexCardGateway,
} from './plex-card-manager.js';

/**
 * One weekly Plex statistics card per channel, edited in place (same rules as the activity card):
 * persisted message id, content-hash dedupe (no timestamp), PATCH by id, and a new message only
 * when there is none yet or Discord says the old one is gone (10008 / 50005). Every other failure
 * is returned as 'error' and leaves the card untouched — the caller logs it quietly and retries.
 */

export interface PlexWeeklyRecord {
  channelId: string;
  messageId: string | null;
  contentHash: string | null;
  postedAt: number | null;
}

export interface PlexWeeklyStore {
  load(channelId: string): PlexWeeklyRecord | null;
  save(record: PlexWeeklyRecord): void;
}

export type PlexWeeklyResult = 'posted' | 'reposted' | 'edited' | 'unchanged' | 'error' | 'paused';

export interface PlexWeeklyManagerOptions {
  store: PlexWeeklyStore;
  gateway: PlexCardGateway;
  /** Loads the raw Tautulli data; null when Tautulli is unreachable. */
  fetchRaw: () => Promise<PlexWeeklyRaw | null>;
  timeZone: string;
  now?: () => number;
  /** Stats younger than this are reused (protects Tautulli from command spam). */
  cacheTtlMs?: number;
  /** Pause after a permanent Discord error (10003 / 50001 / 50013); default 30 min. */
  permanentPauseMs?: number;
  log?: (level: 'info' | 'warn', msg: string, data?: Record<string, unknown>) => void;
}

export const PLEX_WEEKLY_CACHE_TTL_MS = 10 * 60_000;

export class PlexWeeklyManager {
  private readonly opts: PlexWeeklyManagerOptions;
  private queue: Promise<unknown> = Promise.resolve();
  private cache: { at: number; stats: PlexWeeklyStats } | null = null;
  private readonly pausedUntil = new Map<string, number>();

  constructor(opts: PlexWeeklyManagerOptions) {
    this.opts = opts;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private log(level: 'info' | 'warn', msg: string, data?: Record<string, unknown>): void {
    this.opts.log?.(level, msg, data);
  }

  /** Serialised: parallel calls (tick + slash command) can never double-post. */
  refresh(channelId: string, options: { maxAgeMs?: number; force?: boolean } = {}): Promise<PlexWeeklyResult> {
    const run = this.queue.then(() => this.doRefresh(channelId, options.maxAgeMs, options.force === true));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async loadStats(maxAgeMs: number): Promise<PlexWeeklyStats | null> {
    const t = this.now();
    if (this.cache && maxAgeMs > 0 && t - this.cache.at < maxAgeMs) return this.cache.stats;
    let raw: PlexWeeklyRaw | null;
    try {
      raw = await this.opts.fetchRaw();
    } catch (err) {
      this.log('warn', 'Plex weekly stats fetch failed', { err });
      return null;
    }
    if (!raw) return null;
    const stats = aggregatePlexWeekly(raw);
    this.cache = { at: this.now(), stats };
    return stats;
  }

  /** Permanent errors stop all calls for a while: one warn log, no repost, no Discord message. */
  private pauseOnPermanent(channelId: string, op: 'edit' | 'post', err: unknown): boolean {
    if (!isPermanentDiscordError(err)) return false;
    const pauseMs = this.opts.permanentPauseMs ?? PLEX_CARD_PERMANENT_PAUSE_MS;
    this.pausedUntil.set(channelId, this.now() + pauseMs);
    this.log('warn', `Plex weekly card ${op} blocked by Discord, pausing the card`, {
      channelId,
      code: discordErrorCode(err),
      pauseMs,
    });
    return true;
  }

  private async doRefresh(
    channelId: string,
    maxAgeMs = this.opts.cacheTtlMs ?? PLEX_WEEKLY_CACHE_TTL_MS,
    force = false,
  ): Promise<PlexWeeklyResult> {
    if (force) this.pausedUntil.delete(channelId);
    const pausedUntil = this.pausedUntil.get(channelId);
    if (pausedUntil !== undefined) {
      if (this.now() < pausedUntil) return 'paused';
      this.pausedUntil.delete(channelId);
    }
    const stats = await this.loadStats(maxAgeMs);
    if (!stats) {
      this.log('warn', 'Plex weekly card skipped: no Tautulli data', { channelId });
      return 'error';
    }
    const embed = buildPlexWeeklyEmbed(stats, new Date(this.now()), this.opts.timeZone);
    const hash = plexWeeklyHash(embed);
    const record = this.opts.store.load(channelId);

    if (record?.messageId && record.contentHash === hash) return 'unchanged';

    if (record?.messageId) {
      try {
        await this.opts.gateway.edit(channelId, record.messageId, embed);
        this.opts.store.save({ ...record, contentHash: hash });
        return 'edited';
      } catch (err) {
        if (!isMessageGone(err)) {
          if (this.pauseOnPermanent(channelId, 'edit', err)) return 'paused';
          this.log('warn', 'Plex weekly card edit failed', { channelId, err });
          return 'error';
        }
        this.log('info', 'Plex weekly card message is gone, posting a new one', { channelId, code: discordErrorCode(err) });
        return this.post(channelId, embed, hash, 'reposted');
      }
    }
    return this.post(channelId, embed, hash, 'posted');
  }

  private async post(
    channelId: string,
    embed: EmbedBuilder,
    hash: string,
    result: 'posted' | 'reposted',
  ): Promise<PlexWeeklyResult> {
    try {
      const messageId = await this.opts.gateway.post(channelId, embed);
      this.opts.store.save({ channelId, messageId, contentHash: hash, postedAt: this.now() });
      return result;
    } catch (err) {
      if (this.pauseOnPermanent(channelId, 'post', err)) return 'paused';
      this.log('warn', 'Plex weekly card post failed', { channelId, err });
      return 'error';
    }
  }
}
