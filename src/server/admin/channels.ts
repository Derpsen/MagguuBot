import type { Context } from 'hono';
import { ChannelType } from 'discord.js';
import { z } from 'zod';
import { config } from '../../config.js';
import {
  CHANNEL_CATALOG,
  getChannel,
  isChannelKey,
  saveChannel
} from '../../discord/channel-store.js';
import { getClient } from '../../discord/client-ref.js';
import { faqAutoanswerChannelIds } from '../../discord/faq-autoanswer.js';
import { logger } from '../../utils/logger.js';
import { recordAdminAudit } from '../auth/audit.js';
import { getSession } from '../auth/middleware.js';

export const getChannels = async (c: Context<any, '/channels'>) => {
  const client = getClient();
  const guild = await client.guilds.fetch(config.DISCORD_GUILD_ID).catch(() => null);
  const textChannels = guild
    ? Array.from(guild.channels.cache.values())
        .filter((ch) => ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)
        .map((ch) => ({ id: ch.id, name: ch.name, parentName: ch.parent?.name ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const mappings = CHANNEL_CATALOG.map(({ key, label, description }) => {
    const id = getChannel(key);
    const live = id ? textChannels.find((ch) => ch.id === id) : null;
    return {
      key,
      label,
      description,
      channelId: id ?? null,
      channelName: live?.name ?? null,
    };
  });

  const faqAutoanswerChannels = faqAutoanswerChannelIds().map((id) => ({
    id,
    name: guild?.channels.cache.get(id)?.name ?? null,
  }));

  return c.json({ mappings, available: textChannels, faqAutoanswerChannels });
};

const channelUpdateSchema = z.object({ channelId: z.string().regex(/^\d{17,20}$/) });

export const putChannelsKey = async (c: Context<any, '/channels/:key'>) => {
  const key = c.req.param('key');
  if (!isChannelKey(key)) {
    return c.json({ ok: false, error: 'unknown channel key' }, 400);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = channelUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: 'invalid body' }, 400);

  const client = getClient();
  const guild = client.guilds.cache.get(config.DISCORD_GUILD_ID);
  const ch = guild?.channels.cache.get(parsed.data.channelId);
  if (!ch || (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement)) {
    return c.json({ ok: false, error: 'channel not found or not a text channel' }, 422);
  }

  saveChannel(key, parsed.data.channelId);
  logger.info({ key, channelId: parsed.data.channelId, by: getSession(c).userId }, 'channel remapped via dashboard');
  recordAdminAudit(c, { action: 'channel.remap', target: key, detail: { channelId: parsed.data.channelId } });
  return c.json({ ok: true });
};
