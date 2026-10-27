import type { RestLike } from './execute.js';

/**
 * Read-only inventory helpers for `discord-rollout --delete-archived --count-messages`.
 * Only GET /channels/{id}/messages is used (no write, no delete). Counting is bounded: at most
 * `MAX_PAGES` pages of 100, so a channel with more messages is reported as "500+" instead of walking it all.
 */
const DISCORD_EPOCH_MS = 1_420_070_400_000n;
export const INVENTORY_PAGE_SIZE = 100;
export const INVENTORY_MAX_PAGES = 5;

export interface ChannelInventory {
  /** Messages counted (bounded by the page cap), null when the channel could not be read. */
  messages: number | null;
  /** true when the cap was hit, i.e. the real number is at least `messages`. */
  capped: boolean;
  /** Date of the newest message (from its snowflake), null for an empty/unreadable channel. */
  newestAt: string | null;
  /** Discord error status when the read failed (403 = no access), else null. */
  errorStatus: number | null;
}

/** Date of a Discord snowflake as ISO string, null when it is not a snowflake. */
export function snowflakeDate(id: string): string | null {
  if (!/^\d{17,20}$/.test(id)) return null;
  return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH_MS)).toISOString();
}

export async function inventoryChannel(rest: RestLike, channelId: string): Promise<ChannelInventory> {
  let count = 0;
  let before: string | undefined;
  let newest: string | null = null;
  try {
    for (let page = 0; page < INVENTORY_MAX_PAGES; page++) {
      const q = `limit=${INVENTORY_PAGE_SIZE}${before ? `&before=${before}` : ''}`;
      const batch = (await rest.request<Array<{ id: string }>>('GET', `/channels/${channelId}/messages?${q}`)) ?? [];
      if (batch.length === 0) break;
      if (!newest) newest = batch[0]!.id;
      count += batch.length;
      before = batch[batch.length - 1]!.id;
      if (batch.length < INVENTORY_PAGE_SIZE) return { messages: count, capped: false, newestAt: snowflakeDate(newest), errorStatus: null };
    }
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    return { messages: null, capped: false, newestAt: null, errorStatus: typeof status === 'number' ? status : 0 };
  }
  const capped = count >= INVENTORY_PAGE_SIZE * INVENTORY_MAX_PAGES;
  return { messages: count, capped, newestAt: newest ? snowflakeDate(newest) : null, errorStatus: null };
}

/** " · Nachrichten: 37 · letzte 2026-05-01" / "500+" / "unbekannt (HTTP 403)". */
export function describeInventory(inv: ChannelInventory): string {
  if (inv.messages === null) return ` · Nachrichten: unbekannt${inv.errorStatus ? ` (HTTP ${inv.errorStatus})` : ''}`;
  const n = inv.capped ? `${inv.messages}+` : String(inv.messages);
  return ` · Nachrichten: ${n}${inv.newestAt ? ` · letzte ${inv.newestAt.slice(0, 10)}` : ''}`;
}
