import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { serverHealthCard } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { getClient } from './client.js';
import { getChannel } from './channel-store.js';
import { discordCardGateway } from './plex-card.js';
import { loadServerHealthStats } from './server-health-stats.js';
import {
  ServerHealthManager,
  type ServerHealthRecord,
  type ServerHealthResult,
  type ServerHealthStore,
} from './server-health-manager.js';

/** Explicit override, then the health channel (where Sonarr/Radarr health cards land). No new mandatory channel key. */
export function serverHealthChannelId(): string | undefined {
  return config.DISCORD_CHANNEL_SERVER_HEALTH || getChannel('health');
}

export const serverHealthStore: ServerHealthStore = {
  load(channelId) {
    const row = db.select().from(serverHealthCard)
      .where(and(eq(serverHealthCard.guildId, config.DISCORD_GUILD_ID), eq(serverHealthCard.channelId, channelId)))
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
    db.insert(serverHealthCard)
      .values(values)
      .onConflictDoUpdate({ target: [serverHealthCard.guildId, serverHealthCard.channelId], set: values })
      .run();
  },
};

/** Member count from the gateway cache (no REST call); null when the guild is not cached yet. */
export function cachedMemberCount(): number | null {
  try {
    const n = getClient().guilds.cache.get(config.DISCORD_GUILD_ID)?.memberCount;
    return typeof n === 'number' && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

let manager: ServerHealthManager | null = null;

export function getServerHealth(): ServerHealthManager {
  manager ??= new ServerHealthManager({
    store: serverHealthStore,
    gateway: discordCardGateway,
    stats: (nowMs) => loadServerHealthStats(cachedMemberCount(), new Date(nowMs)),
    log: (level, msg, data) => logger[level](data ?? {}, msg),
  });
  return manager;
}

/** Test seam: replaces (or with `null` resets) the process-wide manager that the scheduler tick drives. */
export function setServerHealthForTests(replacement: Pick<ServerHealthManager, 'refresh'> | null): void {
  manager = replacement as ServerHealthManager | null;
}

/** 15 minute tick. No channel (or disabled) = silent skip; failures are logged by the manager and never alarm. */
export async function runServerHealthTick(): Promise<ServerHealthResult | 'skipped'> {
  if (!config.SERVER_HEALTH_CARD_ENABLED) return 'skipped';
  const channelId = serverHealthChannelId();
  if (!channelId) return 'skipped';
  const result = await getServerHealth().refresh(channelId);
  if (result === 'posted' || result === 'reposted') logger.info({ result }, 'server health card posted');
  return result;
}
