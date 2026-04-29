import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { seerrRequests, webhookEvents } from '../../db/schema.js';
import { getClient } from '../../discord/client.js';
import { getChannel } from '../../discord/channel-store.js';
import {
  buildSeerrApprovalButtons,
  buildSeerrIssueEmbed,
  buildSeerrRequestEmbed,
  type SeerrRequestStatus,
} from '../../embeds/seerr.js';
import { getTmdbPosterUrl } from '../../services/tmdb.js';
import { logger } from '../../utils/logger.js';
import { postEmbed } from '../discord-poster.js';
import { seerrPayloadSchema } from './schemas.js';

function updateRequestStatus(requestId: number, status: SeerrRequestStatus): void {
  if (!requestId) return;
  db.update(seerrRequests)
    .set({ status })
    .where(eq(seerrRequests.seerrRequestId, requestId))
    .run();
}

async function disableSeerrPendingButtons(requestId: number): Promise<void> {
  if (!requestId) return;
  const row = db
    .select()
    .from(seerrRequests)
    .where(eq(seerrRequests.seerrRequestId, requestId))
    .get();
  if (!row) return;
  try {
    const channel = await getClient().channels.fetch(row.channelId);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(row.messageId);
    await message.edit({ components: [buildSeerrApprovalButtons(requestId, true)] });
  } catch (err) {
    logger.debug({ err, requestId }, 'seerr pending buttons already gone or not disable-able');
  }
}

export const seerrWebhook = new Hono().post('/', async (c) => {
  const parsed = seerrPayloadSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.flatten() }, 'seerr webhook payload invalid');
    return c.json({ ok: false, error: 'invalid payload' }, 400);
  }
  const body = parsed.data;
  logger.debug({ notification_type: body.notification_type }, 'seerr webhook received');

  if (body.notification_type === 'TEST_NOTIFICATION') {
    db.insert(webhookEvents)
      .values({
        source: 'seerr',
        eventType: 'TEST_NOTIFICATION',
        payload: body,
        channelId: null,
        messageId: null,
        status: 'skipped',
        error: 'test notification — not posted to Discord',
      })
      .run();
    logger.info('seerr TEST_NOTIFICATION received');
    return c.json({ ok: true, test: true });
  }

  const requestId = Number(body.request?.request_id ?? 0);
  const mediaType = body.media?.media_type ?? 'movie';
  const title = body.subject ?? 'Unknown request';
  const tmdbId = body.media?.tmdbId ? Number(body.media.tmdbId) : undefined;
  const yearMatch = title.match(/\((\d{4})\)/);
  const year = yearMatch?.[1];
  const plainTitle = title.replace(/\s*\(\d{4}\)\s*$/, '');

  let posterUrl: string | null = body.image ?? null;
  if (!posterUrl && tmdbId) {
    posterUrl = await getTmdbPosterUrl(mediaType, tmdbId);
  }

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
      updateRequestStatus(requestId, 'approved');
      await disableSeerrPendingButtons(requestId);
      await postEmbed({
        channelId: getChannel('requests'),
        embed: buildSeerrRequestEmbed({
          requestId,
          mediaType,
          title: plainTitle,
          year,
          overview: body.message,
          posterUrl,
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
      updateRequestStatus(requestId, 'declined');
      await disableSeerrPendingButtons(requestId);
      await postEmbed({
        channelId: getChannel('requests'),
        embed: buildSeerrRequestEmbed({
          requestId,
          mediaType,
          title: plainTitle,
          year,
          overview: body.message,
          posterUrl,
          requestedBy: body.request?.requestedBy_username,
          status: 'declined',
        }),
        source: 'seerr',
        eventType: body.notification_type,
        payload: body,
      });
      break;
    }
    case 'MEDIA_AVAILABLE': {
      updateRequestStatus(requestId, 'available');
      await disableSeerrPendingButtons(requestId);
      await postEmbed({
        channelId: getChannel('requests'),
        embed: buildSeerrRequestEmbed({
          requestId,
          mediaType,
          title: plainTitle,
          year,
          overview: body.message,
          posterUrl,
          requestedBy: body.request?.requestedBy_username,
          status: 'available',
        }),
        source: 'seerr',
        eventType: body.notification_type,
        payload: body,
      });
      break;
    }
    case 'MEDIA_FAILED': {
      updateRequestStatus(requestId, 'failed');
      await disableSeerrPendingButtons(requestId);
      await postEmbed({
        channelId: getChannel('requests'),
        embed: buildSeerrRequestEmbed({
          requestId,
          mediaType,
          title: plainTitle,
          year,
          overview: body.message,
          posterUrl,
          requestedBy: body.request?.requestedBy_username,
          status: 'failed',
        }),
        source: 'seerr',
        eventType: body.notification_type,
        payload: body,
      });
      break;
    }
    case 'MEDIA_DELETED': {
      updateRequestStatus(requestId, 'deleted');
      await disableSeerrPendingButtons(requestId);
      await postEmbed({
        channelId: getChannel('requests'),
        embed: buildSeerrRequestEmbed({
          requestId,
          mediaType,
          title: plainTitle,
          year,
          overview: body.message,
          posterUrl,
          requestedBy: body.request?.requestedBy_username,
          status: 'deleted',
        }),
        source: 'seerr',
        eventType: body.notification_type,
        payload: body,
      });
      break;
    }
    case 'ISSUE_CREATED':
    case 'ISSUE_COMMENT':
    case 'ISSUE_REOPENED':
    case 'ISSUE_RESOLVED': {
      const issueId = body.issue?.issue_id ? Number(body.issue.issue_id) : undefined;
      const issueMessage = body.comment?.comment_message ?? body.message;
      await postEmbed({
        channelId: getChannel('failures'),
        embed: buildSeerrIssueEmbed({
          notification: body.notification_type,
          issueId,
          mediaType,
          title: plainTitle,
          year,
          issueType: body.issue?.issue_type,
          issueStatus: body.issue?.issue_status,
          message: issueMessage,
          posterUrl,
          reportedBy: body.issue?.reportedBy_username,
          commentedBy: body.comment?.commentedBy_username,
          reporterDiscordId: body.issue?.reportedBy_settings_discordId,
          commenterDiscordId: body.comment?.commentedBy_settings_discordId,
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
