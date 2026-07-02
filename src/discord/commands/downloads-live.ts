import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type TextChannel } from 'discord.js';
import { runDownloadLiveTick, setDownloadLiveEnabled } from '../download-live.js';
import type { SlashCommand } from './index.js';

export const downloadsLiveCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('downloads-live')
    .setDescription('Live-Downloadkarte verwalten')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) => sub
      .setName('enable')
      .setDescription('Livekarte aktivieren')
      .addChannelOption((option) => option.setName('channel').setDescription('Optionaler Zielkanal').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((sub) => sub.setName('refresh').setDescription('Livekarte sofort aktualisieren'))
    .addSubcommand((sub) => sub.setName('disable').setDescription('Livekarte deaktivieren')) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Nur Administratoren.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    if (sub === 'disable') {
      setDownloadLiveEnabled(false);
      await interaction.editReply('⏸️ Live-Downloadkarte deaktiviert.');
      return;
    }
    const channel = interaction.options.getChannel('channel') as TextChannel | null;
    if (sub === 'enable') setDownloadLiveEnabled(true, channel?.id);
    await runDownloadLiveTick();
    await interaction.editReply(sub === 'enable' ? '✅ Live-Downloadkarte aktiviert.' : '🔄 Live-Downloadkarte aktualisiert.');
  },
};
