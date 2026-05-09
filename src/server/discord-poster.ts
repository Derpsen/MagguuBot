import { ChannelType, type ActionRowBuilder, type ButtonBuilder, type EmbedBuilder, type Message } from 'discord.js';
import { config } from '../config.js';
import { getClient } from '../discord/client.js';
import { db } from '../db/client.js';
import { webhookEvents } from '../db/schema.js';
import { enforceEmbedTotalSize } from '../embeds/colors.js';
import { logger } from '../utils/logger.js';
import { sanitizePayload } from './webhook-payload-redactor.js';

interface PostArgs {
  channelId: string | undefined;
  embed: EmbedBuilder;
  components?: ActionRowBuilder<ButtonBuilder>[];
  source: string;
  eventType: string;
  payload: unknown;
  pingRoles?: string[];
  thread?: { name: string; archiveMinutes?: 60 | 1440 | 4320 | 10080 };
}

export async function postEmbed(args: PostArgs): Promise<Message | null> {
  const { channelId, embed, components, source, eventType, payload, pingRoles, thread } = args;
  const safePayload = sanitizePayload(payload) as object;

  if (!channelId) {
    db.insert(webhookEvents).values({
      source,
      eventType,
      payload: safePayload,
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

    enforceEmbedTotalSize(embed);

    const ping = buildPing(pingRoles, config.DISCORD_GUILD_ID);
    // allowedMentions.roles MUST be the explicit ID list — `parse: ['roles']`
    // would let any role-mention inside the embed reflect through (e.g. an
    // upstream service quoting a role-id back to us).
    const message = await channel.send({
      content: ping.content,
      embeds: [embed],
      components,
      allowedMentions: { parse: [], roles: ping.roleIds },
    });
    db.insert(webhookEvents).values({
      source,
      eventType,
      payload: safePayload,
      channelId,
      messageId: message.id,
      status: 'posted',
    }).run();

    if (thread && channel.type === ChannelType.GuildText) {
      try {
        await message.startThread({
          name: thread.name.slice(0, 100),
          autoArchiveDuration: thread.archiveMinutes ?? 1440,
          reason: `auto-thread for ${source}/${eventType}`,
        });
      } catch (err) {
        logger.debug({ err, source, eventType }, 'auto-thread create failed (non-fatal)');
      }
    }

    return message;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ source, eventType, error }, 'failed to post embed');
    db.insert(webhookEvents).values({
      source,
      eventType,
      payload: safePayload,
      channelId,
      status: 'failed',
      error,
    }).run();
    return null;
  }
}

interface ResolvedPing {
  content: string | undefined;
  roleIds: string[];
}

function buildPing(roleNames: string[] | undefined, guildId: string): ResolvedPing {
  if (!roleNames?.length) return { content: undefined, roleIds: [] };
  try {
    const guild = getClient().guilds.cache.get(guildId);
    if (!guild) return { content: undefined, roleIds: [] };
    const roles = roleNames
      .map((name) => guild.roles.cache.find((r) => r.name === name))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    if (roles.length === 0) return { content: undefined, roleIds: [] };
    return {
      content: roles.map((r) => `<@&${r.id}>`).join(' '),
      roleIds: roles.map((r) => r.id),
    };
  } catch {
    return { content: undefined, roleIds: [] };
  }
}
