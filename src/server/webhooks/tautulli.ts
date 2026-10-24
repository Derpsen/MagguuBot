import { Hono } from 'hono';
import { EmbedBuilder } from 'discord.js';
import { getChannel, type ChannelKey } from '../../discord/channel-store.js';
import { getPlexCard } from '../../discord/plex-card.js';
import { Colors, truncate, FOOTER_ICONS } from '../../embeds/colors.js';
import { logger } from '../../utils/logger.js';
import { plexActivityCorrelationKey, plexPlayerCorrelationKey } from '../../utils/plex-activity.js';
import { resolveTautulliEventName } from '../../utils/tautulli-event.js';
import { postEmbed, recordHandledWebhook } from '../discord-poster.js';
import { submitFeed } from '../feed-bursts.js';
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

/** Library removals (mass deletes) never produce a Plex card. */
export const PLEX_REMOVAL = /\b(removed|deleted|gelöscht|entfernt)\b/i;

function classify(input: string): EventMeta | null {
  const t = input.toLowerCase();
  if (PLEX_REMOVAL.test(t)) return null;
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
  const classified = classify(`${titleHint} ${descHint}`);
  if (!classified) {
    logger.debug('tautulli removal event ignored');
    return;
  }
  const meta = classified;

  if (meta.kind === 'recently_added') {
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

    const title = source?.title ?? body.content ?? 'Neu auf Plex';
    await submitFeed('newOnPlex', {
      service: 'Plex',
      title,
      post: async () => {
        await postEmbed({
          channelId: getChannel(meta.channel),
          embed: buildEmbed(meta),
          source: 'tautulli',
          eventType: meta.kind,
          payload: body,
        });
      },
    }, [title.toLowerCase()]);
    return;
  }

  const mediaType = discordField(source?.fields, /^(type|typ)$/i);
  const user = discordField(source?.fields, /^(user|nutzer|benutzer)$/i);
  const player = discordField(source?.fields, /^player$/i);
  const text = source?.description ?? body.content;
  publishActivityCard({
    kind: meta.kind,
    correlationKey: plexPlayerCorrelationKey({ user, player, mediaType }),
    user,
    player,
    title: firstLine(text),
    mediaType,
    payload: body,
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
      .setFooter({ text: 'MagguuBot · now available', iconURL: FOOTER_ICONS.bot });

    if (body.summary) embed.setDescription(truncate(body.summary, 600));
    if (body.posterUrl) embed.setThumbnail(body.posterUrl);
    if (body.mediaType) embed.addFields({ name: 'Type', value: body.mediaType, inline: true });

    const title = `${body.title ?? 'New media'}${body.year ? ` · ${body.year}` : ''}`;
    await submitFeed('newOnPlex', {
      service: 'Plex',
      title,
      post: async () => {
        await postEmbed({
          channelId: getChannel('newOnPlex'),
          embed,
          source: 'tautulli',
          eventType: 'recently_added',
          payload: body,
        });
      },
    }, [title.toLowerCase()]);
    return;
  }

  const fullTitle = body.showTitle
    ? `${body.showTitle} — ${body.season ?? ''}${body.episode ? `E${body.episode}` : ''} · ${body.title ?? ''}`
    : `${body.title ?? 'Unbekannt'}${body.year ? ` (${body.year})` : ''}`;

  publishActivityCard({
    kind: meta.kind,
    correlationKey: plexActivityCorrelationKey(body),
    sessionKey: body.sessionKey === undefined ? null : String(body.sessionKey).trim() || null,
    user: body.user,
    player: body.player,
    title: fullTitle,
    mediaType: body.mediaType,
    payload: body,
  });
}

interface ActivityCardArgs {
  kind: string;
  correlationKey: string | null;
  sessionKey?: string | null;
  user?: string;
  player?: string;
  title?: string;
  mediaType?: string;
  payload: TautulliPayload;
}

/**
 * Plex playback events never post a message of their own: they fold into the
 * Plex user's own card (`discord/plex-card.ts`, one card per user), which edits its
 * stored message after a short debounce and only when the rendered content changed.
 * Events without a user (or from an excluded user) leave no card.
 */
function publishActivityCard(args: ActivityCardArgs): void {
  const channelId = getChannel('plexActivity');
  if (!channelId) {
    recordHandledWebhook({
      source: 'tautulli',
      eventType: args.kind,
      payload: args.payload,
      channelId: undefined,
      status: 'skipped',
      error: 'no channel configured',
    });
    logger.warn({ eventType: args.kind }, 'no channel configured for Plex activity, skipping');
    return;
  }
  const changed = getPlexCard().handleEvent(channelId, {
    kind: args.kind,
    key: args.correlationKey,
    sessionKey: args.sessionKey ?? null,
    user: args.user,
    player: args.player,
    title: args.title,
    mediaType: args.mediaType,
    at: Date.now(),
  });
  recordHandledWebhook({
    source: 'tautulli',
    eventType: args.kind,
    payload: args.payload,
    channelId,
    status: 'posted',
    error: changed ? undefined : 'unchanged, no card update',
  });
}

function firstLine(text: string | undefined): string | undefined {
  const line = text?.split('\n').map((l) => l.trim()).find(Boolean);
  return line ? truncate(line.replace(/\*\*|__/g, ''), 150) : undefined;
}

function discordField(
  fields: Array<{ name: string; value: string }> | undefined,
  name: RegExp,
): string | undefined {
  return fields?.find((field) => name.test(field.name.trim()))?.value;
}
