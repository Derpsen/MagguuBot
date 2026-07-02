import { asc, eq, lt } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { plexActivityMessages } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { getClient } from './client.js';

const CLEANUP_BATCH_SIZE = 100;

export async function runPlexActivityCleanupTick(now = new Date()): Promise<void> {
  if (config.PLEX_ACTIVITY_RETENTION_DAYS === 0) return;
  const cutoff = new Date(now.getTime() - config.PLEX_ACTIVITY_RETENTION_DAYS * 24 * 60 * 60_000);
  const expired = db.select().from(plexActivityMessages)
    .where(lt(plexActivityMessages.updatedAt, cutoff))
    .orderBy(asc(plexActivityMessages.updatedAt))
    .limit(CLEANUP_BATCH_SIZE)
    .all();
  let deleted = 0;

  for (const row of expired) {
    try {
      const channel = await getClient().channels.fetch(row.channelId);
      if (channel?.isTextBased() && 'messages' in channel) {
        const message = await channel.messages.fetch(row.messageId);
        await message.delete();
      }
      removeTrackingRow(row.id);
      deleted++;
    } catch (err) {
      if (isAlreadyGone(err)) {
        removeTrackingRow(row.id);
        deleted++;
      } else {
        logger.warn({ err, messageId: row.messageId, channelId: row.channelId }, 'Plex activity cleanup failed');
      }
    }
  }

  if (deleted > 0) {
    logger.info({ deleted, retentionDays: config.PLEX_ACTIVITY_RETENTION_DAYS }, 'old Plex activity cards deleted');
  }
}

function removeTrackingRow(id: number): void {
  db.delete(plexActivityMessages).where(eq(plexActivityMessages.id, id)).run();
}

function isAlreadyGone(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('code' in err)) return false;
  return err.code === 10_003 || err.code === 10_008;
}
