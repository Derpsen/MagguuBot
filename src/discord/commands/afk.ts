import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import { setAfk } from '../afk.js';
import type { SlashCommand } from './index.js';

export const afkCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Setz dich auf AFK — User die dich pingen, kriegen einen Hinweis')
    .addStringOption((o) =>
      o.setName('grund').setDescription('Warum bist du weg?').setMaxLength(200),
    ) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guild || !interaction.member) {
      await interaction.reply({ content: 'Nur im Server.', flags: MessageFlags.Ephemeral });
      return;
    }
    const reason = interaction.options.getString('grund') ?? 'AFK';
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await setAfk(interaction.member as GuildMember, reason);
    await interaction.editReply({
      content: `💤 Du bist jetzt AFK — Grund: **${reason}**\n\n_Verschwindet automatisch wenn du wieder schreibst._`,
    });
  },
};
