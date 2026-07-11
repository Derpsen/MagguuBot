import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { readResponseBytesLimited } from '../utils/http-body.js';
import { safeFetch } from '../utils/safe-fetch.js';

export interface RssItem {
  guid: string;
  title: string;
  link?: string;
  description?: string;
  author?: string;
  pubDate?: Date;
  categories?: string[];
}

interface RssRawItem {
  guid?: string | { '#text': string; '@_isPermaLink'?: string };
  title?: string;
  link?: string;
  description?: string;
  'dc:creator'?: string;
  author?: string;
  pubDate?: string;
  category?: string | string[];
}

interface RssChannel {
  item?: RssRawItem | RssRawItem[];
}

interface RssRoot {
  rss?: { channel?: RssChannel };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
});

const DEFAULT_TIMEOUT_MS = 10_000;
export const RSS_MAX_BODY_BYTES = 5 * 1024 * 1024;

export type RssFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchRss(url: string, fetcher: RssFetcher = safeFetch): Promise<RssItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetcher(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MagguuBot/1.0 (+https://github.com/magguu)',
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`RSS fetch returned HTTP ${res.status}`);
    }
    const bytes = await readResponseBytesLimited(res, RSS_MAX_BODY_BYTES);
    const xml = new TextDecoder().decode(bytes);
    return parseRss(xml);
  } finally {
    clearTimeout(timer);
  }
}

export function parseRss(xml: string): RssItem[] {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error(`invalid RSS XML: ${validation.err.msg}`);
  }
  const parsed = parser.parse(xml) as RssRoot;
  const raw = parsed.rss?.channel?.item;
  if (!raw) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  return items.map(normalizeItem).filter((i): i is RssItem => Boolean(i));
}

function normalizeItem(raw: RssRawItem): RssItem | null {
  const title = typeof raw.title === 'string' ? raw.title : '';
  const guid = extractGuid(raw) ?? raw.link ?? title;
  if (!guid) return null;
  const pubDate = raw.pubDate ? safeDate(raw.pubDate) : undefined;
  const author = raw['dc:creator'] ?? raw.author;
  const categories = Array.isArray(raw.category)
    ? raw.category.filter((c): c is string => typeof c === 'string')
    : typeof raw.category === 'string'
      ? [raw.category]
      : undefined;
  return {
    guid,
    title,
    link: raw.link,
    description: raw.description,
    author,
    pubDate,
    categories,
  };
}

function extractGuid(raw: RssRawItem): string | undefined {
  if (typeof raw.guid === 'string') return raw.guid;
  if (raw.guid && typeof raw.guid === 'object') return raw.guid['#text'];
  return undefined;
}

function safeDate(s: string): Date | undefined {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
