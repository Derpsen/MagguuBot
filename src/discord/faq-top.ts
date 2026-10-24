import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { faqTopState } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { getChannel } from './channel-store.js';
import { loadFaqEntries } from './faq-autoanswer.js';
import { faqUsageBetween, faqUsageDay, pruneFaqUsage } from './faq-stats.js';
import { FaqTopManager, type FaqTopDeps, type FaqTopRecord, type FaqTopStore } from './faq-top-manager.js';
import { discordCardGateway } from './plex-card.js';

/** FAQ top channel: explicit override, then the weekly digest channel (no new mandatory channel key). */
export function faqTopChannelId(): string | undefined {
  return config.DISCORD_CHANNEL_FAQ_TOP || getChannel('weeklyDigest');
}

export const faqTopStore: FaqTopStore = {
  load() {
    const row = db.select().from(faqTopState).where(eq(faqTopState.guildId, config.DISCORD_GUILD_ID)).get();
    if (!row) return null;
    return {
      lastScheduledAt: row.lastScheduledAt?.getTime() ?? null,
      lastPostedAt: row.lastPostedAt?.getTime() ?? null,
      lastMessageId: row.lastMessageId,
      pausedUntil: row.pausedUntil?.getTime() ?? null,
    };
  },
  save(record: FaqTopRecord) {
    const values = {
      guildId: config.DISCORD_GUILD_ID,
      lastScheduledAt: record.lastScheduledAt === null ? null : new Date(record.lastScheduledAt),
      lastPostedAt: record.lastPostedAt === null ? null : new Date(record.lastPostedAt),
      lastMessageId: record.lastMessageId,
      pausedUntil: record.pausedUntil === null ? null : new Date(record.pausedUntil),
      updatedAt: new Date(),
    };
    db.insert(faqTopState).values(values).onConflictDoUpdate({ target: faqTopState.guildId, set: values }).run();
  },
};

let manager: FaqTopManager | null = null;

export function faqTopDeps(overrides: Partial<FaqTopDeps> = {}): FaqTopDeps {
  return {
    store: faqTopStore,
    post: (channelId, embed) => discordCardGateway.post(channelId, embed),
    usage: faqUsageBetween,
    entries: loadFaqEntries,
    channelId: faqTopChannelId,
    pageUrl: config.WEBSITE_FAQ_PAGE_URL,
    timeZone: config.TIME_ZONE,
    day: config.FAQ_TOP_DAY,
    hour: config.FAQ_TOP_HOUR,
    log: (level, msg, data) => logger[level](data ?? {}, msg),
    ...overrides,
  };
}

export function getFaqTop(): FaqTopManager {
  manager ??= new FaqTopManager(faqTopDeps());
  return manager;
}

/** Test seam: replaces (or with `null` resets) the process-wide manager that the scheduler tick drives. */
export function setFaqTopForTests(replacement: Pick<FaqTopManager, 'tick'> | null): void {
  manager = replacement as FaqTopManager | null;
}

let lastPruneDay = '';

/** Retention: at most once per local day, independent of FAQ_TOP_ENABLED (the counters are written either way). */
export function pruneFaqUsageDaily(now: Date = new Date()): number {
  const day = faqUsageDay(now);
  if (day === lastPruneDay) return 0;
  lastPruneDay = day;
  const removed = pruneFaqUsage(now);
  if (removed > 0) logger.info({ removed }, 'old FAQ usage counters deleted');
  return removed;
}

export async function runFaqTopTick(): Promise<void> {
  pruneFaqUsageDaily();
  if (!config.FAQ_TOP_ENABLED) return;
  await getFaqTop().tick();
}
