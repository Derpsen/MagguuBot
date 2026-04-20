import { Hono } from 'hono';
import { config } from '../../config.js';
import { buildFailureEmbed, buildGrabEmbed, buildHealthEmbed, buildImportEmbed } from '../../embeds/arr.js';
import { logger } from '../../utils/logger.js';
import { postEmbed } from '../discord-poster.js';

interface RadarrPayload {
  eventType: string;
  movie?: { title: string; year?: number; images?: { coverType: string; remoteUrl?: string }[] };
  remoteMovie?: { title?: string; year?: number };
  release?: { quality?: string; size?: number; releaseGroup?: string; releaseTitle?: string; indexer?: string };
  movieFile?: { quality?: string; size?: number; releaseGroup?: string };
  isUpgrade?: boolean;
  level?: 'ok' | 'warning' | 'error';
  message?: string;
  type?: string;
  instanceName?: string;
}

export const radarrWebhook = new Hono().post('/', async (c) => {
  const body = await c.req.json<RadarrPayload>();
  logger.debug({ eventType: body.eventType }, 'radarr webhook received');

  const poster = body.movie?.images?.find((i) => i.coverType === 'poster')?.remoteUrl ?? null;
  const title = body.movie?.title ?? body.remoteMovie?.title ?? 'Unknown movie';
  const year = body.movie?.year ?? body.remoteMovie?.year;

  switch (body.eventType) {
    case 'Test':
      return c.json({ ok: true, test: true });

    case 'Grab': {
      await postEmbed({
        channelId: config.DISCORD_CHANNEL_GRABS,
        embed: buildGrabEmbed({
          service: 'radarr',
          title,
          year,
          posterUrl: poster,
          quality: body.release?.quality,
          size: body.release?.size,
          releaseGroup: body.release?.releaseGroup,
          releaseTitle: body.release?.releaseTitle,
          indexer: body.release?.indexer,
        }),
        source: 'radarr',
        eventType: body.eventType,
        payload: body,
      });
      break;
    }
    case 'Download': {
      await postEmbed({
        channelId: config.DISCORD_CHANNEL_IMPORTS,
        embed: buildImportEmbed({
          service: 'radarr',
          title,
          year,
          posterUrl: poster,
          quality: body.movieFile?.quality ?? body.release?.quality,
          size: body.movieFile?.size,
          releaseGroup: body.movieFile?.releaseGroup,
          isUpgrade: body.isUpgrade,
        }),
        source: 'radarr',
        eventType: body.eventType,
        payload: body,
      });
      break;
    }
    case 'ManualInteractionRequired':
    case 'DownloadFailure': {
      await postEmbed({
        channelId: config.DISCORD_CHANNEL_FAILURES,
        embed: buildFailureEmbed({
          service: 'radarr',
          title,
          reason: body.message,
          eventType: body.eventType,
        }),
        source: 'radarr',
        eventType: body.eventType,
        payload: body,
      });
      break;
    }
    case 'Health':
    case 'HealthRestored': {
      await postEmbed({
        channelId: config.DISCORD_CHANNEL_HEALTH,
        embed: buildHealthEmbed({
          service: 'Radarr',
          level: body.level ?? 'warning',
          message: body.message ?? body.eventType,
          type: body.type,
        }),
        source: 'radarr',
        eventType: body.eventType,
        payload: body,
      });
      break;
    }
    default:
      logger.debug({ eventType: body.eventType }, 'radarr event ignored');
  }

  return c.json({ ok: true });
});
