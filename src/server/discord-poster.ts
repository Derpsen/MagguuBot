import type { ActionRowBuilder, ButtonBuilder, EmbedBuilder, Message } from 'discord.js';
import { getClient } from '../discord/client.js';
import { db } from '../db/client.js';
import { webhookEvents } from '../db/schema.js';
import { logger } from '../utils/logger.js';

interface PostArgs {
  channelId: string | undefined;
  embed: EmbedBuilder;
  components?: ActionRowBuilder<ButtonBuilder>[];
  source: string;
  eventType: string;
  payload: unknown;
}

export async function postEmbed(args: PostArgs): Promise<Message | null> {
  const { channelId, embed, components, source, eventType, payload } = args;

  if (!channelId) {
    db.insert(webhookEvents).values({
      source,
      eventType,
      payload: payload as object,
      status: 'skipped',
      error: 'no channel configured',
    }).run();
    logger.warn({ source, eventType }, 'no channel configured, skipping');
    return null;
  }

  try {
    const client = getClient();
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isSendable()) {
      throw new Error(`channel ${channelId} is not sendable`);
    }
    const message = await channel.send({ embeds: [embed], components });
    db.insert(webhookEvents).values({
      source,
      eventType,
      payload: payload as object,
      channelId,
      messageId: message.id,
      status: 'posted',
    }).run();
    return message;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ source, eventType, error }, 'failed to post embed');
    db.insert(webhookEvents).values({
      source,
      eventType,
      payload: payload as object,
      channelId,
      status: 'failed',
      error,
    }).run();
    return null;
  }
}
