import { type ActionRowBuilder, type ButtonBuilder, type EmbedBuilder, type Message } from 'discord.js';
import { config } from '../config.js';
import { getClient } from '../discord/client.js';
import { db } from '../db/client.js';
import { webhookEvents, type NewWebhookEvent } from '../db/schema.js';
import { enforceEmbedTotalSize } from '../embeds/colors.js';
import { logger } from '../utils/logger.js';
import { webhookRetryDelayMs } from '../utils/retry.js';
import { sanitizePayload } from './webhook-payload-redactor.js';
import { getWebhookReplayContext } from './webhook-retry-context.js';

interface PostArgs {
  channelId: string | undefined;
  embed: EmbedBuilder;
  components?: ActionRowBuilder<ButtonBuilder>[];
  source: string;
  eventType: string;
  payload: unknown;
  pingRoles?: string[];
}

interface EditArgs extends Omit<PostArgs, 'channelId' | 'pingRoles'> {
  channelId: string;
  messageId: string;
}

export async function postEmbed(args: PostArgs): Promise<Message | null> {
  const { channelId, embed, components, source, eventType, payload, pingRoles } = args;
  const safePayload = sanitizePayload(payload) as object;

  if (!channelId) {
    logWebhookEvent({
      source,
      eventType,
      payload: safePayload,
      status: 'skipped',
      error: 'no channel configured',
    });
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
    logWebhookEvent({
      source,
      eventType,
      payload: safePayload,
      channelId,
      messageId: message.id,
      status: 'posted',
    });

    return message;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ source, eventType, error }, 'failed to post embed');
    logWebhookEvent({
      source,
      eventType,
      payload: safePayload,
      channelId,
      status: 'failed',
      error,
    });
    return null;
  }
}

export async function editEmbed(args: EditArgs): Promise<Message | null> {
  const { channelId, messageId, embed, components, source, eventType, payload } = args;
  const safePayload = sanitizePayload(payload) as object;
  try {
    const channel = await getClient().channels.fetch(channelId);
    if (!channel?.isTextBased()) throw new Error(`channel ${channelId} is not text-based`);
    const message = await channel.messages.fetch(messageId);
    enforceEmbedTotalSize(embed);
    const edited = await message.edit({ embeds: [embed], components: components ?? [] });
    logWebhookEvent({
      source,
      eventType,
      payload: safePayload,
      channelId,
      messageId,
      status: 'posted',
    });
    return edited;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ source, eventType, channelId, messageId, error }, 'failed to edit embed');
    return null;
  }
}

function logWebhookEvent(values: NewWebhookEvent): void {
  try {
    const replay = getWebhookReplayContext();
    const retry = values.status === 'failed' && !replay?.suppressRetrySchedule
      ? {
          retryState: 'pending' as const,
          nextRetryAt: new Date(Date.now() + webhookRetryDelayMs(0)),
        }
      : {};
    db.insert(webhookEvents)
      .values({ ...values, ...retry, replayOfEventId: replay?.replayOfEventId })
      .run();
  } catch (err) {
    logger.error(
      { err, source: values.source, eventType: values.eventType, status: values.status },
      'failed to write webhook activity log',
    );
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
