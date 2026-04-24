import { XMLParser } from 'fast-xml-parser';
import { lookup } from 'node:dns/promises';
import { logger } from '../utils/logger.js';

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

function isPrivateIp(ip: string): boolean {
  // IPv4 private ranges + loopback
  const v4 = /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  if (v4) return true;
  // IPv6 loopback, unique-local (fc00::/7), link-local (fe80::/10)
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
  return false;
}

async function assertSafeUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`blocked protocol: ${parsed.protocol}`);
  }
  const hostname = parsed.hostname;
  // Reject bare IPs that are already in private ranges
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) {
    if (isPrivateIp(hostname)) throw new Error(`blocked private IP: ${hostname}`);
    return;
  }
  const result = await lookup(hostname, { all: true }).catch(() => {
    throw new Error(`DNS lookup failed: ${hostname}`);
  });
  for (const { address } of result) {
    if (isPrivateIp(address)) throw new Error(`blocked: ${hostname} resolves to private IP ${address}`);
  }
}

export async function fetchRss(url: string): Promise<RssItem[]> {
  try {
    await assertSafeUrl(url);
  } catch (err) {
    logger.warn({ url, err }, 'rss fetch blocked by SSRF guard');
    return [];
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MagguuBot/1.0 (+https://github.com/magguu)',
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
    });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, 'rss fetch failed');
      return [];
    }
    const xml = await res.text();
    return parseRss(xml);
  } catch (err) {
    logger.warn({ url, err }, 'rss fetch error');
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function parseRss(xml: string): RssItem[] {
  try {
    const parsed = parser.parse(xml) as RssRoot;
    const raw = parsed.rss?.channel?.item;
    if (!raw) return [];
    const items = Array.isArray(raw) ? raw : [raw];
    return items.map(normalizeItem).filter((i): i is RssItem => Boolean(i));
  } catch (err) {
    logger.warn({ err }, 'rss parse error');
    return [];
  }
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
