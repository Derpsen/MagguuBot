import { db } from '../../db/client.js';
import { sessionRevocations } from '../../db/schema.js';
import { RevocationCache } from './revocation-cache.js';

const CACHE_TTL_MS = 30_000;
const cache = new RevocationCache(CACHE_TTL_MS);

function loadRevocations() {
  return db.select().from(sessionRevocations).all();
}

export function isSessionRevoked(userId: string, issuedAt: number): boolean {
  return cache.isRevoked(userId, issuedAt, loadRevocations);
}

export function revokeUserSessions(userId: string): void {
  const now = new Date();
  db.insert(sessionRevocations)
    .values({ userId, notValidBefore: now })
    .onConflictDoUpdate({ target: sessionRevocations.userId, set: { notValidBefore: now } })
    .run();
  cache.record(userId, now, loadRevocations);
}
