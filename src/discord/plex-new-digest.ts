import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { plexNewDigest } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { getChannel } from './channel-store.js';
import { discordCardGateway } from './plex-card.js';
import { plexNewService } from './plex-new.js';
import {
  PlexNewDigestManager,
  type PlexNewDigestDeps,
  type PlexNewDigestRecord,
  type PlexNewDigestStore,
} from './plex-new-digest-manager.js';

/** Digest channel: explicit override, then the New-on-Plex channel, then the weekly digest channel. */
export function plexNewDigestChannelId(): string | undefined {
  return config.DISCORD_CHANNEL_NEW_ADDED || getChannel('newOnPlex') || getChannel('weeklyDigest');
}

export const plexNewDigestStore: PlexNewDigestStore = {
  load() {
    const row = db.select().from(plexNewDigest).where(eq(plexNewDigest.guildId, config.DISCORD_GUILD_ID)).get();
    if (!row) return null;
    return {
      lastScheduledAt: row.lastScheduledAt?.getTime() ?? null,
      lastRunAt: row.lastRunAt?.getTime() ?? null,
      lastPostedAt: row.lastPostedAt?.getTime() ?? null,
      lastMessageId: row.lastMessageId,
      pausedUntil: row.pausedUntil?.getTime() ?? null,
    };
  },
  save(record: PlexNewDigestRecord) {
    const values = {
      guildId: config.DISCORD_GUILD_ID,
      lastScheduledAt: record.lastScheduledAt === null ? null : new Date(record.lastScheduledAt),
      lastRunAt: record.lastRunAt === null ? null : new Date(record.lastRunAt),
      lastPostedAt: record.lastPostedAt === null ? null : new Date(record.lastPostedAt),
      lastMessageId: record.lastMessageId,
      pausedUntil: record.pausedUntil === null ? null : new Date(record.pausedUntil),
      updatedAt: new Date(),
    };
    db.insert(plexNewDigest).values(values).onConflictDoUpdate({ target: plexNewDigest.guildId, set: values }).run();
  },
};

let manager: PlexNewDigestManager | null = null;

/** Dependencies of the production manager. Day/hour are read from the config when the manager is created. */
export function plexNewDigestDeps(overrides: Partial<PlexNewDigestDeps> = {}): PlexNewDigestDeps {
  return {
    store: plexNewDigestStore,
    post: (channelId, embed) => discordCardGateway.post(channelId, embed),
    fetchSince: (sinceMs) => plexNewService.getSince(sinceMs),
    posterFor: (item) => plexNewService.posterFor(item),
    channelId: plexNewDigestChannelId,
    timeZone: config.TIME_ZONE,
    day: config.PLEX_NEW_DIGEST_DAY,
    hour: config.PLEX_NEW_DIGEST_HOUR,
    log: (level, msg, data) => logger[level](data ?? {}, msg),
    ...overrides,
  };
}

export function getPlexNewDigest(): PlexNewDigestManager {
  manager ??= new PlexNewDigestManager(plexNewDigestDeps());
  return manager;
}

/** Test seam: replaces (or with `null` resets) the process-wide manager that the scheduler tick drives. */
export function setPlexNewDigestForTests(replacement: Pick<PlexNewDigestManager, 'tick'> | null): void {
  manager = replacement as PlexNewDigestManager | null;
}

export async function runPlexNewDigestTick(): Promise<void> {
  if (!config.PLEX_NEW_DIGEST_ENABLED) return;
  await getPlexNewDigest().tick();
}
