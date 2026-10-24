import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { serverHealthCommand, serverHealthWeek } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import {
  ActiveUserCounter,
  SERVER_HEALTH_TOP_COMMANDS,
  healthWeekKey,
  sanitizeCommandName,
  type ServerHealthStats,
} from '../utils/server-health.js';

/**
 * Anonymous weekly counters for the server health card. Persisted: the week, a plain number of active users and a
 * counter per command name. Never persisted or logged: user ids, hashes, the hashing key (see utils/server-health.ts).
 */

export function currentHealthWeek(now: Date = new Date()): string {
  return healthWeekKey(now, config.TIME_ZONE);
}

/** Rollover: only the current week's rows survive. */
function purgeOtherWeeks(week: string): void {
  try {
    db.delete(serverHealthWeek).where(ne(serverHealthWeek.week, week)).run();
    db.delete(serverHealthCommand).where(ne(serverHealthCommand.week, week)).run();
  } catch (err) {
    logger.warn({ err }, 'server health weekly purge failed');
  }
}

export function createActiveUserCounter(): ActiveUserCounter {
  return new ActiveUserCounter({
    loadBase: (week) => {
      try {
        return db.select().from(serverHealthWeek).where(eq(serverHealthWeek.week, week)).get()?.activeCount ?? 0;
      } catch {
        return 0;
      }
    },
    saveCount: (week, count) => {
      try {
        const values = { week, activeCount: count, updatedAt: new Date() };
        db.insert(serverHealthWeek).values(values).onConflictDoUpdate({ target: serverHealthWeek.week, set: values }).run();
      } catch (err) {
        logger.debug({ err }, 'server health active counter save failed');
      }
    },
    onWeek: purgeOtherWeeks,
  });
}

let counter: ActiveUserCounter | null = null;

function activeCounter(): ActiveUserCounter {
  counter ??= createActiveUserCounter();
  return counter;
}

/** Test seam: replaces (or with `null` resets) the process-wide counter. */
export function setActiveUserCounterForTests(replacement: ActiveUserCounter | null): void {
  counter = replacement;
}

/** Counts a human guild user as active this week. Never throws, never stores the id. */
export function recordActiveUser(userId: string, now: Date = new Date()): void {
  try {
    activeCounter().record(userId, currentHealthWeek(now));
  } catch (err) {
    logger.debug({ err }, 'server health active user count failed');
  }
}

/** Counts one use of a registered slash command (name only). Never throws. */
export function recordCommandUse(commandName: string, now: Date = new Date()): void {
  const name = sanitizeCommandName(commandName);
  if (!name) return;
  try {
    const week = currentHealthWeek(now);
    activeCounter().count(week); // makes sure a new week has rolled (purge) before the first write
    db.insert(serverHealthCommand)
      .values({ week, command: name, count: 1 })
      .onConflictDoUpdate({
        target: [serverHealthCommand.week, serverHealthCommand.command],
        set: { count: sql`${serverHealthCommand.count} + 1` },
      })
      .run();
  } catch (err) {
    logger.debug({ err }, 'server health command count failed');
  }
}

export function loadServerHealthStats(members: number | null, now: Date = new Date()): ServerHealthStats {
  const week = currentHealthWeek(now);
  const activeUsers = activeCounter().count(week);
  const rows = db
    .select({ command: serverHealthCommand.command, count: serverHealthCommand.count })
    .from(serverHealthCommand)
    .where(and(eq(serverHealthCommand.week, week)))
    .orderBy(desc(serverHealthCommand.count), serverHealthCommand.command)
    .all();
  return {
    members,
    activeUsers,
    commandsTotal: rows.reduce((sum, r) => sum + r.count, 0),
    topCommands: rows.slice(0, SERVER_HEALTH_TOP_COMMANDS).map((r) => ({ name: r.command, count: r.count })),
    weekStart: week,
  };
}
