import { Hono } from 'hono';
import { EmbedBuilder } from 'discord.js';
import { getChannel, type ChannelKey } from '../../discord/channel-store.js';
import { Colors, truncate } from '../../embeds/colors.js';
import { logger } from '../../utils/logger.js';
import { postEmbed } from '../discord-poster.js';
import {
  tautulliPayloadSchema,
  type TautulliPayload,
  type TautulliDiscordPayload,
  type TautulliCustomPayload,
} from './schemas.js';

interface EventMeta {
  kind: string;
  emoji: string;
  label: string;
  color: number;
  channel: ChannelKey;
}

const EVENT_META: Record<string, EventMeta> = {
  play: { kind: 'play', emoji: '▶️', label: 'Spielt ab', color: Colors.success, channel: 'plexActivity' },
  pause: { kind: 'pause', emoji: '⏸️', label: 'Pausiert', color: Colors.warn, channel: 'plexActivity' },
  resume: { kind: 'resume', emoji: '▶️', label: 'Weiter', color: Colors.success, channel: 'plexActivity' },
  stop: { kind: 'stop', emoji: '⏹️', label: 'Gestoppt', color: Colors.muted, channel: 'plexActivity' },
  watched: { kind: 'watched', emoji: '✅', label: 'Zu Ende geschaut', color: Colors.success, channel: 'plexActivity' },
  buffer: { kind: 'buffer', emoji: '🔄', label: 'Buffering', color: Colors.warn, channel: 'plexActivity' },
  error: { kind: 'error', emoji: '⚠️', label: 'Fehler', color: Colors.danger, channel: 'plexActivity' },
  recently_added: { kind: 'recently_added', emoji: '✨', label: 'Neu verfügbar', color: Colors.plex, channel: 'newOnPlex' },
};

function classify(input: string): EventMeta {
  const t = input.toLowerCase();
  if (/(recently added|new media|hinzugefügt|available|now available)/.test(t)) return EVENT_META.recently_added!;
  if (/(started playing|started watching|began playing)/.test(t)) return EVENT_META.play!;
  if (/(has paused|paused)/.test(t)) return EVENT_META.pause!;
  if (/(has resumed|resumed)/.test(t)) return EVENT_META.resume!;
  if (/(has stopped|stopped)/.test(t)) return EVENT_META.stop!;
  if (/(has watched|watched|finished)/.test(t)) return EVENT_META.watched!;
  if (/buffering/.test(t)) return EVENT_META.buffer!;
  if (/error/.test(t)) return EVENT_META.error!;
  return EVENT_META.recently_added!;
}

function isDiscordPayload(p: TautulliPayload): p is TautulliDiscordPayload {
  const candidate = p as TautulliDiscordPayload;
  return Array.isArray(candidate.embeds) || typeof candidate.content === 'string';
}

export const tautulliWebhook = new Hono().post('/', async (c) => {
  const parsed = tautulliPayloadSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.flatten() }, 'tautulli webhook payload invalid');
    return c.json({ ok: false, error: 'invalid payload' }, 400);
  }
  const body = parsed.data;

  if (isDiscordPayload(body)) {
    await handleDiscord(body);
  } else {
    await handleCustom(body);
  }
  return c.json({ ok: true });
});

async function handleDiscord(body: TautulliDiscordPayload): Promise<void> {
  const source = body.embeds?.[0];
  const titleHint = source?.title ?? body.content ?? '';
  const descHint = source?.description ?? '';
  const meta = classify(`${titleHint} ${descHint}`);

  const rebuilt = new EmbedBuilder()
    .setColor(typeof source?.color === 'number' ? source.color : meta.color)
    .setAuthor({ name: `Plex · ${body.username ?? 'Tautulli'}` })
    .setTitle(`${meta.emoji} ${source?.title ? truncate(source.title, 240) : meta.label}`)
    .setTimestamp(new Date())
    .setFooter({ text: `MagguuBot · ${meta.kind}` });

  if (source?.description) rebuilt.setDescription(truncate(source.description, 2000));
  else if (body.content) rebuilt.setDescription(truncate(body.content, 2000));

  if (source?.thumbnail?.url) rebuilt.setThumbnail(source.thumbnail.url);
  if (source?.image?.url) rebuilt.setImage(source.image.url);
  if (source?.fields?.length) {
    rebuilt.addFields(
      source.fields.slice(0, 25).map((f) => ({
        name: f.name.slice(0, 256),
        value: f.value.slice(0, 1024),
        inline: f.inline ?? false,
      })),
    );
  }

  await postEmbed({
    channelId: getChannel(meta.channel),
    embed: rebuilt,
    source: 'tautulli',
    eventType: meta.kind,
    payload: body,
  });
}

async function handleCustom(body: TautulliCustomPayload): Promise<void> {
  const event = (body.event ?? body.action ?? '').toLowerCase();
  const meta = EVENT_META[event] ?? EVENT_META.recently_added!;

  if (meta.kind === 'recently_added') {
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
      eventType: 'recently_added',
      payload: body,
    });
    return;
  }

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
    eventType: meta.kind,
    payload: body,
  });
}
