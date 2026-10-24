import type { EmbedBuilder } from 'discord.js';
import { buildServerHealthEmbed, serverHealthHash, type ServerHealthStats } from '../utils/server-health.js';
import {
  discordErrorCode,
  isMessageGone,
  isPermanentDiscordError,
  PLEX_CARD_PERMANENT_PAUSE_MS,
  type PlexCardGateway,
} from './plex-card-manager.js';

/**
 * The server health card: ONE message per channel, edited in place (same rules as the Plex weekly card): persisted
 * message id, content-hash dedupe (no timestamp), PATCH by id, a new message only when there is none yet or Discord
 * says the old one is gone (10008 / 50005). 10003 / 50001 / 50013 pause the card quietly. Other failures back off
 * exponentially. Refreshes are debounced so a burst of callers cannot hammer Discord.
 */

export interface ServerHealthRecord {
  channelId: string;
  messageId: string | null;
  contentHash: string | null;
  postedAt: number | null;
}

export interface ServerHealthStore {
  load(channelId: string): ServerHealthRecord | null;
  save(record: ServerHealthRecord): void;
}

export type ServerHealthResult = 'posted' | 'reposted' | 'edited' | 'unchanged' | 'error' | 'paused' | 'backoff' | 'debounced';

export interface ServerHealthManagerOptions {
  store: ServerHealthStore;
  gateway: PlexCardGateway;
  /** Current numbers (members come from the Discord cache, the rest from the anonymous counters). */
  stats: (nowMs: number) => ServerHealthStats;
  now?: () => number;
  /** Minimum time between two refresh attempts (default 60 s); `force` skips it. */
  debounceMs?: number;
  /** First retry delay after a failure; doubles per consecutive failure up to `maxBackoffMs`. */
  backoffBaseMs?: number;
  maxBackoffMs?: number;
  permanentPauseMs?: number;
  log?: (level: 'info' | 'warn', msg: string, data?: Record<string, unknown>) => void;
}

export const SERVER_HEALTH_DEBOUNCE_MS = 60_000;
export const SERVER_HEALTH_BACKOFF_BASE_MS = 60_000;
export const SERVER_HEALTH_MAX_BACKOFF_MS = 30 * 60_000;

export class ServerHealthManager {
  private readonly opts: ServerHealthManagerOptions;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly pausedUntil = new Map<string, number>();
  private readonly backoffUntil = new Map<string, number>();
  private readonly failures = new Map<string, number>();
  private readonly lastAttempt = new Map<string, number>();

  constructor(opts: ServerHealthManagerOptions) {
    this.opts = opts;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private log(level: 'info' | 'warn', msg: string, data?: Record<string, unknown>): void {
    this.opts.log?.(level, msg, data);
  }

  /** Serialised: parallel callers can never double-post. */
  refresh(channelId: string, options: { force?: boolean } = {}): Promise<ServerHealthResult> {
    const run = this.queue.then(() => this.doRefresh(channelId, options.force === true));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private fail(channelId: string): 'error' {
    const n = (this.failures.get(channelId) ?? 0) + 1;
    this.failures.set(channelId, n);
    const base = this.opts.backoffBaseMs ?? SERVER_HEALTH_BACKOFF_BASE_MS;
    const max = this.opts.maxBackoffMs ?? SERVER_HEALTH_MAX_BACKOFF_MS;
    this.backoffUntil.set(channelId, this.now() + Math.min(max, base * 2 ** (n - 1)));
    return 'error';
  }

  private succeed(channelId: string): void {
    this.failures.delete(channelId);
    this.backoffUntil.delete(channelId);
  }

  private pauseOnPermanent(channelId: string, op: 'edit' | 'post', err: unknown): boolean {
    if (!isPermanentDiscordError(err)) return false;
    const pauseMs = this.opts.permanentPauseMs ?? PLEX_CARD_PERMANENT_PAUSE_MS;
    this.pausedUntil.set(channelId, this.now() + pauseMs);
    this.log('warn', `server health card ${op} blocked by Discord, pausing the card`, {
      channelId,
      code: discordErrorCode(err),
      pauseMs,
    });
    return true;
  }

  private async doRefresh(channelId: string, force: boolean): Promise<ServerHealthResult> {
    const t = this.now();
    if (force) {
      this.pausedUntil.delete(channelId);
      this.backoffUntil.delete(channelId);
    } else {
      const paused = this.pausedUntil.get(channelId);
      if (paused !== undefined) {
        if (t < paused) return 'paused';
        this.pausedUntil.delete(channelId);
      }
      const backoff = this.backoffUntil.get(channelId);
      if (backoff !== undefined && t < backoff) return 'backoff';
      const last = this.lastAttempt.get(channelId);
      if (last !== undefined && t - last < (this.opts.debounceMs ?? SERVER_HEALTH_DEBOUNCE_MS)) return 'debounced';
    }
    this.lastAttempt.set(channelId, t);

    let embed: EmbedBuilder;
    try {
      embed = buildServerHealthEmbed(this.opts.stats(t));
    } catch (err) {
      this.log('warn', 'server health stats failed', { err });
      return this.fail(channelId);
    }
    const hash = serverHealthHash(embed);
    const record = this.opts.store.load(channelId);
    if (record?.messageId && record.contentHash === hash) {
      this.succeed(channelId);
      return 'unchanged';
    }

    if (record?.messageId) {
      try {
        await this.opts.gateway.edit(channelId, record.messageId, embed);
        this.opts.store.save({ ...record, contentHash: hash });
        this.succeed(channelId);
        return 'edited';
      } catch (err) {
        if (!isMessageGone(err)) {
          if (this.pauseOnPermanent(channelId, 'edit', err)) return 'paused';
          this.log('warn', 'server health card edit failed', { channelId, err });
          return this.fail(channelId);
        }
        this.log('info', 'server health card message is gone, posting a new one', { channelId, code: discordErrorCode(err) });
        return this.post(channelId, embed, hash, 'reposted');
      }
    }
    return this.post(channelId, embed, hash, 'posted');
  }

  private async post(channelId: string, embed: EmbedBuilder, hash: string, result: 'posted' | 'reposted'): Promise<ServerHealthResult> {
    try {
      const messageId = await this.opts.gateway.post(channelId, embed);
      this.opts.store.save({ channelId, messageId, contentHash: hash, postedAt: this.now() });
      this.succeed(channelId);
      return result;
    } catch (err) {
      if (this.pauseOnPermanent(channelId, 'post', err)) return 'paused';
      this.log('warn', 'server health card post failed', { channelId, err });
      return this.fail(channelId);
    }
  }
}
