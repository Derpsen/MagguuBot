import { EmbedBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { rssFeeds, type RssFeed } from '../db/schema.js';
import { Colors, truncate } from '../embeds/colors.js';
import { postEmbed } from '../server/discord-poster.js';
import { fetchRss, type RssItem } from '../services/rss.js';
import { logger } from '../utils/logger.js';

const MAX_SEEN = 200;
const MAX_POST_PER_RUN = 5;

export async function runRssFeedTick(): Promise<void> {
  const feeds = db
    .select()
    .from(rssFeeds)
    .where(eq(rssFeeds.guildId, config.DISCORD_GUILD_ID))
    .all();

  for (const feed of feeds) {
    if (!feed.enabled) continue;
    try {
      await processFeed(feed);
      if (feed.lastError) {
        // recovered — clear error fields
        db.update(rssFeeds)
          .set({ lastError: null, lastErrorAt: null })
          .where(eq(rssFeeds.id, feed.id))
          .run();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.update(rssFeeds)
        .set({ lastError: message.slice(0, 500), lastErrorAt: new Date() })
        .where(eq(rssFeeds.id, feed.id))
        .run();
      logger.warn({ err, feedId: feed.id, name: feed.name }, 'rss feed tick failed');
    }
  }
}

async function processFeed(feed: RssFeed): Promise<void> {
  const all = await fetchRss(feed.url);
  if (all.length === 0) return;

  const excludeKeywords = parseKeywords(feed.excludeKeywords);
  const relevant = all.filter((item) => !matchesAnyKeyword(item, excludeKeywords));

  const seen = loadSeen(feed.seenGuids);

  if (seen.size === 0) {
    const bootstrap = new Set(all.map((i) => i.guid).slice(0, MAX_SEEN));
    persistSeen(feed.id, bootstrap);
    logger.info({ feedId: feed.id, name: feed.name, count: all.length }, 'rss feed bootstrapped');
    return;
  }

  const fresh: RssItem[] = [];
  const postedTitles = new Set<string>();
  for (const item of [...relevant].reverse()) {
    if (seen.has(item.guid)) continue;
    const normTitle = normalizeTitle(item.title);
    if (normTitle && (seen.has(`title:${normTitle}`) || postedTitles.has(normTitle))) continue;
    fresh.push(item);
    if (normTitle) postedTitles.add(normTitle);
    if (fresh.length >= MAX_POST_PER_RUN) break;
  }

  for (const item of fresh) {
    await postFeedItem(feed, item);
    seen.add(item.guid);
    const normTitle = normalizeTitle(item.title);
    if (normTitle) seen.add(`title:${normTitle}`);
  }

  persistSeen(feed.id, trimSeen(seen));
  db.update(rssFeeds).set({ lastRunAt: new Date() }).where(eq(rssFeeds.id, feed.id)).run();
}

async function postFeedItem(feed: RssFeed, item: RssItem): Promise<void> {
  const description = stripHtml(item.description ?? '');
  const embed = new EmbedBuilder()
    .setColor(Colors.info)
    .setAuthor({ name: `RSS · ${feed.name}` })
    .setTitle(`📰  ${truncate(item.title, 240)}`)
    .setTimestamp(item.pubDate ?? new Date());
  if (item.link) embed.setURL(item.link);
  if (description) embed.setDescription(truncate(description, 2000));
  if (item.author) embed.setFooter({ text: `MagguuBot  ·  ${item.author}` });
  else embed.setFooter({ text: `MagguuBot  ·  ${feed.name}` });

  await postEmbed({
    channelId: feed.channelId,
    embed,
    source: 'rss-feed',
    eventType: `feed-${feed.id}`,
    payload: { feedId: feed.id, guid: item.guid, title: item.title, link: item.link },
  });
}

function parseKeywords(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase());
  } catch {
    /* fall through to CSV split */
  }
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function matchesAnyKeyword(item: RssItem, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const haystacks: string[] = [];
  if (item.categories) haystacks.push(...item.categories);
  if (item.title) haystacks.push(item.title);
  if (item.description) haystacks.push(item.description.slice(0, 500));
  const joined = haystacks.join(' ').toLowerCase();
  return keywords.some((k) => joined.includes(k));
}

function loadSeen(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    /* empty */
  }
  return new Set();
}

function persistSeen(feedId: number, seen: Set<string>): void {
  db.update(rssFeeds).set({ seenGuids: JSON.stringify(Array.from(seen)) }).where(eq(rssFeeds.id, feedId)).run();
}

function trimSeen(seen: Set<string>): Set<string> {
  if (seen.size <= MAX_SEEN) return seen;
  return new Set(Array.from(seen).slice(-MAX_SEEN));
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^\[(eu|us|kr|tw|cn)\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
