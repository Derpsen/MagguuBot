import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { webhookEvents } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { webhookRetryDelayMs } from '../utils/retry.js';
import { replayWebhook } from './webhook-replay.js';
import { webhookRetryState } from './webhook-retry-policy.js';
import { REPLAYABLE_WEBHOOK_SOURCES } from './webhook-sources.js';

export type WebhookEventRow = typeof webhookEvents.$inferSelect;

export interface WebhookRetryResult {
  response: Response;
  success: boolean;
  generatedStatuses: Array<'posted' | 'failed' | 'skipped'>;
}

export function recordFailedWebhookAttempt(
  event: WebhookEventRow,
  now = new Date(),
): { retryCount: number; retryState: 'pending' | 'exhausted' } {
  const retryCount = event.retryCount + 1;
  const retryState = webhookRetryState(
    event.status,
    false,
    retryCount,
    config.WEBHOOK_RETRY_MAX_ATTEMPTS,
  );
  if (retryState === 'resolved') throw new Error('failed webhook attempt cannot resolve');
  db.update(webhookEvents)
    .set({
      retryCount,
      retryState,
      nextRetryAt: retryState === 'pending' ? new Date(now.getTime() + webhookRetryDelayMs(retryCount)) : null,
    })
    .where(eq(webhookEvents.id, event.id))
    .run();
  return { retryCount, retryState };
}

export async function attemptWebhookEvent(event: WebhookEventRow, now = new Date()): Promise<WebhookRetryResult> {
  const baseline = db.select({ id: sql<number>`coalesce(max(${webhookEvents.id}), 0)` }).from(webhookEvents).get()?.id ?? 0;
  const response = await replayWebhook(event.source, event.eventType, event.payload, event.id);
  const generated = db
    .select({ status: webhookEvents.status })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.replayOfEventId, event.id), gt(webhookEvents.id, baseline)))
    .all();
  const generatedStatuses = generated.map((row) => row.status);
  const success = response.ok && generatedStatuses.length > 0 && generatedStatuses.every((status) => status === 'posted');
  const retryCount = event.retryCount + 1;
  const retryState = webhookRetryState(
    event.status,
    success,
    retryCount,
    config.WEBHOOK_RETRY_MAX_ATTEMPTS,
  );
  db.update(webhookEvents)
    .set({
      retryCount,
      retryState,
      nextRetryAt: retryState === 'pending' ? new Date(now.getTime() + webhookRetryDelayMs(retryCount)) : null,
    })
    .where(eq(webhookEvents.id, event.id))
    .run();
  return { response, success, generatedStatuses };
}

export async function runWebhookRetryTick(now = new Date()): Promise<void> {
  if (!config.WEBHOOK_RETRY_ENABLED) return;
  const due = db
    .select()
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.status, 'failed'),
        eq(webhookEvents.retryState, 'pending'),
        inArray(webhookEvents.source, REPLAYABLE_WEBHOOK_SOURCES),
        lte(webhookEvents.nextRetryAt, now),
      ),
    )
    .orderBy(asc(webhookEvents.nextRetryAt))
    .limit(10)
    .all();
  for (const event of due) {
    try {
      const result = await attemptWebhookEvent(event, now);
      logger.info(
        { eventId: event.id, attempt: event.retryCount + 1, success: result.success, statuses: result.generatedStatuses },
        'automatic webhook retry processed',
      );
    } catch (err) {
      const failure = recordFailedWebhookAttempt(event, now);
      logger.warn(
        { err, eventId: event.id, retryCount: failure.retryCount, retryState: failure.retryState },
        'automatic webhook retry failed',
      );
    }
  }
}
