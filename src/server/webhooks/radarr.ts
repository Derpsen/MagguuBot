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
import { radarrPayloadSchema } from './schemas.js';

function is4kQuality(q: string | undefined): boolean {
  if (!q) return false;
  const l = q.toLowerCase();
  return l.includes('2160') || l.includes('4k') || l.includes('uhd');
}

export const radarrWebhook = new Hono().post('/', async (c) => {
  const parsed = radarrPayloadSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.flatten() }, 'radarr webhook payload invalid');
    return c.json({ ok: false, error: 'invalid payload' }, 400);
  }
  const body = parsed.data;
  logger.debug({ eventType: body.eventType }, 'radarr webhook received');

  const poster = body.movie?.images?.find((i) => i.coverType === 'poster')?.remoteUrl ?? null;
  const title = body.movie?.title ?? body.remoteMovie?.title ?? 'Unknown movie';
  const year = body.movie?.year ?? body.remoteMovie?.year;

  switch (body.eventType) {
    case 'Test':
      return c.json({ ok: true, test: true });

    case 'Grab': {
      const quality = body.release?.quality;
      const pingRoles = ['ping-movies'];
      if (is4kQuality(quality)) pingRoles.push('ping-4k');
      await postEmbed({
        channelId: getChannel('grabs'),
        embed: buildGrabEmbed({
          service: 'radarr',
          title,
          year,
          posterUrl: poster,
          quality,
          size: body.release?.size,
          releaseGroup: body.release?.releaseGroup,
          releaseTitle: body.release?.releaseTitle,
          indexer: body.release?.indexer,
        }),
        source: 'radarr',
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
    case 'DownloadFailure':
    case 'ImportFailure': {
      await postEmbed({
        channelId: getChannel('failures'),
        embed: buildFailureEmbed({
          service: 'radarr',
          title,
          reason: body.message,
          eventType: body.eventType,
          downloadClient: body.downloadClient,
          releaseTitle: body.release?.releaseTitle,
          quality: body.release?.quality ?? body.movieFile?.quality,
        }),
        source: 'radarr',
        eventType: body.eventType,
        payload: body,
      });
      break;
    }
    case 'MovieDelete': {
      await postEmbed({
        channelId: getChannel('maintainerr'),
        embed: buildDeleteEmbed({
          service: 'radarr',
          kind: 'movie',
          title,
          year,
          posterUrl: poster,
          deletedFiles: body.deletedFiles,
        }),
        source: 'radarr',
        eventType: body.eventType,
        payload: body,
      });
      break;
    }
    case 'MovieFileDelete': {
      await postEmbed({
        channelId: getChannel('maintainerr'),
        embed: buildDeleteEmbed({
          service: 'radarr',
          kind: 'movieFile',
          title,
          year,
          posterUrl: poster,
          quality: body.movieFile?.quality,
          size: body.movieFile?.size,
          reason: body.message,
        }),
        source: 'radarr',
        eventType: body.eventType,
        payload: body,
      });
      break;
    }
    case 'ApplicationUpdate': {
      await postEmbed({
        channelId: getChannel('health'),
        embed: buildAppUpdateEmbed({
          service: 'radarr',
          previousVersion: body.previousVersion,
          newVersion: body.newVersion,
          message: body.message,
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
        channelId: getChannel('health'),
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
    case 'Rename':
    case 'MovieAdded':
      logger.debug({ eventType: body.eventType }, 'radarr event skipped (low signal)');
      break;
    default:
      logger.debug({ eventType: body.eventType }, 'radarr event ignored');
  }

  return c.json({ ok: true });
});
