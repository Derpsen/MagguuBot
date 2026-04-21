import { EmbedBuilder } from 'discord.js';
import type { RssItem } from '../services/rss.js';
import { truncate } from './colors.js';

const BLIZZARD_BLUE = 0x148ae3;

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

export function buildBlueTrackerEmbed(item: RssItem): EmbedBuilder {
  const description = stripHtml(item.description ?? '');
  const author = item.author ? `Blizzard · ${item.author}` : 'Blizzard · Blue-Tracker';
  const post = classifyPost(item.title, description);

  const badge = post ? `${post.emoji} ${post.label} · ` : '';
  const color = post?.color ?? BLIZZARD_BLUE;

  const e = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: author })
    .setTitle(`🔵  ${badge}${truncate(item.title, 200)}`)
    .setTimestamp(item.pubDate ?? new Date());

  if (item.link) e.setURL(item.link);
  if (description) e.setDescription(truncate(description, 2000));

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
