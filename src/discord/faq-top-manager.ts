import type { EmbedBuilder } from 'discord.js';
import {
  DIGEST_GRACE_MS,
  DIGEST_PAUSE_MS,
  catchUpDeadline,
  decideDigest,
  lastScheduledRun,
} from '../utils/plex-new-digest.js';
import type { FaqEntry } from '../utils/faq-matcher.js';
import { buildFaqTopEmbed, faqTopWindow, summarizeFaqUsage, type FaqUsageRow } from '../utils/faq-top.js';
import { discordErrorCode, isPermanentDiscordError } from './plex-card-manager.js';

export interface FaqTopRecord {
  lastScheduledAt: number | null;
  lastPostedAt: number | null;
  lastMessageId: string | null;
  pausedUntil: number | null;
}

export interface FaqTopStore {
  load(): FaqTopRecord | null;
  save(record: FaqTopRecord): void;
}

export interface FaqTopDeps {
  store: FaqTopStore;
  /** Posts exactly one embed (strict allowed_mentions is the gateway's job) and returns the message id. */
  post: (channelId: string, embed: EmbedBuilder) => Promise<string>;
  /** Anonymous counters of an inclusive local day range. */
  usage: (fromDay: string, toDay: string) => FaqUsageRow[];
  /** Current website FAQ entries (titles are never stored with the counters). */
  entries: () => Promise<readonly FaqEntry[]>;
  channelId: () => string | undefined;
  pageUrl: string;
  timeZone: string;
  day: number;
  hour: number;
  now?: () => number;
  pauseMs?: number;
  log?: (level: 'debug' | 'info' | 'warn', msg: string, data?: Record<string, unknown>) => void;
}

export type FaqTopResult =
  | 'posted'
  | 'empty'
  | 'not-due'
  | 'done'
  | 'stale'
  | 'paused'
  | 'no-channel'
  | 'unavailable'
  | 'error';

const EMPTY: FaqTopRecord = { lastScheduledAt: null, lastPostedAt: null, lastMessageId: null, pausedUntil: null };

/**
 * Weekly "FAQ der Woche" embed (one message per week, never edited). Scheduling follows the new-added digest: one
 * run per schedule slot (persisted by slot start, DST-safe), delivered at the slot or in the 15 minute grace window;
 * once a slot was handled before, an outage still delivers it until Sunday 23:59 local time, exactly once. Too little
 * data = nothing posted (the slot is remembered). Permanent Discord errors (10003/50001/50013) pause the feature for
 * 30 minutes with one warn log, never an alarm; other failures retry on the next tick, warned once per slot.
 */
export class FaqTopManager {
  private readonly now: () => number;
  private readonly pauseMs: number;
  private running = false;
  /** Fallback when the DB write after a successful post failed: this process still never posts the slot twice. */
  private memory: FaqTopRecord | null = null;
  private readonly warned = new Set<string>();

  constructor(private readonly deps: FaqTopDeps) {
    this.now = deps.now ?? Date.now;
    this.pauseMs = deps.pauseMs ?? DIGEST_PAUSE_MS;
  }

  private log(level: 'debug' | 'info' | 'warn', msg: string, data?: Record<string, unknown>): void {
    this.deps.log?.(level, msg, data);
  }

  private warnOnce(slot: number, kind: string, msg: string, data?: Record<string, unknown>): void {
    const key = `${slot}|${kind}`;
    if (this.warned.has(key)) {
      this.log('debug', msg, data);
      return;
    }
    if (this.warned.size >= 50) this.warned.clear();
    this.warned.add(key);
    this.log('warn', msg, data);
  }

  async tick(): Promise<FaqTopResult> {
    if (this.running) return 'not-due';
    this.running = true;
    try {
      return await this.run();
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<FaqTopResult> {
    const now = this.now();
    const stored = this.deps.store.load() ?? EMPTY;
    const record =
      this.memory && (stored.lastScheduledAt ?? 0) < (this.memory.lastScheduledAt ?? 0) ? this.memory : stored;
    const scheduledAt = lastScheduledRun(now, this.deps.timeZone, this.deps.day, this.deps.hour);
    const ranBefore = record.lastScheduledAt !== null;
    const catchUpUntil = scheduledAt !== null && ranBefore ? catchUpDeadline(scheduledAt, this.deps.timeZone) : undefined;
    const decision = decideDigest(now, scheduledAt, record.lastScheduledAt, catchUpUntil);
    if (decision === 'none') return 'not-due';
    if (decision === 'done') return 'done';
    if (decision === 'stale') return 'stale';
    if (scheduledAt === null) return 'not-due';
    if (record.pausedUntil !== null && now < record.pausedUntil) return 'paused';
    const channelId = this.deps.channelId();
    if (!channelId) {
      this.log('debug', 'FAQ top skipped: no channel configured');
      return 'no-channel';
    }

    const { fromDay, toDay } = faqTopWindow(scheduledAt, this.deps.timeZone);
    const rows = this.deps.usage(fromDay, toDay);
    if (rows.length === 0) {
      this.deps.store.save({ ...record, lastScheduledAt: scheduledAt, pausedUntil: null });
      this.log('debug', 'FAQ top: no usage in the week, nothing posted');
      return 'empty';
    }

    let entries: readonly FaqEntry[];
    try {
      entries = await this.deps.entries();
    } catch (err) {
      this.warnOnce(scheduledAt, 'entries', 'FAQ top: FAQ entries unavailable, retrying next tick', { err });
      return 'unavailable';
    }
    if (entries.length === 0) {
      this.warnOnce(scheduledAt, 'entries', 'FAQ top: FAQ entries unavailable, retrying next tick');
      return 'unavailable';
    }

    const summary = summarizeFaqUsage(rows, new Set(entries.map((e) => e.id)));
    const embed = buildFaqTopEmbed({ summary, entries, fromDay, toDay, pageUrl: this.deps.pageUrl });
    if (!embed) {
      this.deps.store.save({ ...record, lastScheduledAt: scheduledAt, pausedUntil: null });
      this.log('debug', 'FAQ top: too little usage in the week, nothing posted', { uses: summary.total });
      return 'empty';
    }

    let messageId: string;
    try {
      messageId = await this.deps.post(channelId, embed);
    } catch (err) {
      if (isPermanentDiscordError(err)) {
        this.deps.store.save({ ...record, pausedUntil: now + this.pauseMs });
        this.warnOnce(scheduledAt, 'paused', 'FAQ top paused after a permanent Discord error', {
          code: discordErrorCode(err),
          pauseMinutes: Math.round(this.pauseMs / 60_000),
        });
        return 'paused';
      }
      this.warnOnce(scheduledAt, 'post-failed', 'FAQ top post failed, retrying next tick', { err });
      return 'error';
    }

    if (now - scheduledAt > DIGEST_GRACE_MS) {
      this.log('info', 'FAQ top delivered late (catch-up within the week)', {
        lateMinutes: Math.round((now - scheduledAt) / 60_000),
      });
    }
    const posted: FaqTopRecord = { lastScheduledAt: scheduledAt, lastPostedAt: now, lastMessageId: messageId, pausedUntil: null };
    try {
      this.deps.store.save(posted);
    } catch (err) {
      this.memory = posted;
      this.log('warn', 'FAQ top posted but state could not be saved', { err });
    }
    return 'posted';
  }
}
