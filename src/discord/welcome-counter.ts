import { and, eq, gte, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { memberHistory, welcomeCounterCard } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { zonedTimeToUtc } from '../utils/raid-reminder.js';
import { weeklyPeriodKey } from '../utils/schedule.js';
import {
  buildWelcomeCounterEmbed,
  CoalescedTrigger,
  WELCOME_COUNTER_WINDOW_MS,
  type WelcomeCounterStats,
} from '../utils/welcome-counter.js';
import { getChannel } from './channel-store.js';
import { discordCardGateway } from './plex-card.js';
import { cachedMemberCount } from './server-health.js';
import {
  ServerHealthManager,
  type ServerHealthRecord,
  type ServerHealthResult,
  type ServerHealthStore,
} from './server-health-manager.js';

/**
 * Welcome counter: ONE self-editing message in the public welcome channel (key `welcome`), replacing the old
 * per-join card. Same card rules as the server health card (persisted message id + content hash, PATCH by id, repost
 * only on 10008 / 50005, quiet pause on 10003 / 50001 / 50013, exponential backoff). Joins and leaves only
 * REQUEST a refresh; a leading + trailing throttle (60 s) turns a join wave into at most one edit per window.
 * The only numbers are the member count and the joins of this week, taken from `member_history` as a COUNT.
 */

export function welcomeCounterChannelId(): string | undefined {
  return getChannel('welcome');
}

export const welcomeCounterStore: ServerHealthStore = {
  load(channelId) {
    const row = db.select().from(welcomeCounterCard)
      .where(and(eq(welcomeCounterCard.guildId, config.DISCORD_GUILD_ID), eq(welcomeCounterCard.channelId, channelId)))
      .get();
    if (!row) return null;
    return {
      channelId: row.channelId,
      messageId: row.messageId,
      contentHash: row.contentHash,
      postedAt: row.postedAt?.getTime() ?? null,
    };
  },
  save(record: ServerHealthRecord) {
    const values = {
      guildId: config.DISCORD_GUILD_ID,
      channelId: record.channelId,
      messageId: record.messageId,
      contentHash: record.contentHash,
      postedAt: record.postedAt === null ? null : new Date(record.postedAt),
      updatedAt: new Date(),
    };
    db.insert(welcomeCounterCard)
      .values(values)
      .onConflictDoUpdate({ target: [welcomeCounterCard.guildId, welcomeCounterCard.channelId], set: values })
      .run();
  },
};

/** Number of members whose latest join is in the current local week (a plain COUNT, no ids leave the query). */
export function countNewThisWeek(now: Date = new Date()): number {
  const [y, m, d] = (weeklyPeriodKey(now, config.TIME_ZONE, 1, 0) ?? '1970-01-01').split('-').map(Number);
  const since = new Date(zonedTimeToUtc(y ?? 1970, m ?? 1, d ?? 1, 0, 0, config.TIME_ZONE));
  const row = db.select({ n: sql<number>`count(*)` }).from(memberHistory)
    .where(and(eq(memberHistory.guildId, config.DISCORD_GUILD_ID), gte(memberHistory.lastJoinedAt, since)))
    .get();
  return Number(row?.n ?? 0);
}

export function loadWelcomeCounterStats(now: Date = new Date()): WelcomeCounterStats {
  return {
    members: cachedMemberCount(),
    newThisWeek: countNewThisWeek(now),
    weekStart: weeklyPeriodKey(now, config.TIME_ZONE, 1, 0) ?? '1970-01-01',
  };
}

let manager: ServerHealthManager | null = null;

export function getWelcomeCounter(): ServerHealthManager {
  manager ??= new ServerHealthManager({
    store: welcomeCounterStore,
    gateway: discordCardGateway,
    render: (nowMs) => buildWelcomeCounterEmbed(loadWelcomeCounterStats(new Date(nowMs))),
    label: 'welcome counter card',
    // The trigger below is the real throttle; this only guards the 15 min tick against a trigger run right before it.
    debounceMs: WELCOME_COUNTER_WINDOW_MS / 2,
    log: (level, msg, data) => logger[level](data ?? {}, msg),
  });
  return manager;
}

/** Test seam: replaces (or with `null` resets) the process-wide manager. */
export function setWelcomeCounterForTests(replacement: Pick<ServerHealthManager, 'refresh'> | null): void {
  manager = replacement as ServerHealthManager | null;
  trigger.reset();
}

/** Tick and trigger share this. No channel (or disabled) = silent skip; failures are logged by the manager only. */
export async function runWelcomeCounterTick(): Promise<ServerHealthResult | 'skipped'> {
  if (!config.WELCOME_COUNTER_ENABLED) return 'skipped';
  const channelId = welcomeCounterChannelId();
  if (!channelId) return 'skipped';
  const result = await getWelcomeCounter().refresh(channelId);
  if (result === 'posted' || result === 'reposted') logger.info({ result }, 'welcome counter card posted');
  return result;
}

const trigger = new CoalescedTrigger({
  run: async () => { await runWelcomeCounterTick(); },
  windowMs: WELCOME_COUNTER_WINDOW_MS,
  onError: (err) => logger.warn({ err }, 'welcome counter refresh failed'),
});

/** Called on every join/leave: cheap, never throws, at most one refresh per window however many calls come in. */
export function requestWelcomeCounterRefresh(): void {
  try {
    if (!config.WELCOME_COUNTER_ENABLED) return;
    trigger.request();
  } catch (err) {
    logger.warn({ err }, 'welcome counter request failed');
  }
}

export function cancelWelcomeCounterRefresh(): void {
  trigger.cancel();
}
