import { and, eq, gte, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { seerrRequests, starboardPosts, suggestions, webhookEvents } from '../db/schema.js';
import { buildWeeklyDigestEmbed } from '../embeds/weekly-digest.js';
import { logger } from '../utils/logger.js';
import { weeklyPeriodKey } from '../utils/schedule.js';
import { getChannel } from './channel-store.js';
import { getClient } from './client.js';
import { getFeatureState, setFeatureState } from './feature-state.js';
import { getLeaderboard } from './xp.js';

const STATE_KEY = 'weeklyDigest:lastPeriod';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export async function runWeeklyDigestTick(now = new Date()): Promise<void> {
  if (!config.WEEKLY_DIGEST_ENABLED) return;
  const periodKey = weeklyPeriodKey(
    now,
    config.TIME_ZONE,
    config.WEEKLY_DIGEST_DAY,
    config.WEEKLY_DIGEST_HOUR,
  );
  if (!periodKey || getFeatureState(STATE_KEY) === periodKey) return;

  const channelId = getChannel('weeklyDigest');
  if (!channelId) return;
  const channel = await getClient().channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) throw new Error(`weekly digest channel ${channelId} is unavailable`);

  const since = new Date(now.getTime() - WEEK_MS);
  const events = db.select().from(webhookEvents).where(gte(webhookEvents.createdAt, since)).all();
  const statusCount = (status: 'available' | 'declined' | 'failed'): number =>
    db
      .select({ count: sql<number>`count(*)` })
      .from(seerrRequests)
      .where(and(eq(seerrRequests.status, status), gte(seerrRequests.updatedAt, since)))
      .get()?.count ?? 0;
  const suggestionCount = db
    .select({ count: sql<number>`count(*)` })
    .from(suggestions)
    .where(gte(suggestions.createdAt, since))
    .get()?.count ?? 0;
  const starboardCount = db
    .select({ count: sql<number>`count(*)` })
    .from(starboardPosts)
    .where(gte(starboardPosts.createdAt, since))
    .get()?.count ?? 0;

  const bySource = new Map<string, number>();
  for (const event of events) bySource.set(event.source, (bySource.get(event.source) ?? 0) + 1);
  const top = getLeaderboard(config.DISCORD_GUILD_ID, 1)[0];
  const topMember = top
    ? await getClient().users.fetch(top.userId).catch(() => null)
    : null;
  const periodStart = new Date(since).toLocaleDateString('de-DE', { timeZone: config.TIME_ZONE });
  const periodEnd = now.toLocaleDateString('de-DE', { timeZone: config.TIME_ZONE });

  await channel.send({
    embeds: [buildWeeklyDigestEmbed({
      periodLabel: `${periodStart} – ${periodEnd}`,
      newOnPlex: events.filter((event) => event.source === 'tautulli' && event.eventType === 'recently_added').length,
      imports: events.filter((event) =>
        (event.source === 'sonarr' || event.source === 'radarr') && event.eventType === 'Download',
      ).length,
      requestsCreated: events.filter((event) => event.source === 'seerr' && event.eventType === 'MEDIA_PENDING').length,
      requestsAvailable: statusCount('available'),
      requestsDeclined: statusCount('declined'),
      requestsFailed: statusCount('failed'),
      suggestions: suggestionCount,
      starboardPosts: starboardCount,
      topUser: top ? { name: topMember?.displayName ?? top.userId, xp: top.xp, level: top.level } : undefined,
      sourceCounts: Array.from(bySource, ([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count),
    })],
    allowedMentions: { parse: [] },
  });
  setFeatureState(STATE_KEY, periodKey);
  logger.info({ period: periodKey, channelId }, 'weekly digest posted');
}
