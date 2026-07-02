import { EmbedBuilder } from 'discord.js';
import { Colors, truncate } from './colors.js';

export interface WeeklyDigestData {
  periodLabel: string;
  newOnPlex: number;
  imports: number;
  requestsCreated: number;
  requestsAvailable: number;
  requestsDeclined: number;
  requestsFailed: number;
  suggestions: number;
  starboardPosts: number;
  topUser?: { name: string; xp: number; level: number };
  sourceCounts: Array<{ source: string; count: number }>;
}

export function buildWeeklyDigestEmbed(data: WeeklyDigestData): EmbedBuilder {
  const sources = data.sourceCounts.length
    ? data.sourceCounts.map((entry) => `**${entry.source}:** ${entry.count}`).join(' · ')
    : 'Keine Webhook-Aktivität';
  const topUser = data.topUser
    ? `🏆 **${truncate(data.topUser.name, 80)}** · Level ${data.topUser.level} · ${data.topUser.xp} XP`
    : 'Noch keine XP-Daten';

  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setTitle('📊 Wochenrückblick')
    .setDescription(`Das war die Woche **${data.periodLabel}**.`)
    .addFields(
      {
        name: '🎬 Media',
        value: `Neu auf Plex: **${data.newOnPlex}**\nImports: **${data.imports}**`,
        inline: true,
      },
      {
        name: '📝 Requests',
        value: `Neu: **${data.requestsCreated}**\nVerfügbar: **${data.requestsAvailable}**\nAbgelehnt/Fehlgeschlagen: **${data.requestsDeclined + data.requestsFailed}**`,
        inline: true,
      },
      {
        name: '✨ Community',
        value: `Vorschläge: **${data.suggestions}**\nStarboard-Posts: **${data.starboardPosts}**`,
        inline: true,
      },
      { name: '👑 Aktueller XP-Spitzenreiter', value: topUser },
      { name: '⚙️ Bot-Aktivität', value: truncate(sources, 1024) },
    )
    .setFooter({ text: 'MagguuBot · automatisch jeden Sonntag' })
    .setTimestamp(new Date());
}
