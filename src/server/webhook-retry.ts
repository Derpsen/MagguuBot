import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { webhookEvents } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { webhookRetryDelayMs } from '../utils/retry.js';
import { replayWebhook } from './webhook-replay.js';

export type WebhookEventRow = typeof webhookEvents.$inferSelect;

export interface WebhookRetryResult {
  response: Response;
  success: boolean;
  generatedStatuses: Array<'posted' | 'failed' | 'skipped'>;
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
  const exhausted = !success && retryCount >= config.WEBHOOK_RETRY_MAX_ATTEMPTS;
  db.update(webhookEvents)
    .set({
      retryCount,
      retryState: success ? 'resolved' : exhausted ? 'exhausted' : 'pending',
      nextRetryAt: success || exhausted ? null : new Date(now.getTime() + webhookRetryDelayMs(retryCount)),
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
      const retryCount = event.retryCount + 1;
      const exhausted = retryCount >= config.WEBHOOK_RETRY_MAX_ATTEMPTS;
      db.update(webhookEvents)
        .set({
          retryCount,
          retryState: exhausted ? 'exhausted' : 'pending',
          nextRetryAt: exhausted ? null : new Date(now.getTime() + webhookRetryDelayMs(retryCount)),
        })
        .where(eq(webhookEvents.id, event.id))
        .run();
      logger.warn({ err, eventId: event.id, retryCount }, 'automatic webhook retry failed');
    }
  }
}
