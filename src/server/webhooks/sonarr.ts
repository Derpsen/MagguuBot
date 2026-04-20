import { Hono } from 'hono';
import { config } from '../../config.js';
import { buildFailureEmbed, buildGrabEmbed, buildHealthEmbed, buildImportEmbed } from '../../embeds/arr.js';
import { logger } from '../../utils/logger.js';
import { postEmbed } from '../discord-poster.js';

interface SonarrPayload {
  eventType: string;
  series?: { title: string; year?: number; images?: { coverType: string; remoteUrl?: string }[] };
  episodes?: { seasonNumber: number; episodeNumber: number; title?: string }[];
  release?: { quality?: string; size?: number; releaseGroup?: string; releaseTitle?: string; indexer?: string };
  episodeFile?: { quality?: string; size?: number; releaseGroup?: string };
  isUpgrade?: boolean;
  level?: 'ok' | 'warning' | 'error';
  message?: string;
  type?: string;
  instanceName?: string;
}

export const sonarrWebhook = new Hono().post('/', async (c) => {
  const body = await c.req.json<SonarrPayload>();
  logger.debug({ eventType: body.eventType }, 'sonarr webhook received');

  const poster = body.series?.images?.find((i) => i.coverType === 'poster')?.remoteUrl ?? null;
  const episode = body.episodes?.[0];
  const commonEpisode = episode
    ? { season: episode.seasonNumber, number: episode.episodeNumber, title: episode.title }
    : undefined;

  switch (body.eventType) {
    case 'Test': {
      return c.json({ ok: true, test: true });
    }
    case 'Grab': {
      await postEmbed({
        channelId: config.DISCORD_CHANNEL_GRABS,
        embed: buildGrabEmbed({
          service: 'sonarr',
          title: body.series?.title ?? 'Unknown series',
          year: body.series?.year,
          posterUrl: poster,
          episode: commonEpisode,
          quality: body.release?.quality,
          size: body.release?.size,
          releaseGroup: body.release?.releaseGroup,
          releaseTitle: body.release?.releaseTitle,
          indexer: body.release?.indexer,
        }),
        source: 'sonarr',
        eventType: body.eventType,
        payload: body,
      });
      break;
    }
    case 'Download': {
      await postEmbed({
        channelId: config.DISCORD_CHANNEL_IMPORTS,
        embed: buildImportEmbed({
          service: 'sonarr',
          title: body.series?.title ?? 'Unknown series',
          year: body.series?.year,
          posterUrl: poster,
          episode: commonEpisode,
          quality: body.episodeFile?.quality ?? body.release?.quality,
          size: body.episodeFile?.size,
          releaseGroup: body.episodeFile?.releaseGroup,
          isUpgrade: body.isUpgrade,
        }),
        source: 'sonarr',
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
          service: 'sonarr',
          title: body.series?.title ?? 'Unknown',
          reason: body.message,
          eventType: body.eventType,
        }),
        source: 'sonarr',
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
          service: 'Sonarr',
          level: body.level ?? 'warning',
          message: body.message ?? body.eventType,
          type: body.type,
        }),
        source: 'sonarr',
        eventType: body.eventType,
        payload: body,
      });
      break;
    }
    default:
      logger.debug({ eventType: body.eventType }, 'sonarr event ignored');
  }

  return c.json({ ok: true });
});
