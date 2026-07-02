import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { livePanels } from '../db/schema.js';
import { buildQueueEmbed } from '../embeds/queue.js';
import { getRadarrQueue } from '../services/radarr.js';
import { getSabQueue } from '../services/sabnzbd.js';
import { getSonarrQueue } from '../services/sonarr.js';
import { logger } from '../utils/logger.js';
import { getChannel } from './channel-store.js';
import { getClient } from './client.js';

export async function runDownloadLiveTick(): Promise<void> {
  const key = and(eq(livePanels.guildId, config.DISCORD_GUILD_ID), eq(livePanels.kind, 'downloads'));
  const existing = db.select().from(livePanels).where(key).get();
  if (existing && !existing.enabled) return;
  const channelId = existing?.channelId ?? getChannel('downloadLive');
  if (!channelId) return;
  const channel = await getClient().channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable() || !channel.isTextBased()) return;

  const [sonarr, radarr, sab] = await Promise.all([
    getSonarrQueue().catch(() => null),
    getRadarrQueue().catch(() => null),
    getSabQueue().catch(() => null),
  ]);
  const embed = buildQueueEmbed({ sonarr, radarr, sab })
    .setTitle('📡 Live-Downloads')
    .setFooter({ text: 'MagguuBot · aktualisiert jede Minute' });
  let message = existing?.messageId
    ? await channel.messages.fetch(existing.messageId).catch(() => null)
    : null;
  if (message) {
    await message.edit({ embeds: [embed] });
  } else {
    message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  }
  db.insert(livePanels)
    .values({
      guildId: config.DISCORD_GUILD_ID,
      kind: 'downloads',
      channelId,
      messageId: message.id,
      enabled: true,
    })
    .onConflictDoUpdate({
      target: [livePanels.guildId, livePanels.kind],
      set: { channelId, messageId: message.id, enabled: true, updatedAt: new Date() },
    })
    .run();
}

export function setDownloadLiveEnabled(enabled: boolean, channelId?: string): void {
  const existing = db
    .select()
    .from(livePanels)
    .where(and(eq(livePanels.guildId, config.DISCORD_GUILD_ID), eq(livePanels.kind, 'downloads')))
    .get();
  const targetChannel = channelId ?? existing?.channelId ?? getChannel('downloadLive');
  if (!targetChannel) {
    if (!enabled) {
      logger.info('download live panel already disabled and no channel is configured');
      return;
    }
    throw new Error('download live channel is not configured');
  }
  db.insert(livePanels)
    .values({
      guildId: config.DISCORD_GUILD_ID,
      kind: 'downloads',
      channelId: targetChannel,
      messageId: existing?.messageId ?? 'pending',
      enabled,
    })
    .onConflictDoUpdate({
      target: [livePanels.guildId, livePanels.kind],
      set: { channelId: targetChannel, enabled, updatedAt: new Date() },
    })
    .run();
  logger.info({ enabled, channelId: targetChannel }, 'download live panel setting changed');
}
