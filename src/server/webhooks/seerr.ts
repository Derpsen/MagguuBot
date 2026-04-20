import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { seerrRequests } from '../../db/schema.js';
import { getChannel } from '../../discord/channel-store.js';
import { buildSeerrApprovalButtons, buildSeerrRequestEmbed } from '../../embeds/seerr.js';
import { logger } from '../../utils/logger.js';
import { postEmbed } from '../discord-poster.js';

interface SeerrPayload {
  notification_type: string;
  event?: string;
  subject?: string;
  message?: string;
  image?: string;
  media?: { media_type?: 'movie' | 'tv'; tmdbId?: string | number; status?: string };
  request?: { request_id?: string | number; requestedBy_username?: string };
  extra?: { name: string; value: string }[];
}

export const seerrWebhook = new Hono().post('/', async (c) => {
  const body = await c.req.json<SeerrPayload>();
  logger.debug({ notification_type: body.notification_type }, 'seerr webhook received');

  if (body.notification_type === 'TEST_NOTIFICATION') {
    return c.json({ ok: true, test: true });
  }

  const requestId = Number(body.request?.request_id ?? 0);
  const mediaType = body.media?.media_type ?? 'movie';
  const title = body.subject ?? 'Unknown request';
  const tmdbId = body.media?.tmdbId ? Number(body.media.tmdbId) : undefined;
  const yearMatch = title.match(/\((\d{4})\)/);
  const year = yearMatch?.[1];
  const plainTitle = title.replace(/\s*\(\d{4}\)\s*$/, '');

  switch (body.notification_type) {
    case 'MEDIA_PENDING': {
      const embed = buildSeerrRequestEmbed({
        requestId,
        mediaType,
        title: plainTitle,
        year,
        overview: body.message,
        posterUrl: body.image ?? null,
        requestedBy: body.request?.requestedBy_username,
        status: 'pending',
      });
      const buttons = buildSeerrApprovalButtons(requestId);
      const message = await postEmbed({
        channelId: getChannel('approvals') ?? getChannel('requests'),
        embed,
        components: [buttons],
        source: 'seerr',
        eventType: body.notification_type,
        payload: body,
      });
      if (message && requestId) {
        db.insert(seerrRequests)
          .values({
            seerrRequestId: requestId,
            messageId: message.id,
            channelId: message.channelId,
            mediaType,
            tmdbId,
            title: plainTitle,
            status: 'pending',
            requestedBy: body.request?.requestedBy_username,
          })
          .onConflictDoNothing()
          .run();
      }
      break;
    }
    case 'MEDIA_APPROVED':
    case 'MEDIA_AUTO_APPROVED': {
      if (requestId) {
        db.update(seerrRequests).set({ status: 'approved' }).where(eq(seerrRequests.seerrRequestId, requestId)).run();
      }
      await postEmbed({
        channelId: getChannel('requests'),
        embed: buildSeerrRequestEmbed({
          requestId,
          mediaType,
          title: plainTitle,
          year,
          overview: body.message,
          posterUrl: body.image ?? null,
          requestedBy: body.request?.requestedBy_username,
          status: 'approved',
        }),
        source: 'seerr',
        eventType: body.notification_type,
        payload: body,
      });
      break;
    }
    case 'MEDIA_DECLINED': {
      if (requestId) {
        db.update(seerrRequests).set({ status: 'declined' }).where(eq(seerrRequests.seerrRequestId, requestId)).run();
      }
      await postEmbed({
        channelId: getChannel('requests'),
        embed: buildSeerrRequestEmbed({
          requestId,
          mediaType,
          title: plainTitle,
          year,
          overview: body.message,
          posterUrl: body.image ?? null,
          requestedBy: body.request?.requestedBy_username,
          status: 'declined',
        }),
        source: 'seerr',
        eventType: body.notification_type,
        payload: body,
      });
      break;
    }
    default:
      logger.debug({ type: body.notification_type }, 'seerr event ignored');
  }

  return c.json({ ok: true });
});
