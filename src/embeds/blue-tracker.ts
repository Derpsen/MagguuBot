import { EmbedBuilder } from 'discord.js';
import type { EnrichedBluePost } from '../services/blue-tracker-enrich.js';
import type { RssItem } from '../services/rss.js';
import { truncate } from './colors.js';

const BLIZZARD_BLUE = 0x148ae3;
const SOFT_WORD_CAP = 180;
const HARD_CHAR_CAP = 3800;

interface PostType {
  emoji: string;
  label: string;
  color: number;
}

const POST_TYPES: { test: RegExp; type: PostType }[] = [
  { test: /\b(hotfix)\b/i, type: { emoji: '🔥', label: 'Hotfix', color: 0xef4444 } },
  { test: /\b(tuning|class changes?)\b/i, type: { emoji: '💉', label: 'Tuning', color: 0xf97316 } },
  { test: /\b(balance)\b/i, type: { emoji: '⚖️', label: 'Balance', color: 0xeab308 } },
  { test: /\b(ptr|public test realm|public test)\b/i, type: { emoji: '🧪', label: 'PTR', color: 0x8b5cf6 } },
  { test: /\b(patch notes?|release notes?)\b/i, type: { emoji: '📋', label: 'Patch Notes', color: 0x06b6d4 } },
  { test: /\b(maintenance|server status|downtime|restart)\b/i, type: { emoji: '🔧', label: 'Maintenance', color: 0x64748b } },
];

function classifyPost(title: string, description: string): PostType | null {
  const hay = `${title} ${description}`;
  for (const { test, type } of POST_TYPES) {
    if (test.test(hay)) return type;
  }
  return null;
}

export function buildBlueTrackerEmbed(item: RssItem, enriched?: EnrichedBluePost | null): EmbedBuilder {
  const body = enriched?.body ?? stripHtml(item.description ?? '');
  const authorName = enriched?.author ?? item.author;
  const displayAuthor = authorName ? `Blizzard · ${authorName}` : 'Blizzard · Blue-Tracker';
  const post = classifyPost(item.title, body);

  const badge = post ? `${post.emoji} ${post.label} · ` : '';
  const color = post?.color ?? BLIZZARD_BLUE;
  const cleanTitle = item.title.replace(/^\[(eu|us|kr|tw|cn)\]\s*/i, '').trim();

  const e = new EmbedBuilder()
    .setColor(color)
    .setAuthor(
      enriched?.avatarUrl
        ? { name: displayAuthor, iconURL: enriched.avatarUrl }
        : { name: displayAuthor },
    )
    .setTitle(`🔵  ${badge}${truncate(cleanTitle, 200)}`)
    .setTimestamp(item.pubDate ?? new Date());

  if (item.link) e.setURL(item.link);
  if (body) e.setDescription(shortenBody(body, item.link));
  if (enriched?.firstImage) e.setImage(enriched.firstImage);

  if (item.categories?.length) {
    e.addFields({
      name: 'Kategorien',
      value: item.categories.slice(0, 5).map((c) => `\`${c}\``).join(' '),
      inline: false,
    });
  }

  e.setFooter({ text: `MagguuBot  ·  WoW Blue-Tracker${post ? `  ·  ${post.label}` : ''}` });
  return e;
}

function shortenBody(body: string, link: string | undefined): string {
  const words = body.split(/\s+/).filter(Boolean);
  const needsSoftCut = words.length > SOFT_WORD_CAP;
  const needsHardCut = body.length > HARD_CHAR_CAP;
  if (!needsSoftCut && !needsHardCut) return truncate(body, 4000);

  const charCap = needsSoftCut ? estimateCharCap(words) : HARD_CHAR_CAP;
  const cutAt = findBreakpoint(body, charCap);
  const shortened = body.slice(0, cutAt).trimEnd();
  const tail = link ? `\n\n**[→ Weiterlesen auf bluetracker.gg](${link})**` : '\n\n…';
  return truncate(shortened, 4000 - tail.length) + tail;
}

function estimateCharCap(words: string[]): number {
  let chars = 0;
  for (let i = 0; i < SOFT_WORD_CAP && i < words.length; i++) {
    const word = words[i];
    chars += (word?.length ?? 0) + 1;
  }
  return chars;
}

function findBreakpoint(body: string, softLimit: number): number {
  if (body.length <= softLimit) return body.length;
  const windowStart = Math.max(0, softLimit - 300);
  const slice = body.slice(windowStart, softLimit + 200);
  const paraIdx = slice.lastIndexOf('\n\n');
  if (paraIdx >= 0) return windowStart + paraIdx;
  const sentenceMatch = slice.match(/[.!?]\s+[A-ZÄÖÜ]/g);
  if (sentenceMatch) {
    const lastSentence = slice.lastIndexOf(sentenceMatch[sentenceMatch.length - 1]!);
    if (lastSentence >= 0) return windowStart + lastSentence + 1;
  }
  const spaceIdx = body.lastIndexOf(' ', softLimit);
  return spaceIdx > 0 ? spaceIdx : softLimit;
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
