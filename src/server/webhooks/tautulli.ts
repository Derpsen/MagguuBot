import { Hono } from 'hono';
import { EmbedBuilder } from 'discord.js';
import { getChannel } from '../../discord/channel-store.js';
import { Colors, truncate } from '../../embeds/colors.js';
import { postEmbed } from '../discord-poster.js';

interface TautulliPayload {
  event: string;
  title?: string;
  year?: string;
  mediaType?: string;
  summary?: string;
  posterUrl?: string;
  serverName?: string;
}

export const tautulliWebhook = new Hono().post('/', async (c) => {
  const body = await c.req.json<TautulliPayload>();

  const embed = new EmbedBuilder()
    .setColor(Colors.plex)
    .setAuthor({ name: `Plex  ·  ${body.serverName ?? 'Server'}` })
    .setTitle(`✨  ${body.title ?? 'New media'}${body.year ? `  ·  ${body.year}` : ''}`)
    .setTimestamp(new Date())
    .setFooter({ text: 'MagguuUI  ·  now available' });

  if (body.summary) embed.setDescription(truncate(body.summary, 600));
  if (body.posterUrl) embed.setThumbnail(body.posterUrl);
  if (body.mediaType) embed.addFields({ name: 'Type', value: body.mediaType, inline: true });

  await postEmbed({
    channelId: getChannel('newOnPlex'),
    embed,
    source: 'tautulli',
    eventType: body.event ?? 'recently_added',
    payload: body,
  });

  return c.json({ ok: true });
});
