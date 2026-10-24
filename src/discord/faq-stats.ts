import { and, gte, lt, lte, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { faqUsageDaily } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { localScheduleParts } from '../utils/schedule.js';
import { summarizeFaqUsage, type FaqUsageRow, type FaqUsageSourceKey, type FaqStatusBlock } from '../utils/faq-top.js';

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


/** Counters are kept this many local days, then deleted (the weekly embed and the status block need 7). */
export const FAQ_USAGE_RETENTION_DAYS = 90;

function shiftDay(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + delta)).toISOString().slice(0, 10);
}

/** Deletes counter rows older than the retention window; returns the number of removed rows. Never throws. */
export function pruneFaqUsage(now: Date = new Date(), keepDays: number = FAQ_USAGE_RETENTION_DAYS): number {
  try {
    const cutoff = shiftDay(faqUsageDay(now), -keepDays);
    return Number(db.delete(faqUsageDaily).where(lt(faqUsageDaily.day, cutoff)).run().changes);
  } catch (err) {
    logger.warn({ err }, 'faq usage prune failed');
    return 0;
  }
}

/** Last 7 local days (today included), for the authenticated status JSON: counts only. */
export const FAQ_STATUS_WINDOW_DAYS = 7;

export function faqStatusBlock(
  entries: readonly { id: number; question: string }[],
  now: Date = new Date(),
  rows: (from: string, to: string) => FaqUsageRow[] = faqUsageBetween,
): FaqStatusBlock {
  const today = faqUsageDay(now);
  const summary = summarizeFaqUsage(rows(shiftDay(today, -(FAQ_STATUS_WINDOW_DAYS - 1)), today));
  const titles = new Map(entries.map((e) => [e.id, e.question]));
  return {
    windowDays: FAQ_STATUS_WINDOW_DAYS,
    total: summary.total,
    bySource: summary.bySource,
    top: summary.ranked.slice(0, 5).map((e) => {
      const title = titles.get(e.faqId);
      return { id: e.faqId, title: title ? title.replace(/\s+/g, ' ').trim().slice(0, 80) : null, count: e.uses };
    }),
  };
}
