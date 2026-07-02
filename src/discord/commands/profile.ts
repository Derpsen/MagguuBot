import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { Colors, truncate } from '../../embeds/colors.js';
import { getUserInsights } from '../user-insights.js';
import type { SlashCommand } from './index.js';

export const profileCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Profil, XP, Reputation und Achievements anzeigen')
    .addUserOption((option) => option.setName('user').setDescription('Standard: du selbst')) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guild) throw new Error('profile requires a guild');
    await interaction.deferReply();
    const user = interaction.options.getUser('user') ?? interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const stats = getUserInsights(interaction.guild.id, user.id);
    const badges = stats.achievements.length
      ? stats.achievements.map((achievement) => `${achievement.emoji} **${achievement.name}**`).join(' · ')
      : 'Noch keine – aber das erste ist nur eine Nachricht entfernt.';
    const birthday = stats.birthday
      ? `${String(stats.birthday.day).padStart(2, '0')}.${String(stats.birthday.month).padStart(2, '0')}${stats.birthday.year ? `.${stats.birthday.year}` : ''}`
      : 'Nicht hinterlegt';

    const embed = new EmbedBuilder()
      .setColor(member?.displayColor || Colors.brand)
      .setAuthor({ name: member?.displayName ?? user.displayName, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: '📈 Level', value: `**${stats.level}** · ${stats.xp} XP`, inline: true },
        { name: '🤝 Reputation', value: `**${stats.rep}**`, inline: true },
        { name: '💬 Nachrichten', value: `**${stats.messages}**`, inline: true },
        { name: '💡 Vorschläge', value: `**${stats.suggestions}**`, inline: true },
        { name: '🎬 Movie-Votes', value: `**${stats.movieVotes}**`, inline: true },
        { name: '🎂 Geburtstag', value: birthday, inline: true },
        { name: `🏅 Achievements · ${stats.achievements.length}`, value: truncate(badges, 1024) },
      )
      .setFooter({ text: 'MagguuBot · profile' })
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [embed] });
  },
};
