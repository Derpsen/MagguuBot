import { EmbedBuilder } from 'discord.js';
import { and, eq, isNotNull, lte, ne } from 'drizzle-orm';
import { db } from '../db/client.js';
import { plexActivityMessages } from '../db/schema.js';
import { Colors } from '../embeds/colors.js';
import { logger } from '../utils/logger.js';
import { PLEX_PAUSE_HOLD_MS, shouldFlushDeferredPause } from '../utils/plex-activity.js';
import { getClient } from './client.js';

export async function runPlexPauseFlushTick(now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - PLEX_PAUSE_HOLD_MS);
  const due = db.select().from(plexActivityMessages)
    .where(and(
      isNotNull(plexActivityMessages.pausedAt),
      lte(plexActivityMessages.pausedAt, cutoff),
      ne(plexActivityMessages.state, 'pause'),
    ))
    .all()
    .filter((row) => shouldFlushDeferredPause(row.pausedAt, now));

  for (const row of due) {
    try {
      const channel = await getClient().channels.fetch(row.channelId);
      if (!channel?.isTextBased() || !('messages' in channel)) {
        clearPausedAt(row.id);
        continue;
      }
      const message = await channel.messages.fetch(row.messageId);
      const source = message.embeds[0];
      const embed = source
        ? EmbedBuilder.from(source)
        : new EmbedBuilder().setDescription(message.content || 'Plex');
      embed
        .setColor(Colors.warn)
        .setTitle('⏸️ Pausiert')
        .setTimestamp(now)
        .setFooter({ text: 'MagguuBot · Plex-Aktivität' });
      await message.edit({ embeds: [embed] });
      db.update(plexActivityMessages)
        .set({ state: 'pause', pausedAt: null, updatedAt: now })
        .where(eq(plexActivityMessages.id, row.id))
        .run();
    } catch (err) {
      if (isAlreadyGone(err)) {
        clearPausedAt(row.id);
        continue;
      }
      logger.warn({ err, messageId: row.messageId }, 'deferred Plex pause flush failed');
    }
  }
}

function clearPausedAt(id: number): void {
  db.update(plexActivityMessages)
    .set({ pausedAt: null, updatedAt: new Date() })
    .where(eq(plexActivityMessages.id, id))
    .run();
}

function isAlreadyGone(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('code' in err)) return false;
  return err.code === 10_003 || err.code === 10_008;
}
