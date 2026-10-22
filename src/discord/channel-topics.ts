import { ChannelType, type TextChannel } from 'discord.js';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { seerrRequests } from '../db/schema.js';
import { getRadarrHealth, getRadarrQueue } from '../services/radarr.js';
import { getSonarrHealth, getSonarrQueue } from '../services/sonarr.js';
import { composeTopic, counterText, shouldEditTopic, type TopicCounter } from '../utils/channel-topic.js';
import { logger } from '../utils/logger.js';
import { getChannel, type ChannelKey } from './channel-store.js';
import { getClient } from './client.js';
import { channelPlanForRef } from './server-layout.js';

/** Channel keys whose layout channel carries a live counter (`liveCounter` in STRUCTURE). */
const LIVE_TOPICS: Array<{ key: ChannelKey; read: () => Promise<TopicCounter | null> }> = [
  { key: 'requests', read: async () => ({ kind: 'requests', pending: pendingSeerr() }) },
  { key: 'approvals', read: async () => ({ kind: 'approvals', pending: pendingSeerr() }) },
  {
    key: 'health',
    read: async () => {
      const [sonarr, radarr] = await Promise.all([getSonarrHealth().catch(() => null), getRadarrHealth().catch(() => null)]);
      if (!sonarr && !radarr) return null; // both unreachable: keep the current topic
      const all = [...(sonarr ?? []), ...(radarr ?? [])];
      return { kind: 'health', errors: all.filter((h) => h.type === 'error').length, warnings: all.filter((h) => h.type === 'warning').length };
    },
  },
  {
    key: 'grabs',
    read: async () => {
      const [sonarr, radarr] = await Promise.all([getSonarrQueue().catch(() => null), getRadarrQueue().catch(() => null)]);
      if (!sonarr && !radarr) return null;
      return { kind: 'downloads', queued: (sonarr?.totalRecords ?? 0) + (radarr?.totalRecords ?? 0) };
    },
  },
];

function pendingSeerr(): number {
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(seerrRequests)
      .where(eq(seerrRequests.status, 'pending'))
      .get()?.count ?? 0
  );
}

/** Last topic PATCH per channel id (in-process; a restart allows one immediate edit). */
const lastEdit = new Map<string, number>();

export async function updateChannelTopics(): Promise<void> {
  const client = getClient();
  for (const entry of LIVE_TOPICS) {
    try {
      const purpose = channelPlanForRef(entry.key)?.topic;
      const channelId = getChannel(entry.key);
      if (!purpose || !channelId) continue;
      const counter = await entry.read();
      if (!counter) continue;
      const next = composeTopic(purpose, counterText(counter));
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) continue;
      const tc = channel as TextChannel;
      const now = Date.now();
      if (!shouldEditTopic(tc.topic, next, lastEdit.get(channelId), now)) continue;
      lastEdit.set(channelId, now); // also on failure: back off instead of hammering the limit
      await tc.edit({ topic: next });
    } catch (err) {
      logger.debug({ err, key: entry.key }, 'channel topic update failed');
    }
  }
}
