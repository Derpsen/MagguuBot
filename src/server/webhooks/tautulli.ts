import { Hono } from 'hono';
import { EmbedBuilder } from 'discord.js';
import { and, desc, eq } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { plexActivityMessages, type PlexActivityMessage } from '../../db/schema.js';
import { getChannel, type ChannelKey } from '../../discord/channel-store.js';
import { Colors, truncate } from '../../embeds/colors.js';
import { logger } from '../../utils/logger.js';
import { plexActivityCorrelationKey, preservePlexActivityState } from '../../utils/plex-activity.js';
import { resolveTautulliEventName } from '../../utils/tautulli-event.js';
import { editEmbed, postEmbed } from '../discord-poster.js';
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

export function resolveTautulliEventMeta(event: string): EventMeta | undefined {
  const name = resolveTautulliEventName(event);
  return name ? EVENT_META[name] : undefined;
}

function classify(input: string): EventMeta {
  const t = input.toLowerCase();
  if (/(recently added|new media|hinzugefügt|available|now available|\bcreated\b)/.test(t)) return EVENT_META.recently_added!;
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
  return Boolean(candidate.embeds?.length) || Boolean(candidate.content?.trim());
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

  const buildEmbed = (displayMeta: EventMeta): EmbedBuilder => {
    const rebuilt = new EmbedBuilder()
      .setColor(typeof source?.color === 'number' ? source.color : displayMeta.color)
      .setAuthor({ name: `Plex · ${body.username ?? 'Tautulli'}` })
      .setTitle(`${displayMeta.emoji} ${meta.kind === 'recently_added' && source?.title ? truncate(source.title, 240) : displayMeta.label}`)
      .setTimestamp(new Date())
      .setFooter({ text: `MagguuBot · ${displayMeta.kind}` });

    if (source?.description) rebuilt.setDescription(truncate(source.description, 2000));
    else if (body.content) rebuilt.setDescription(truncate(body.content, 2000));
    if (source?.thumbnail?.url) rebuilt.setThumbnail(source.thumbnail.url);
    if (source?.image?.url) rebuilt.setImage(source.image.url);
    if (source?.fields?.length) {
      rebuilt.addFields(source.fields.slice(0, 25).map((f) => ({
        name: f.name.slice(0, 256),
        value: f.value.slice(0, 1024),
        inline: f.inline ?? false,
      })));
    }
    return rebuilt;
  };

  if (meta.kind === 'recently_added') {
    await postEmbed({
      channelId: getChannel(meta.channel),
      embed: buildEmbed(meta),
      source: 'tautulli',
      eventType: meta.kind,
      payload: body,
    });
    return;
  }

  const mediaType = discordField(source?.fields, /^(type|typ)$/i);
  await publishActivityCard({
    correlationKey: plexActivityCorrelationKey({
      user: discordField(source?.fields, /^(user|nutzer|benutzer)$/i),
      player: discordField(source?.fields, /^player$/i),
      title: source?.description ?? body.content,
      mediaType,
    }),
    incomingMeta: meta,
    payload: body,
    buildEmbed,
    reuseOnPlay: mediaType?.toLowerCase() === 'track',
  });
}

async function handleCustom(body: TautulliCustomPayload): Promise<void> {
  const event = (body.event ?? body.action ?? '').toLowerCase();
  const meta = resolveTautulliEventMeta(event);
  if (!meta) {
    logger.debug({ event }, 'tautulli custom event ignored');
    return;
  }

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

  await publishActivityCard({
    correlationKey: plexActivityCorrelationKey(body),
    incomingMeta: meta,
    payload: body,
    sessionKey: body.sessionKey,
    reuseOnPlay: body.mediaType?.toLowerCase() === 'track',
    buildEmbed: (displayMeta) => {
      const embed = new EmbedBuilder()
        .setColor(displayMeta.color)
        .setAuthor({ name: `Plex-Aktivität · ${body.serverName ?? 'Server'}` })
        .setTitle(`${displayMeta.emoji} ${displayMeta.label}`)
        .setDescription(truncate(fullTitle, 500))
        .setTimestamp(new Date())
        .setFooter({ text: 'MagguuBot · Plex-Aktivität' });

      if (body.user) embed.addFields({ name: 'Nutzer', value: body.user, inline: true });
      if (body.player) embed.addFields({ name: 'Player', value: body.player, inline: true });
      if (body.progress && body.duration) {
        embed.addFields({
          name: 'Fortschritt',
          value: `${body.progress} / ${body.duration}${body.progressPercent ? ` (${body.progressPercent}%)` : ''}`,
          inline: true,
        });
      }
      if (body.mediaType) embed.addFields({ name: 'Typ', value: body.mediaType, inline: true });
      if (body.posterUrl) embed.setThumbnail(body.posterUrl);
      return embed;
    },
  });
}

interface ActivityCardArgs {
  correlationKey: string | null;
  incomingMeta: EventMeta;
  payload: TautulliPayload;
  buildEmbed: (meta: EventMeta) => EmbedBuilder;
  sessionKey?: string | number;
  reuseOnPlay?: boolean;
}

async function publishActivityCard(args: ActivityCardArgs): Promise<void> {
  const { correlationKey, incomingMeta, payload, buildEmbed, reuseOnPlay = false } = args;
  const channelId = getChannel('plexActivity');
  const existing = correlationKey ? latestActivity(correlationKey) : undefined;
  const sessionKey = args.sessionKey === undefined ? null : String(args.sessionKey).trim() || null;
  if (
    reuseOnPlay
    && incomingMeta.kind !== 'play'
    && existing?.sessionKey
    && sessionKey
    && existing.sessionKey !== sessionKey
  ) {
    logger.debug(
      { correlationKey, staleSession: sessionKey, activeSession: existing.sessionKey, event: incomingMeta.kind },
      'stale music playback event ignored',
    );
    return;
  }
  const duplicatePlay = incomingMeta.kind === 'play'
    && existing
    && existing.updatedAt.getTime() >= Date.now() - 2 * 60_000;
  const shouldEdit = Boolean(existing && (incomingMeta.kind !== 'play' || duplicatePlay || reuseOnPlay));
  const displayKind = preservePlexActivityState(shouldEdit ? existing?.state : undefined, incomingMeta.kind);
  const displayMeta = EVENT_META[displayKind] ?? incomingMeta;
  const embed = buildEmbed(displayMeta);

  if (shouldEdit && existing && channelId === existing.channelId) {
    const edited = await editEmbed({
      channelId: existing.channelId,
      messageId: existing.messageId,
      embed,
      source: 'tautulli',
      eventType: incomingMeta.kind,
      payload,
    });
    if (edited) {
      db.update(plexActivityMessages)
        .set({ state: displayKind, sessionKey, updatedAt: new Date() })
        .where(eq(plexActivityMessages.id, existing.id))
        .run();
      return;
    }
  }

  const posted = await postEmbed({
    channelId,
    embed,
    source: 'tautulli',
    eventType: incomingMeta.kind,
    payload,
  });
  if (posted && correlationKey) {
    db.insert(plexActivityMessages).values({
      guildId: config.DISCORD_GUILD_ID,
      correlationKey,
      sessionKey,
      channelId: posted.channelId,
      messageId: posted.id,
      state: displayKind,
    }).run();
  }
}

function latestActivity(correlationKey: string): PlexActivityMessage | undefined {
  return db.select().from(plexActivityMessages)
    .where(and(
      eq(plexActivityMessages.guildId, config.DISCORD_GUILD_ID),
      eq(plexActivityMessages.correlationKey, correlationKey),
    ))
    .orderBy(desc(plexActivityMessages.updatedAt), desc(plexActivityMessages.id))
    .limit(1)
    .get();
}

function discordField(
  fields: Array<{ name: string; value: string }> | undefined,
  name: RegExp,
): string | undefined {
  return fields?.find((field) => name.test(field.name.trim()))?.value;
}
