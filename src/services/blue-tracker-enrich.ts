import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { logger } from '../utils/logger.js';

export interface EnrichedBluePost {
  body: string;
  author?: string;
  avatarUrl?: string;
  firstImage?: string;
  externalLink?: string;
}

const TIMEOUT_MS = 6_000;
const HOST = 'https://www.bluetracker.gg';

export async function enrichBluePost(url: string): Promise<EnrichedBluePost | null> {
  if (!url.startsWith(HOST)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MagguuBot/1.0 (+https://github.com/magguu)',
        Accept: 'text/html',
      },
    });
    if (!res.ok) {
      logger.debug({ url, status: res.status }, 'blue-tracker enrich: http error');
      return null;
    }
    const html = await res.text();
    return parseTopic(html);
  } catch (err) {
    logger.debug({ url, err }, 'blue-tracker enrich: fetch error');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function parseTopic(html: string): EnrichedBluePost | null {
  const $ = cheerio.load(html);
  const post = $('.blue-post').first();
  if (post.length === 0) return null;

  const author = post.find('author .is-size-5 a').first().text().trim() || undefined;
  const rawAvatar = post.find('author img.avatar').first().attr('src');
  const avatarUrl = rawAvatar ? absoluteUrl(rawAvatar) : undefined;
  const externalLink = post.find('.post-link a').first().attr('href') || undefined;

  const content = post.find('.post-content').first().clone();
  content.find('.post-number, .post-link, iframe, script, style').remove();

  const firstImage = content
    .find('img')
    .map((_, el) => $(el).attr('src'))
    .get()
    .map(absoluteUrl)
    .find((src): src is string => Boolean(src) && !src.includes('/static/images/'));

  content.find('aside, figure, .video-container, .video, .image').remove();

  const body = htmlToDiscordMarkdown($, content);
  if (!body) return null;

  return { body, author, avatarUrl, firstImage, externalLink };
}

function absoluteUrl(src: string | undefined): string {
  if (!src) return '';
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `${HOST}${src}`;
  return `${HOST}/${src}`;
}

function htmlToDiscordMarkdown($: cheerio.CheerioAPI, root: cheerio.Cheerio<Element>): string {
  const out: string[] = [];
  root.contents().each((_, node) => {
    out.push(renderNode($, node));
  });
  return collapseWhitespace(out.join(''));
}

function renderNode($: cheerio.CheerioAPI, node: AnyNode): string {
  if (node.type === 'text') {
    return (node.data ?? '').replace(/\s+/g, ' ');
  }
  if (node.type !== 'tag') return '';

  const el = $(node);
  const tag = node.name.toLowerCase();
  const inner = el
    .contents()
    .map((_, child) => renderNode($, child))
    .get()
    .join('');

  switch (tag) {
    case 'br':
      return '\n';
    case 'hr':
      return '\n---\n';
    case 'p':
    case 'div':
      return `${inner.trim()}\n\n`;
    case 'h1':
    case 'h2':
      return `\n**${stripInlineMd(inner)}**\n`;
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return `\n__${stripInlineMd(inner)}__\n`;
    case 'strong':
    case 'b':
      return inner.trim() ? `**${inner.trim()}**` : '';
    case 'em':
    case 'i':
      return inner.trim() ? `*${inner.trim()}*` : '';
    case 'code':
      return inner.trim() ? `\`${inner.trim()}\`` : '';
    case 'a': {
      const href = el.attr('href')?.trim();
      const text = inner.trim();
      if (!text) return '';
      if (!href) return text;
      return `[${text}](${absoluteUrl(href)})`;
    }
    case 'ul':
    case 'ol':
      return `\n${inner}\n`;
    case 'li':
      return `• ${inner.trim()}\n`;
    case 'span':
      return inner;
    default:
      return inner;
  }
}

function stripInlineMd(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/(?<!\\)\*/g, '')
    .replace(/\n+/g, ' ')
    .trim();
}

function collapseWhitespace(s: string): string {
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
