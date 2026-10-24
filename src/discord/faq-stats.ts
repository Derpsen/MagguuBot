import { and, gte, lte, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { faqUsageDaily } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { localScheduleParts } from '../utils/schedule.js';
import type { FaqUsageRow, FaqUsageSourceKey } from '../utils/faq-top.js';

/**
 * Anonymous FAQ usage counters: one number per local day, FAQ entry id and source. Nothing about who asked, where,
 * or what was typed is stored.
 */

export function faqUsageDay(now: Date = new Date(), timeZone: string = config.TIME_ZONE): string {
  return localScheduleParts(now, timeZone).dateKey;
}

/** Counts one use. Never throws: statistics must not break /faq or the auto-answer. */
export function recordFaqUse(faqId: number, source: FaqUsageSourceKey, now: Date = new Date()): void {
  if (!Number.isInteger(faqId) || faqId < 0) return;
  try {
    db.insert(faqUsageDaily)
      .values({ day: faqUsageDay(now), faqId, source, count: 1 })
      .onConflictDoUpdate({
        target: [faqUsageDaily.day, faqUsageDaily.faqId, faqUsageDaily.source],
        set: { count: sql`${faqUsageDaily.count} + 1` },
      })
      .run();
  } catch (err) {
    logger.debug({ err }, 'faq usage counter failed');
  }
}

/** Counters of the inclusive local day range (YYYY-MM-DD), summed per entry and source. */
export function faqUsageBetween(fromDay: string, toDay: string): FaqUsageRow[] {
  return db
    .select({
      faqId: faqUsageDaily.faqId,
      source: faqUsageDaily.source,
      count: sql<number>`sum(${faqUsageDaily.count})`,
    })
    .from(faqUsageDaily)
    .where(and(gte(faqUsageDaily.day, fromDay), lte(faqUsageDaily.day, toDay)))
    .groupBy(faqUsageDaily.faqId, faqUsageDaily.source)
    .all()
    .map((r) => ({ faqId: r.faqId, source: r.source, count: Number(r.count) }));
}

