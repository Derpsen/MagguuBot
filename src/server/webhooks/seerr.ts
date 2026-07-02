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
import { editEmbed, postEmbed } from '../discord-poster.js';
import { postOrEditLifecycleEmbed } from '../lifecycle-poster.js';
import { parsePositiveInteger, seerrPayloadSchema } from './schemas.js';

function firstDiscordId(value: string | string[] | undefined): string | undefined {
  const candidates = Array.isArray(value) ? value : value?.split(',');
  return candidates?.map((id) => id.trim()).find((id) => /^\d{17,20}$/.test(id));
}

function updateRequestStatus(requestId: number, status: SeerrRequestStatus): void {
  if (!requestId) return;
  db.update(seerrRequests)
    .set({ status, updatedAt: new Date() })
    .where(eq(seerrRequests.seerrRequestId, requestId))
    .run();
}

async function updateLifecycleCard(args: {
  requestId: number;
  status: SeerrRequestStatus;
  embed: ReturnType<typeof buildSeerrRequestEmbed>;
  eventType: string;
  payload: unknown;
  request: {
    mediaType: 'movie' | 'tv';
    tmdbId: number | undefined;
    title: string;
    requestedBy: string | undefined;
  };
}): Promise<void> {
  const { requestId, status, embed, eventType, payload, request } = args;
  updateRequestStatus(requestId, status);
  await disableSeerrPendingButtons(requestId);

  const row = requestId
    ? db.select().from(seerrRequests).where(eq(seerrRequests.seerrRequestId, requestId)).get()
    : undefined;
  if (row?.lifecycleChannelId && row.lifecycleMessageId) {
    const edited = await editEmbed({
      channelId: row.lifecycleChannelId,
      messageId: row.lifecycleMessageId,
      embed,
      source: 'seerr',
      eventType,
      payload,
    });
    if (edited) return;
  }

  const message = await postEmbed({
    channelId: getChannel('requests'),
    embed,
    source: 'seerr',
    eventType,
    payload,
  });
  if (message && requestId) {
    db.insert(seerrRequests)
      .values({
        seerrRequestId: requestId,
        messageId: message.id,
        channelId: message.channelId,
        mediaType: request.mediaType,
        tmdbId: request.tmdbId,
        title: request.title,
        requestedBy: request.requestedBy,
        status,
        lifecycleChannelId: message.channelId,
        lifecycleMessageId: message.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: seerrRequests.seerrRequestId,
        set: {
          status,
          lifecycleChannelId: message.channelId,
          lifecycleMessageId: message.id,
          updatedAt: new Date(),
        },
      })
      .run();
  }
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

  const requestId = parsePositiveInteger(body.request?.request_id) ?? 0;
  if (body.notification_type === 'MEDIA_PENDING' && !requestId) {
    logger.warn('seerr pending request is missing a valid request id');
    return c.json({ ok: false, error: 'invalid request id' }, 400);
  }
  const mediaType = body.media?.media_type ?? 'movie';
  const title = body.subject ?? 'Unknown request';
  const tmdbId = parsePositiveInteger(body.media?.tmdbId);
  const yearMatch = title.match(/\((\d{4})\)/);
  const year = yearMatch?.[1];
  const plainTitle = title.replace(/\s*\(\d{4}\)\s*$/, '');
  const requestRecord = {
    mediaType,
    tmdbId,
    title: plainTitle,
    requestedBy: body.request?.requestedBy_username,
  };

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
        posterUrl,
        requestedBy: body.request?.requestedBy_username,
        status: 'pending',
      });
      const buttons = buildSeerrApprovalButtons(requestId);
      const approvalsChannel = getChannel('approvals') ?? getChannel('requests');
      const requestsChannel = getChannel('requests');
      const approvalMessage = await postEmbed({
        channelId: approvalsChannel,
        embed,
        components: [buttons],
        source: 'seerr',
        eventType: body.notification_type,
        payload: body,
      });
      let lifecycleMessage = approvalMessage;
      if (requestsChannel && requestsChannel !== approvalsChannel) {
        lifecycleMessage = await postEmbed({
          channelId: requestsChannel,
          embed: buildSeerrRequestEmbed({
            requestId,
            mediaType,
            title: plainTitle,
            year,
            overview: body.message,
            posterUrl,
            requestedBy: body.request?.requestedBy_username,
            status: 'pending',
          }),
          source: 'seerr',
          eventType: `${body.notification_type}_LIFECYCLE`,
          payload: body,
        });
      }
      const trackedMessage = approvalMessage ?? lifecycleMessage;
      if (trackedMessage && requestId) {
        db.insert(seerrRequests)
          .values({
            seerrRequestId: requestId,
            messageId: trackedMessage.id,
            channelId: trackedMessage.channelId,
            mediaType,
            tmdbId,
            title: plainTitle,
            status: 'pending',
            requestedBy: body.request?.requestedBy_username,
            lifecycleMessageId: lifecycleMessage?.id,
            lifecycleChannelId: lifecycleMessage?.channelId,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: seerrRequests.seerrRequestId,
            set: {
              messageId: trackedMessage.id,
              channelId: trackedMessage.channelId,
              lifecycleMessageId: lifecycleMessage?.id,
              lifecycleChannelId: lifecycleMessage?.channelId,
              status: 'pending',
              updatedAt: new Date(),
            },
          })
          .run();
      }
      break;
    }
    case 'MEDIA_APPROVED':
    case 'MEDIA_AUTO_APPROVED': {
      await updateLifecycleCard({
        requestId,
        status: 'approved',
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
        eventType: body.notification_type,
        payload: body,
        request: requestRecord,
      });
      break;
    }
    case 'MEDIA_DECLINED': {
      await updateLifecycleCard({
        requestId,
        status: 'declined',
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
        eventType: body.notification_type,
        payload: body,
        request: requestRecord,
      });
      break;
    }
    case 'MEDIA_AVAILABLE': {
      await updateLifecycleCard({
        requestId,
        status: 'available',
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
        eventType: body.notification_type,
        payload: body,
        request: requestRecord,
      });
      break;
    }
    case 'MEDIA_FAILED': {
      await updateLifecycleCard({
        requestId,
        status: 'failed',
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
        eventType: body.notification_type,
        payload: body,
        request: requestRecord,
      });
      break;
    }
    case 'MEDIA_DELETED': {
      await updateLifecycleCard({
        requestId,
        status: 'deleted',
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
        eventType: body.notification_type,
        payload: body,
        request: requestRecord,
      });
      break;
    }
    case 'ISSUE_CREATED':
    case 'ISSUE_COMMENT':
    case 'ISSUE_REOPENED':
    case 'ISSUE_RESOLVED': {
      const issueId = parsePositiveInteger(body.issue?.issue_id);
      const issueMessage = body.comment?.comment_message ?? body.message;
      const issueEmbed = buildSeerrIssueEmbed({
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
        reporterDiscordId: firstDiscordId(
          body.issue?.reportedBy_settings_discordIds ?? body.issue?.reportedBy_settings_discordId,
        ),
        commenterDiscordId: firstDiscordId(
          body.comment?.commentedBy_settings_discordIds ?? body.comment?.commentedBy_settings_discordId,
        ),
      });
      const common = {
        channelId: getChannel('failures'),
        embed: issueEmbed,
        source: 'seerr',
        eventType: body.notification_type,
        payload: body,
      };
      if (issueId) {
        await postOrEditLifecycleEmbed({
          ...common,
          lifecycleKey: `seerr:issue:${issueId}`,
          state: body.notification_type,
        });
      } else {
        await postEmbed(common);
      }
      break;
    }
    default:
      logger.debug({ type: body.notification_type }, 'seerr event ignored');
  }

  return c.json({ ok: true });
});
