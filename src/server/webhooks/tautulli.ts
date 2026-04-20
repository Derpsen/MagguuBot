import { Hono } from 'hono';
import { EmbedBuilder } from 'discord.js';
import { getChannel } from '../../discord/channel-store.js';
import { Colors, truncate } from '../../embeds/colors.js';
import { postEmbed } from '../discord-poster.js';

interface TautulliPayload {
  event?: string;
  action?: string;
  title?: string;
  year?: string | number;
  mediaType?: string;
  summary?: string;
  posterUrl?: string;
  serverName?: string;
  user?: string;
  player?: string;
  progress?: string;
  duration?: string;
  progressPercent?: string | number;
  episode?: string;
  season?: string;
  showTitle?: string;
}

const PLAYBACK_EVENTS = new Set([
  'play',
  'pause',
  'resume',
  'stop',
  'watched',
  'buffer',
  'error',
  'transcode_decision_change',
]);

const ACTION_META: Record<string, { emoji: string; label: string; color: number }> = {
  play: { emoji: '▶️', label: 'Spielt ab', color: Colors.success },
  pause: { emoji: '⏸️', label: 'Pausiert', color: Colors.warn },
  resume: { emoji: '▶️', label: 'Weiter', color: Colors.success },
  stop: { emoji: '⏹️', label: 'Gestoppt', color: Colors.muted },
  watched: { emoji: '✅', label: 'Zu Ende geschaut', color: Colors.success },
  buffer: { emoji: '🔄', label: 'Buffering', color: Colors.warn },
  error: { emoji: '⚠️', label: 'Fehler', color: Colors.danger },
  transcode_decision_change: { emoji: '🔄', label: 'Transcode-Change', color: Colors.info },
};

export const tautulliWebhook = new Hono().post('/', async (c) => {
  const body = await c.req.json<TautulliPayload>();
  const event = (body.event ?? body.action ?? 'recently_added').toLowerCase();

  if (PLAYBACK_EVENTS.has(event)) {
    await handlePlayback(body, event);
    return c.json({ ok: true });
  }

  await handleRecentlyAdded(body, event);
  return c.json({ ok: true });
});

async function handlePlayback(body: TautulliPayload, event: string): Promise<void> {
  const meta = ACTION_META[event] ?? { emoji: '🎬', label: event, color: Colors.info };

  const fullTitle = body.showTitle
    ? `${body.showTitle} — ${body.season ?? ''}${body.episode ? `E${body.episode}` : ''} · ${body.title ?? ''}`
    : `${body.title ?? 'Unbekannt'}${body.year ? ` (${body.year})` : ''}`;

  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setAuthor({ name: `Plex Activity · ${body.serverName ?? 'Server'}` })
    .setTitle(`${meta.emoji} ${meta.label}`)
    .setDescription(truncate(fullTitle, 500))
    .setTimestamp(new Date())
    .setFooter({ text: 'MagguuBot · Plex activity' });

  if (body.user) embed.addFields({ name: 'User', value: body.user, inline: true });
  if (body.player) embed.addFields({ name: 'Player', value: body.player, inline: true });
  if (body.progress && body.duration) {
    embed.addFields({
      name: 'Progress',
      value: `${body.progress} / ${body.duration}${body.progressPercent ? ` (${body.progressPercent}%)` : ''}`,
      inline: true,
    });
  }
  if (body.mediaType) embed.addFields({ name: 'Type', value: body.mediaType, inline: true });
  if (body.posterUrl) embed.setThumbnail(body.posterUrl);

  await postEmbed({
    channelId: getChannel('plexActivity'),
    embed,
    source: 'tautulli',
    eventType: event,
    payload: body,
  });
}

async function handleRecentlyAdded(body: TautulliPayload, event: string): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(Colors.plex)
    .setAuthor({ name: `Plex · ${body.serverName ?? 'Server'}` })
    .setTitle(`✨ ${body.title ?? 'New media'}${body.year ? ` · ${body.year}` : ''}`)
    .setTimestamp(new Date())
    .setFooter({ text: 'MagguuBot · now available' });

  if (body.summary) embed.setDescription(truncate(body.summary, 600));
  if (body.posterUrl) embed.setThumbnail(body.posterUrl);
  if (body.mediaType) embed.addFields({ name: 'Type', value: body.mediaType, inline: true });

  await postEmbed({
    channelId: getChannel('newOnPlex'),
    embed,
    source: 'tautulli',
    eventType: event,
    payload: body,
  });
}
