import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { plexWeeklyCard } from '../db/schema.js';
import { getHomeStats, getPlaysByDate } from '../services/tautulli.js';
import { logger } from '../utils/logger.js';
import { weeklyPeriodKey } from '../utils/schedule.js';
import {
  PLEX_WEEKLY_DAYS,
  PLEX_WEEKLY_STATS_COUNT,
  duePlexWeeklyPeriod,
  nextWeeklyRun,
  type PlexWeeklyRaw,
} from '../utils/plex-weekly.js';
import { getChannel } from './channel-store.js';
import { getFeatureState, setFeatureState } from './feature-state.js';
import { discordCardGateway } from './plex-card.js';
import {
  PlexWeeklyManager,
  type PlexWeeklyRecord,
  type PlexWeeklyResult,
  type PlexWeeklyStore,
} from './plex-weekly-manager.js';

const LAST_PERIOD_KEY = 'plexWeekly:lastPeriod';

export const plexWeeklyStore: PlexWeeklyStore = {
  load(channelId) {
    const row = db.select().from(plexWeeklyCard)
      .where(and(eq(plexWeeklyCard.guildId, config.DISCORD_GUILD_ID), eq(plexWeeklyCard.channelId, channelId)))
      .get();
    if (!row) return null;
    return {
      channelId: row.channelId,
      messageId: row.messageId,
      contentHash: row.contentHash,
      postedAt: row.postedAt?.getTime() ?? null,
    };
  },
  save(record: PlexWeeklyRecord) {
    const values = {
      guildId: config.DISCORD_GUILD_ID,
      channelId: record.channelId,
      messageId: record.messageId,
      contentHash: record.contentHash,
      postedAt: record.postedAt === null ? null : new Date(record.postedAt),
      updatedAt: new Date(),
    };
    db.insert(plexWeeklyCard)
      .values(values)
      .onConflictDoUpdate({ target: [plexWeeklyCard.guildId, plexWeeklyCard.channelId], set: values })
      .run();
  },
};

/** Home stats (top lists) plus per-day plays/duration for exact totals; the series are optional. */
async function fetchRaw(): Promise<PlexWeeklyRaw | null> {
  const home = await getHomeStats(PLEX_WEEKLY_DAYS, PLEX_WEEKLY_STATS_COUNT);
  if (!home) return null;
  const [plays, duration] = await Promise.all([
    getPlaysByDate(PLEX_WEEKLY_DAYS, 'plays'),
    getPlaysByDate(PLEX_WEEKLY_DAYS, 'duration'),
  ]);
  return { home, plays, duration };
}

let manager: PlexWeeklyManager | null = null;

export function getPlexWeekly(): PlexWeeklyManager {
  manager ??= new PlexWeeklyManager({
    store: plexWeeklyStore,
    gateway: discordCardGateway,
    fetchRaw,
    timeZone: config.TIME_ZONE,
    log: (level, msg, data) => logger[level](data ?? {}, msg),
  });
  return manager;
}

/** Env override first, else the channel configured for the weekly digest (neu-auf-plex). */
export function plexWeeklyChannelId(): string | undefined {
  return config.DISCORD_CHANNEL_PLEX_WEEKLY || getChannel('weeklyDigest');
}

export function plexWeeklyConfigured(): boolean {
  return !!config.TAUTULLI_URL && !!config.TAUTULLI_API_KEY && !!plexWeeklyChannelId();
}

export function plexWeeklyNextRun(now = new Date()): Date | null {
  return nextWeeklyRun(now, config.TIME_ZONE, config.PLEX_WEEKLY_DAY, config.PLEX_WEEKLY_HOUR);
}

/** Half-hourly tick: refresh the card once per schedule period; failures stay quiet and retry. */
export async function runPlexWeeklyTick(now = new Date()): Promise<void> {
  if (!config.PLEX_WEEKLY_ENABLED || !plexWeeklyConfigured()) return;
  const period = duePlexWeeklyPeriod(
    weeklyPeriodKey(now, config.TIME_ZONE, config.PLEX_WEEKLY_DAY, config.PLEX_WEEKLY_HOUR),
    getFeatureState(LAST_PERIOD_KEY),
  );
  if (!period) return;
  const channelId = plexWeeklyChannelId();
  if (!channelId) return;
  const result = await getPlexWeekly().refresh(channelId, { maxAgeMs: 0 });
  if (result === 'error') return; // already logged; the next tick tries again
  setFeatureState(LAST_PERIOD_KEY, period);
  logger.info({ period, result }, 'Plex weekly card updated');
}

/** For `/wochenstatistik`: refresh now (cached ≤10 min), without touching the weekly period state. */
export async function refreshPlexWeekly(): Promise<PlexWeeklyResult | 'not-configured'> {
  if (!plexWeeklyConfigured()) return 'not-configured';
  const channelId = plexWeeklyChannelId();
  if (!channelId) return 'not-configured';
  return getPlexWeekly().refresh(channelId);
}
