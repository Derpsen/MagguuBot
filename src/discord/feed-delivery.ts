export interface FeedItemIdentity {
  guid: string;
  title: string;
}

export function wasEmbedDelivered<T>(posted: T | null): posted is T {
  return posted !== null;
}

export function normalizeFeedTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^\[(eu|us|kr|tw|cn)\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function rememberDeliveredFeedItem(
  seen: Set<string>,
  item: FeedItemIdentity,
  delivered: boolean,
): boolean {
  if (!delivered) return false;

  seen.add(item.guid);
  const normalizedTitle = normalizeFeedTitle(item.title);
  if (normalizedTitle) seen.add(`title:${normalizedTitle}`);
  return true;
}
