import { AttachmentBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { renderRankCard } from '../cards/rank-card.js';
import { getLeaderboard, getUserXp, levelFromXp, xpForLevel } from '../xp.js';
import { logger } from '../../utils/logger.js';
import type { SlashCommand } from './index.js';

export const rankCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Zeig dein Level + XP als Karte')
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

    const leaderboard = getLeaderboard(interaction.guildId, 1000);
    const rank = leaderboard.findIndex((r) => r.userId === target.id) + 1;

    await interaction.deferReply();
    try {
      const buffer = await renderRankCard({
        username: target.globalName ?? target.username,
        avatarUrl: target.displayAvatarURL({ extension: 'png', size: 256 }),
        level,
        xp: row.xp,
        xpInLevel: row.xp - currentLevelXp,
        xpForNextLevel: nextLevelXp - currentLevelXp,
        rank: rank > 0 ? rank : leaderboard.length + 1,
        messages: row.messagesCounted,
      });
      const file = new AttachmentBuilder(buffer, { name: 'rank.png' });
      await interaction.editReply({ files: [file] });
    } catch (err) {
      logger.warn({ err, userId: target.id }, 'rank card render failed, replying with text');
      await interaction.editReply({
        content: `**${target.tag}** — Level ${level}, ${row.xp} XP, Rank ${rank > 0 ? `#${rank}` : '—'}.`,
      });
    }
  },
};
