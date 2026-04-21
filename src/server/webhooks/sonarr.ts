import { Hono } from 'hono';
import { getChannel } from '../../discord/channel-store.js';
import {
  buildAppUpdateEmbed,
  buildDeleteEmbed,
  buildFailureEmbed,
  buildGrabEmbed,
  buildHealthEmbed,
  buildImportEmbed,
} from '../../embeds/arr.js';
import { logger } from '../../utils/logger.js';
import { postEmbed } from '../discord-poster.js';

interface SonarrEpisode {
  seasonNumber: number;
  episodeNumber: number;
  title?: string;
}

interface SonarrEpisodeFile {
  quality?: string;
  size?: number;
  releaseGroup?: string;
  path?: string;
}

interface SonarrPayload {
  eventType: string;
  series?: {
    title: string;
    year?: number;
    path?: string;
    images?: { coverType: string; remoteUrl?: string }[];
  };
  episodes?: SonarrEpisode[];
  release?: {
    quality?: string;
    size?: number;
    releaseGroup?: string;
    releaseTitle?: string;
    indexer?: string;
  };
  episodeFile?: SonarrEpisodeFile;
  episodeFiles?: SonarrEpisodeFile[];
  deletedFiles?: boolean;
  downloadClient?: string;
  isUpgrade?: boolean;
  level?: 'ok' | 'warning' | 'error';
  message?: string;
  type?: string;
  instanceName?: string;
  previousVersion?: string;
  newVersion?: string;
}

function is4kQuality(q: string | undefined): boolean {
  if (!q) return false;
  const l = q.toLowerCase();
  return l.includes('2160') || l.includes('4k') || l.includes('uhd');
}

export const sonarrWebhook = new Hono().post('/', async (c) => {
  const body = await c.req.json<SonarrPayload>();
  logger.debug({ eventType: body.eventType }, 'sonarr webhook received');

  const poster = body.series?.images?.find((i) => i.coverType === 'poster')?.remoteUrl ?? null;
  const episode = body.episodes?.[0];
  const commonEpisode = episode
    ? { season: episode.seasonNumber, number: episode.episodeNumber, title: episode.title }
    : undefined;
  const seriesTitle = body.series?.title ?? 'Unknown series';

  switch (body.eventType) {
    case 'Test': {
      return c.json({ ok: true, test: true });
    }
    case 'Grab': {
      const quality = body.release?.quality;
      const pingRoles = ['ping-series'];
      if (is4kQuality(quality)) pingRoles.push('ping-4k');
      await postEmbed({
        channelId: getChannel('grabs'),
        embed: buildGrabEmbed({
          service: 'sonarr',
          title: seriesTitle,
          year: body.series?.year,
          posterUrl: poster,
          episode: commonEpisode,
          quality,
          size: body.release?.size,
          releaseGroup: body.release?.releaseGroup,
          releaseTitle: body.release?.releaseTitle,
          indexer: body.release?.indexer,
        }),
        source: 'sonarr',
        eventType: body.eventType,
        payload: body,
        pingRoles,
      });
      break;
    }
    case 'Download': {
      await postEmbed({
        channelId: getChannel('imports'),
        embed: buildImportEmbed({
          service: 'sonarr',
          title: seriesTitle,
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
    case 'DownloadFailure':
    case 'ImportFailure': {
      await postEmbed({
        channelId: getChannel('failures'),
        embed: buildFailureEmbed({
          service: 'sonarr',
          title: seriesTitle,
          reason: body.message,
          eventType: body.eventType,
          downloadClient: body.downloadClient,
          releaseTitle: body.release?.releaseTitle,
          quality: body.release?.quality ?? body.episodeFile?.quality,
        }),
        source: 'sonarr',
        eventType: body.eventType,
        payload: body,
      });
      break;
    }
    case 'SeriesDelete': {
      await postEmbed({
        channelId: getChannel('maintainerr'),
        embed: buildDeleteEmbed({
          service: 'sonarr',
          kind: 'series',
          title: seriesTitle,
          year: body.series?.year,
          posterUrl: poster,
          deletedFiles: body.deletedFiles,
        }),
        source: 'sonarr',
        eventType: body.eventType,
        payload: body,
      });
      break;
    }
    case 'EpisodeFileDelete': {
      const file = body.episodeFile ?? body.episodeFiles?.[0];
      await postEmbed({
        channelId: getChannel('maintainerr'),
        embed: buildDeleteEmbed({
          service: 'sonarr',
          kind: 'episodeFile',
          title: seriesTitle,
          year: body.series?.year,
          posterUrl: poster,
          episode: commonEpisode,
          quality: file?.quality,
          size: file?.size,
          reason: body.message,
        }),
        source: 'sonarr',
        eventType: body.eventType,
        payload: body,
      });
      break;
    }
    case 'ApplicationUpdate': {
      await postEmbed({
        channelId: getChannel('health'),
        embed: buildAppUpdateEmbed({
          service: 'sonarr',
          previousVersion: body.previousVersion,
          newVersion: body.newVersion,
          message: body.message,
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
        channelId: getChannel('health'),
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
    case 'Rename':
    case 'SeriesAdd':
      logger.debug({ eventType: body.eventType }, 'sonarr event skipped (low signal)');
      break;
    default:
      logger.debug({ eventType: body.eventType }, 'sonarr event ignored');
  }

  return c.json({ ok: true });
});
