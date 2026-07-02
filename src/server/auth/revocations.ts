import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { sessionRevocations } from '../../db/schema.js';

const cache = new Map<string, number>();
const CACHE_TTL_MS = 30_000;
let cacheStampedAt = 0;

function refreshCache(): void {
  const now = Date.now();
  if (now - cacheStampedAt < CACHE_TTL_MS) return;
  const rows = db.select().from(sessionRevocations).all();
  cache.clear();
  for (const row of rows) {
    cache.set(row.userId, row.notValidBefore.getTime());
  }
  cacheStampedAt = now;
}

export function isSessionRevoked(userId: string, issuedAt: number): boolean {
  refreshCache();
  const notBefore = cache.get(userId);
  if (notBefore === undefined) return false;
  return issuedAt <= notBefore;
}

export function revokeUserSessions(userId: string): void {
  const now = new Date();
  db.insert(sessionRevocations)
    .values({ userId, notValidBefore: now })
    .onConflictDoUpdate({ target: sessionRevocations.userId, set: { notValidBefore: now } })
    .run();
  cache.set(userId, now.getTime());
  cacheStampedAt = Date.now();
}
