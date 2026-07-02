import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { Colors, truncate } from '../../embeds/colors.js';
import { getUserInsights } from '../user-insights.js';
import type { SlashCommand } from './index.js';

export const wrappedCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('wrapped')
    .setDescription('Dein persönliches MagguuBot-Wrapped für dieses Jahr') as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guild) throw new Error('wrapped requires a guild');
    await interaction.deferReply();
    const year = new Date().getFullYear();
    const since = new Date(year, 0, 1);
    const current = getUserInsights(interaction.guild.id, interaction.user.id, since);
    const lifetime = getUserInsights(interaction.guild.id, interaction.user.id);
    const favorite = lifetime.achievements.at(-1);
    const summary = [
      `Du hast **${lifetime.messages}** gewertete Nachrichten geschrieben und Level **${lifetime.level}** erreicht.`,
      `Deine Community hat dir **${lifetime.rep} Rep** gegeben.`,
      `Dieses Jahr kamen **${current.suggestions} Vorschläge** und **${current.movieVotes} Movie-Night-Votes** von dir.`,
      favorite ? `Dein seltenstes aktuelles Badge: ${favorite.emoji} **${favorite.name}**.` : 'Deine Badge-Reise beginnt gerade erst.',
    ].join('\n\n');

    const embed = new EmbedBuilder()
      .setColor(Colors.brand)
      .setAuthor({ name: `${interaction.user.displayName} · Wrapped ${year}`, iconURL: interaction.user.displayAvatarURL() })
      .setTitle('✨ Dein Jahr mit MagguuBot')
      .setDescription(truncate(summary, 4096))
      .addFields(
        { name: '📈 XP', value: `${lifetime.xp}`, inline: true },
        { name: '🏅 Badges', value: `${lifetime.achievements.length}`, inline: true },
        { name: '🍀 Giveaway-Siege', value: `${lifetime.giveawayWins}`, inline: true },
      )
      .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
      .setFooter({ text: 'Teilen ausdrücklich erlaubt ✨' })
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [embed] });
  },
};
