import { EmbedBuilder } from 'discord.js';
import type { RssItem } from '../services/rss.js';
import { truncate } from './colors.js';

const BLIZZARD_BLUE = 0x148ae3;

export function buildBlueTrackerEmbed(item: RssItem): EmbedBuilder {
  const description = stripHtml(item.description ?? '');
  const author = item.author ? `Blizzard · ${item.author}` : 'Blizzard · Blue-Tracker';

  const e = new EmbedBuilder()
    .setColor(BLIZZARD_BLUE)
    .setAuthor({ name: author })
    .setTitle(`🔵  ${truncate(item.title, 240)}`)
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

  e.setFooter({ text: 'MagguuBot  ·  WoW Blue-Tracker' });
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
