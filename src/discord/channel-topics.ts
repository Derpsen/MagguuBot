import { ChannelType, type TextChannel } from 'discord.js';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { seerrRequests } from '../db/schema.js';
import { getRadarrHealth, getRadarrQueue } from '../services/radarr.js';
import { getSonarrHealth, getSonarrQueue } from '../services/sonarr.js';
import { logger } from '../utils/logger.js';
import { getChannel, type ChannelKey } from './channel-store.js';
import { getClient } from './client.js';

interface TopicUpdate {
  key: ChannelKey;
  build: () => Promise<string | null>;
}

const TOPICS: TopicUpdate[] = [
  {
    key: 'requests',
    build: async () => {
      const pending = db
        .select({ count: sql<number>`count(*)` })
        .from(seerrRequests)
        .where(eq(seerrRequests.status, 'pending'))
        .get();
      const n = pending?.count ?? 0;
      return `📝 Film / Serie requesten · ${n} pending`;
    },
  },
  {
    key: 'approvals',
    build: async () => {
      const pending = db
        .select({ count: sql<number>`count(*)` })
        .from(seerrRequests)
        .where(eq(seerrRequests.status, 'pending'))
        .get();
      const n = pending?.count ?? 0;
      return `⏳ Admin-only Approvals · ${n} in queue`;
    },
  },
  {
    key: 'health',
    build: async () => {
      const [sonarr, radarr] = await Promise.all([
        getSonarrHealth().catch(() => []),
        getRadarrHealth().catch(() => []),
      ]);
      const errors = sonarr.filter((h) => h.type === 'error').length + radarr.filter((h) => h.type === 'error').length;
      const warnings = sonarr.filter((h) => h.type === 'warning').length + radarr.filter((h) => h.type === 'warning').length;
      if (errors > 0) return `🩺 Service-Health · 🔴 ${errors} error${errors === 1 ? '' : 's'}`;
      if (warnings > 0) return `🩺 Service-Health · 🟡 ${warnings} warning${warnings === 1 ? '' : 's'}`;
      return `🩺 Service-Health · 🟢 clean`;
    },
  },
  {
    key: 'grabs',
    build: async () => {
      const [sonarr, radarr] = await Promise.all([
        getSonarrQueue().catch(() => null),
        getRadarrQueue().catch(() => null),
      ]);
      const n = (sonarr?.totalRecords ?? 0) + (radarr?.totalRecords ?? 0);
      return `📥 Sonarr / Radarr / SAB grabs · ${n} in queue`;
    },
  },
];

export async function updateChannelTopics(): Promise<void> {
  const client = getClient();
  for (const entry of TOPICS) {
    try {
      const channelId = getChannel(entry.key);
      if (!channelId) continue;
      const topic = await entry.build();
      if (topic === null) continue;
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) continue;
      const tc = channel as TextChannel;
      if (tc.topic === topic) continue;
      await tc.setTopic(topic);
    } catch (err) {
      logger.debug({ err, key: entry.key }, 'channel topic update failed');
    }
  }
}
