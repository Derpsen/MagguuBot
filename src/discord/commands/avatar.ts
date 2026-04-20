import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import type { SlashCommand } from './index.js';

export const avatarCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Zeig den Avatar von einem User in groß')
    .addUserOption((o) => o.setName('user').setDescription('Default: du selbst')) as SlashCommandBuilder,
  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const url = target.displayAvatarURL({ size: 1024 });
    const e = new EmbedBuilder()
      .setColor(Colors.brand)
      .setTitle(`Avatar of ${target.tag}`)
      .setURL(url)
      .setImage(url);
    await interaction.reply({ embeds: [e] });
  },
};
