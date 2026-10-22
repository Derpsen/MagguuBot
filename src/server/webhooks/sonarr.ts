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
import { postOrEditLifecycleEmbed } from '../lifecycle-poster.js';
import { submitFeed } from '../feed-bursts.js';
import { importItemKeys, importNameKeys } from '../../utils/import-dedupe.js';
import { deletedFilesPresent, healthLevelForEvent, is4kQuality, isUpgradeFileDelete, sonarrPayloadSchema } from './schemas.js';
export const sonarrWebhook = new Hono().post('/', async (c) => {
  const parsed = sonarrPayloadSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.flatten() }, 'sonarr webhook payload invalid');
    return c.json({ ok: false, error: 'invalid payload' }, 400);
  }
  const body = parsed.data;
  logger.debug({ eventType: body.eventType }, 'sonarr webhook received');

  const poster = body.series?.images?.find((i) => i.coverType === 'poster')?.remoteUrl ?? null;
  const episodes = (body.episodes ?? []).map((episode) => ({
    season: episode.seasonNumber,
    number: episode.episodeNumber,
    title: episode.title,
  }));
  const seriesTitle = body.series?.title ?? 'Unknown series';

  switch (body.eventType) {
    case 'Test': {
      return c.json({ ok: true, test: true });
    }
    case 'Grab': {
      const quality = body.release?.quality;
      const pingRoles = ['ping-series'];
      if (is4kQuality(quality)) pingRoles.push('ping-extras');
      await submitFeed('grabs', {
        service: 'Sonarr',
        title: seriesTitle,
        post: async () => {
        await postEmbed({
          channelId: getChannel('grabs'),
          embed: buildGrabEmbed({
            service: 'sonarr',
            title: seriesTitle,
            year: body.series?.year,
            posterUrl: poster,
            episodes,
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
        },
      }, importNameKeys({ service: 'sonarr', title: seriesTitle, mediaId: (body.series as { id?: number } | undefined)?.id, episodes: (body.episodes ?? []).map((e) => ({ season: e.seasonNumber, number: e.episodeNumber })), downloadId: (body as { downloadId?: string }).downloadId, releaseNames: [body.release?.releaseTitle, (body.episodeFile as { sceneName?: string; relativePath?: string } | undefined)?.sceneName, body.episodeFile?.path] }));
      break;
    }
    case 'Download':
    case 'ImportComplete': {
      await submitFeed('imports', {
        service: 'Sonarr',
        title: seriesTitle,
        post: async () => {
        await postEmbed({
          channelId: getChannel('imports'),
          embed: buildImportEmbed({
            service: 'sonarr',
            title: seriesTitle,
            year: body.series?.year,
            posterUrl: poster,
            episodes,
            quality: body.episodeFile?.quality ?? body.release?.quality,
            size: body.episodeFile?.size,
            releaseGroup: body.episodeFile?.releaseGroup,
            isUpgrade: body.isUpgrade,
          }),
          source: 'sonarr',
          eventType: body.eventType,
          payload: body,
        });
        },
      }, [...importItemKeys({ service: 'sonarr', title: seriesTitle, mediaId: (body.series as { id?: number } | undefined)?.id, episodes: (body.episodes ?? []).map((e) => ({ season: e.seasonNumber, number: e.episodeNumber })), downloadId: (body as { downloadId?: string }).downloadId, releaseNames: [body.release?.releaseTitle, (body.episodeFile as { sceneName?: string; relativePath?: string } | undefined)?.sceneName, body.episodeFile?.path] }), ...importNameKeys({ service: 'sonarr', title: seriesTitle, mediaId: (body.series as { id?: number } | undefined)?.id, episodes: (body.episodes ?? []).map((e) => ({ season: e.seasonNumber, number: e.episodeNumber })), downloadId: (body as { downloadId?: string }).downloadId, releaseNames: [body.release?.releaseTitle, (body.episodeFile as { sceneName?: string; relativePath?: string } | undefined)?.sceneName, body.episodeFile?.path] })]);
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
      await submitFeed('deletes', {
        service: 'Sonarr',
        title: seriesTitle,
        post: async () => {
        await postEmbed({
          channelId: getChannel('health'),
          embed: buildDeleteEmbed({
            service: 'sonarr',
            kind: 'series',
            title: seriesTitle,
            year: body.series?.year,
            posterUrl: poster,
            deletedFiles: deletedFilesPresent(body.deletedFiles),
          }),
          source: 'sonarr',
          eventType: body.eventType,
          payload: body,
        });
        },
      }, []);
      break;
    }
    case 'EpisodeFileDelete': {
      if (isUpgradeFileDelete(body)) {
        logger.debug({ eventType: body.eventType, deleteReason: body.deleteReason }, 'sonarr upgrade file delete skipped');
        break;
      }
      const file = body.episodeFile ?? body.episodeFiles?.[0];
      await submitFeed('deletes', {
        service: 'Sonarr',
        title: seriesTitle,
        post: async () => {
        await postEmbed({
          channelId: getChannel('health'),
          embed: buildDeleteEmbed({
            service: 'sonarr',
            kind: 'episodeFile',
            title: seriesTitle,
            year: body.series?.year,
            posterUrl: poster,
            episodes,
            quality: file?.quality,
            size: file?.size,
            reason: body.message ?? body.deleteReason,
          }),
          source: 'sonarr',
          eventType: body.eventType,
          payload: body,
        });
        },
      }, []);
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
      const common = {
        channelId: getChannel('health'),
        embed: buildHealthEmbed({
          service: 'Sonarr',
          level: healthLevelForEvent(body.eventType, body.level),
          message: body.message ?? body.eventType,
          type: body.type,
        }),
        source: 'sonarr',
        eventType: body.eventType,
        payload: body,
      };
      if (body.type) {
        await postOrEditLifecycleEmbed({
          ...common,
          lifecycleKey: `health:sonarr:${body.type.toLowerCase()}`,
          state: body.eventType,
        });
      } else {
        await postEmbed(common);
      }
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
