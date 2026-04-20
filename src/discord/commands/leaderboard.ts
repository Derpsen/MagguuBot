import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import { getLeaderboard, levelFromXp } from '../xp.js';
import type { SlashCommand } from './index.js';

export const leaderboardCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top 10 Chatter nach XP') as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Guild only.', flags: MessageFlags.Ephemeral });
      return;
    }

    const rows = getLeaderboard(interaction.guildId, 10);
    if (rows.length === 0) {
      await interaction.reply({ content: 'Noch keine XP-Daten.', flags: MessageFlags.Ephemeral });
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = await Promise.all(
      rows.map(async (r, i) => {
        const user = await interaction.client.users.fetch(r.userId).catch(() => null);
        const name = user?.tag ?? `User ${r.userId}`;
        const prefix = medals[i] ?? `\`#${i + 1}\``;
        return `${prefix} **${name}** — Level \`${levelFromXp(r.xp)}\` · \`${r.xp}\` XP`;
      }),
    );

    const e = new EmbedBuilder()
      .setColor(Colors.brand)
      .setTitle('🏆 Top 10 Chatter')
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'MagguuBot  ·  leaderboard' });

    await interaction.reply({ embeds: [e] });
  },
};
