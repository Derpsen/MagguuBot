import type { ActionRowBuilder, ButtonBuilder, EmbedBuilder, Message } from 'discord.js';
import { config } from '../config.js';
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
  pingRoles?: string[];
}

export async function postEmbed(args: PostArgs): Promise<Message | null> {
  const { channelId, embed, components, source, eventType, payload, pingRoles } = args;

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

    const content = buildPingContent(pingRoles, config.DISCORD_GUILD_ID);
    const message = await channel.send({ content, embeds: [embed], components, allowedMentions: { parse: ['roles'] } });
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

function buildPingContent(roleNames: string[] | undefined, guildId: string): string | undefined {
  if (!roleNames?.length) return undefined;
  try {
    const guild = getClient().guilds.cache.get(guildId);
    if (!guild) return undefined;
    const mentions = roleNames
      .map((name) => guild.roles.cache.find((r) => r.name === name))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => `<@&${r.id}>`);
    return mentions.length > 0 ? mentions.join(' ') : undefined;
  } catch {
    return undefined;
  }
}
