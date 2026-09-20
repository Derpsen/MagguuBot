import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { livePanels } from '../db/schema.js';
import { buildQueueEmbed, hashQueueEmbedPayload } from '../embeds/queue.js';
import { getRadarrQueue } from '../services/radarr.js';
import { getSabQueue } from '../services/sabnzbd.js';
import { getSonarrQueue } from '../services/sonarr.js';
import { logger } from '../utils/logger.js';
import { getChannel } from './channel-store.js';
import { getClient } from './client.js';

const VERIFY_MS = 15 * 60 * 1000;

function panelAgeMs(updatedAt: Date | number | null | undefined): number {
  if (updatedAt == null) return Number.POSITIVE_INFINITY;
  const ms = updatedAt instanceof Date ? updatedAt.getTime() : Number(updatedAt);
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
  return Date.now() - ms;
}

export async function runDownloadLiveTick(): Promise<void> {
  const key = and(eq(livePanels.guildId, config.DISCORD_GUILD_ID), eq(livePanels.kind, 'downloads'));
  const existing = db.select().from(livePanels).where(key).get();
  if (existing && !existing.enabled) return;
  const channelId = existing?.channelId ?? getChannel('downloadLive');
  if (!channelId) return;

  const [sonarr, radarr, sab] = await Promise.all([
    getSonarrQueue().catch(() => null),
    getRadarrQueue().catch(() => null),
    getSabQueue().catch(() => null),
  ]);
  const embed = buildQueueEmbed({ sonarr, radarr, sab })
    .setTitle('📡 Live-Downloads')
    .setFooter({ text: 'MagguuBot · aktualisiert jede Minute' });
  const payloadHash = hashQueueEmbedPayload(embed);
  const hashHit = Boolean(
    existing
    && existing.payloadHash === payloadHash
    && existing.messageId
    && existing.messageId !== 'pending'
    && existing.channelId === channelId,
  );
  if (hashHit && panelAgeMs(existing?.updatedAt) < VERIFY_MS) {
    return;
  }

  const channel = await getClient().channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable() || !channel.isTextBased()) return;

  let message = existing?.messageId && existing.messageId !== 'pending'
    ? await channel.messages.fetch(existing.messageId).catch(() => null)
    : null;
  if (message) {
    if (!hashHit) {
      await message.edit({ embeds: [embed] });
    }
  } else {
    message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  }
  db.insert(livePanels)
    .values({
      guildId: config.DISCORD_GUILD_ID,
      kind: 'downloads',
      channelId,
      messageId: message.id,
      payloadHash,
      enabled: true,
    })
    .onConflictDoUpdate({
      target: [livePanels.guildId, livePanels.kind],
      set: { channelId, messageId: message.id, payloadHash, enabled: true, updatedAt: new Date() },
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
  const channelChanged = existing?.channelId !== targetChannel;
  const messageId = channelChanged ? 'pending' : (existing?.messageId ?? 'pending');
  const payloadHash = channelChanged ? null : existing?.payloadHash;
  db.insert(livePanels)
    .values({
      guildId: config.DISCORD_GUILD_ID,
      kind: 'downloads',
      channelId: targetChannel,
      messageId,
      payloadHash,
      enabled,
    })
    .onConflictDoUpdate({
      target: [livePanels.guildId, livePanels.kind],
      set: { channelId: targetChannel, messageId, payloadHash, enabled, updatedAt: new Date() },
    })
    .run();
  logger.info({ enabled, channelId: targetChannel }, 'download live panel setting changed');
}
