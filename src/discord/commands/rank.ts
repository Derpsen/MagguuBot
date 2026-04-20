import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import { getUserXp, levelFromXp, xpForLevel } from '../xp.js';
import type { SlashCommand } from './index.js';

function progressBar(current: number, max: number, width = 14): string {
  const pct = Math.min(1, Math.max(0, current / max));
  const filled = Math.round(pct * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export const rankCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Zeig dein Level + XP (oder von jemand anderem)')
    .addUserOption((o) => o.setName('user').setDescription('Zielt auf — default: du selbst')) as SlashCommandBuilder,
  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Guild only.', flags: MessageFlags.Ephemeral });
      return;
    }

    const row = getUserXp(interaction.guildId, target.id);
    if (!row) {
      await interaction.reply({
        content: `**${target.tag}** hat noch keine XP gesammelt.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const level = levelFromXp(row.xp);
    const currentLevelXp = xpForLevel(level);
    const nextLevelXp = xpForLevel(level + 1);
    const progress = row.xp - currentLevelXp;
    const needed = nextLevelXp - currentLevelXp;

    const e = new EmbedBuilder()
      .setColor(Colors.brand)
      .setAuthor({ name: `Rank of ${target.tag}`, iconURL: target.displayAvatarURL() })
      .setDescription(
        [
          `**Level:** \`${level}\``,
          `**XP:** \`${row.xp}\` (+${progress}/${needed} bis Level ${level + 1})`,
          `\`${progressBar(progress, needed)}\``,
          `**Messages counted:** \`${row.messagesCounted}\``,
        ].join('\n'),
      )
      .setFooter({ text: 'MagguuBot  ·  XP only counts non-bot messages, 1/min cap' });

    await interaction.reply({ embeds: [e] });
  },
};
