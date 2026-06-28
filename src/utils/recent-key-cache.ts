interface RecentKeyCacheOptions {
  maxEntries: number;
  ttlMs: number;
  now?: () => number;
}

export interface RecentKeyCache {
  remember(key: string): boolean;
}

export function createRecentKeyCache(options: RecentKeyCacheOptions): RecentKeyCache {
  const seen = new Map<string, number>();
  const getNow = options.now ?? Date.now;

  return {
    remember(key: string): boolean {
      const now = getNow();

      for (const [storedKey, storedAt] of seen) {
        if (now - storedAt > options.ttlMs) seen.delete(storedKey);
        else break;
      }

      if (seen.has(key)) return false;

      if (seen.size >= options.maxEntries) {
        const oldest = seen.keys().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }

      seen.set(key, now);
      return true;
    },
  };
}
