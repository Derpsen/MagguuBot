import { isNull, max } from 'drizzle-orm';
import { db } from '../db/client.js';
import { webhookEvents } from '../db/schema.js';
import { getCachedFaqEntries } from '../discord/faq-autoanswer.js';
import { faqStatusBlock } from '../discord/faq-stats.js';
import { currentUnseenReport } from '../services/unseen-report.js';
import { clipUnseenBlock } from '../utils/unseen-report.js';
import { readBuildInfo, type BuildInfo } from '../embeds/status.js';
export { buildStatusSnapshot } from '../embeds/status.js';

// webhook_events already logs every inbound webhook (append-only, never auto-pruned),
// so the last-received time is a MAX() over it instead of a second store. Replay rows
// are excluded because they are not new deliveries from the source.
export function lastWebhookBySource(): Map<string, Date> {
  const rows = db
    .select({ source: webhookEvents.source, last: max(webhookEvents.createdAt) })
    .from(webhookEvents)
    .where(isNull(webhookEvents.replayOfEventId))
    .groupBy(webhookEvents.source)
    .all();
  const out = new Map<string, Date>();
  for (const row of rows) {
    if (row.last instanceof Date) out.set(row.source, row.last);
    else if (typeof row.last === 'number') out.set(row.source, new Date(row.last));
  }
  return out;
}

export function currentBuildInfo(): BuildInfo {
  return readBuildInfo();
}

/** FAQ usage of the last 7 days from the local counters (titles from the in-memory FAQ cache, no network); null on error. */
export function currentFaqStatus(now: Date = new Date()) {
  try {
    return faqStatusBlock(getCachedFaqEntries(), now);
  } catch {
    return null;
  }
}

/** Cached unseen-media report (no network, no Tautulli call per request); null when off or not computed yet. */
export function currentUnseenStatus() {
  try {
    const block = currentUnseenReport();
    return block ? clipUnseenBlock(block) : null;
  } catch {
    return null;
  }
}
