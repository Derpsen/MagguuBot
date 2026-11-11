import type { Context } from 'hono';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { webhookEvents } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import { recordAdminAudit } from '../auth/audit.js';
import { attemptWebhookEvent, recordFailedWebhookAttempt } from '../webhook-retry.js';
import { isReplayableWebhookSource, webhookReplayBlockReason } from '../webhook-sources.js';
import { parseWebhookClearScope } from './webhook-clear-scope.js';
import { parsePositiveId } from './validation.js';

export const getWebhooks = (c: Context<any, '/webhooks'>) => {
  const rows = db
    .select()
    .from(webhookEvents)
    .orderBy(desc(webhookEvents.createdAt))
    .limit(100)
    .all();
  return c.json(
    rows.map((r) => ({
      id: r.id,
      source: r.source,
      replayable: isReplayableWebhookSource(r.source),
      eventType: r.eventType,
      status: r.status,
      error: r.error,
      channelId: r.channelId,
      retryCount: r.retryCount,
      retryState: r.retryState,
      nextRetryAt: r.nextRetryAt?.toISOString() ?? null,
      replayOfEventId: r.replayOfEventId,
      createdAt: r.createdAt.toISOString(),
    })),
  );
};

interface WebhookHealthRow {
  source: string;
  total: number;
  posted: number;
  failed: number;
  skipped: number;
  last_event_at: number | null;
  last_error_at: number | null;
  last_error: string | null;
}

export const getWebhooksHealth = (c: Context<any, '/webhooks/health'>) => {
  const since = Math.floor(Date.now()) - 24 * 60 * 60 * 1000;
  const rows = db.all(sql<WebhookHealthRow>`
    SELECT
      source,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) AS posted,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
      MAX(created_at) AS last_event_at,
      MAX(CASE WHEN status = 'failed' THEN created_at END) AS last_error_at,
      (
        SELECT error FROM webhook_events e2
        WHERE e2.source = webhook_events.source
          AND e2.status = 'failed'
        ORDER BY e2.created_at DESC
        LIMIT 1
      ) AS last_error
    FROM webhook_events
    WHERE created_at >= ${since}
    GROUP BY source
    ORDER BY total DESC
  `) as WebhookHealthRow[];

  return c.json({
    sinceIso: new Date(since).toISOString(),
    sources: rows.map((r) => ({
      source: r.source,
      total: Number(r.total),
      posted: Number(r.posted),
      failed: Number(r.failed),
      skipped: Number(r.skipped),
      lastEventAt: r.last_event_at ? new Date(Number(r.last_event_at)).toISOString() : null,
      lastErrorAt: r.last_error_at ? new Date(Number(r.last_error_at)).toISOString() : null,
      lastError: r.last_error,
    })),
  });
};

export const postWebhooksIdReplay = async (c: Context<any, '/webhooks/:id/replay'>) => {
  const id = parsePositiveId(c.req.param('id'));
  if (id === null) return c.json({ ok: false, error: 'bad id' }, 400);
  const event = db.select().from(webhookEvents).where(eq(webhookEvents.id, id)).get();
  if (!event) return c.json({ ok: false, error: 'event not found' }, 404);
  const replayBlockReason = webhookReplayBlockReason(event.source, event.status);
  if (replayBlockReason === 'unsupported-source') {
    return c.json({ ok: false, error: `source ${event.source} does not support replay` }, 422);
  }
  if (replayBlockReason === 'already-posted') {
    return c.json({ ok: false, error: 'successfully posted events cannot be replayed' }, 409);
  }
  try {
    const retry = await attemptWebhookEvent(event);
    const response = retry.response;
    const result = await response.json().catch(() => null) as unknown;
    recordAdminAudit(c, {
      action: 'webhook.replay',
      target: String(id),
      detail: { source: event.source, eventType: event.eventType, status: response.status },
    });
    if (!response.ok) {
      return c.json({ ok: false, error: 'replay rejected', status: response.status, result }, 502);
    }
    if (!retry.success) {
      return c.json({ ok: false, error: 'replay did not produce a successful delivery', generatedStatuses: retry.generatedStatuses }, 502);
    }
    return c.json({ ok: retry.success, status: response.status, result, generatedStatuses: retry.generatedStatuses });
  } catch (err) {
    try {
      recordFailedWebhookAttempt(event);
    } catch (stateErr) {
      logger.error({ err: stateErr, eventId: id }, 'failed to record manual webhook replay failure');
    }
    logger.warn({ err, eventId: id, source: event.source }, 'webhook replay failed');
    return c.json({ ok: false, error: err instanceof Error ? err.message : 'replay failed' }, 422);
  }
};

export const deleteWebhooks = (c: Context<any, '/webhooks'>) => {
  const scope = parseWebhookClearScope(c.req.query('scope'));
  if (scope === null) return c.json({ ok: false, error: 'invalid scope' }, 400);
  let result: { changes: number };
  if (scope === 'failed') {
    result = db.delete(webhookEvents).where(eq(webhookEvents.status, 'failed')).run();
  } else if (scope === 'skipped') {
    result = db.delete(webhookEvents).where(eq(webhookEvents.status, 'skipped')).run();
  } else {
    result = db.delete(webhookEvents).run();
  }
  logger.info({ scope, deleted: result.changes }, 'webhook events cleared via dashboard');
  recordAdminAudit(c, { action: 'webhook_events.clear', target: scope, detail: { deleted: result.changes } });
  return c.json({ ok: true, deleted: result.changes });
};
