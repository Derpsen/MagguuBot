import { getChannel, type ChannelKey } from '../discord/channel-store.js';
import { buildBurstSummaryEmbed, type BurstItem, type BurstKind } from '../embeds/burst-summary.js';
import { BurstGate } from '../utils/burst-gate.js';
import { TtlKeys } from '../utils/import-dedupe.js';
import { logger } from '../utils/logger.js';
import { postEmbed } from './discord-poster.js';

/**
 * Flood protection for feed channels (staged re-imports, mass deletes):
 * deletes → 🩺・status always bundled (a single delete still gets its detail card),
 * grabs / imports / neu-auf-plex → first 5 per burst individually, the rest as one summary.
 * State is in-process; held items are flushed on shutdown.
 */
export interface FeedItem extends BurstItem {
  /** Posts the normal detail card. */
  post: () => Promise<void>;
}

const CHANNEL: Record<BurstKind, ChannelKey> = { deletes: 'health', imports: 'imports', grabs: 'grabs', newOnPlex: 'newOnPlex' };

export const BURST_SETTINGS = {
  quietMs: 2 * 60_000,
  maxHoldMs: 10 * 60_000,
  passThrough: { deletes: 0, imports: 5, grabs: 5, newOnPlex: 5 } as Record<BurstKind, number>,
  maxSummariesPerHour: 6,
  dedupeMs: 30 * 60_000,
};

function makeGate(kind: BurstKind): BurstGate<FeedItem> {
  return new BurstGate<FeedItem>({
    quietMs: BURST_SETTINGS.quietMs,
    maxHoldMs: BURST_SETTINGS.maxHoldMs,
    passThrough: BURST_SETTINGS.passThrough[kind],
    maxSummariesPerHour: BURST_SETTINGS.maxSummariesPerHour,
    deliver: (item) => item.post(),
    summarize: async (items) => {
      logger.info({ kind, count: items.length }, 'feed burst summarised');
      await postEmbed({
        channelId: getChannel(CHANNEL[kind]),
        embed: buildBurstSummaryEmbed(kind, items),
        source: 'feed-burst',
        eventType: `${kind}-summary`,
        payload: { kind, count: items.length, titles: [...new Set(items.map((i) => i.title))].slice(0, 50) },
      });
    },
  });
}

const gates: Record<BurstKind, BurstGate<FeedItem>> = {
  deletes: makeGate('deletes'),
  imports: makeGate('imports'),
  grabs: makeGate('grabs'),
  newOnPlex: makeGate('newOnPlex'),
};

/** Per-item keys already carded (episode/movie/release) — duplicates are dropped. */
export const seenFeedKeys = new TtlKeys(BURST_SETTINGS.dedupeMs);

/**
 * Submit a feed card. `keys` identify the item(s); when all were already posted within the
 * dedupe window the card is dropped. Returns what happened (for logs/tests).
 */
export async function submitFeed(kind: BurstKind, item: FeedItem, keys: readonly string[] = []): Promise<'duplicate' | 'delivered' | 'held'> {
  const scoped = keys.map((k) => `${kind}:${k}`);
  if (seenFeedKeys.allSeen(scoped)) {
    logger.debug({ kind, title: item.title }, 'duplicate feed card dropped');
    return 'duplicate';
  }
  seenFeedKeys.add(scoped);
  return gates[kind].submit(item);
}

/** Was a release/download already reported by Sonarr/Radarr (SAB double-report check)? */
export function importAlreadyReported(nameKeys: readonly string[]): boolean {
  return nameKeys.some((k) => seenFeedKeys.has(`imports:${k}`));
}

export async function flushFeedBursts(): Promise<void> {
  await Promise.all(Object.values(gates).map((g) => g.flush().catch(() => undefined)));
}
