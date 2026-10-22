import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type TextChannel } from 'discord.js';
import { buildTicketPanelCard } from '../../embeds/cards.js';
import { truncate } from '../../embeds/colors.js';
import { listTicketCategories } from '../ticket-categories.js';
import type { SlashCommand } from './index.js';

export const ticketPanelCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Admin: Ticket-Panel zusätzlich posten (Standard: angeheftet in ❓・hilfe)')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Ziel-Channel')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('title').setDescription('Panel-Titel').setMaxLength(256),
    )
    .addStringOption((o) =>
      o.setName('description').setDescription('Erklärtext').setMaxLength(2000),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({ content: 'Nur im Server.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.options.getChannel('channel', true) as TextChannel;
    const categories = listTicketCategories();
    const panel = buildTicketPanelCard({ channels: {}, commands: new Map(), ticketCategories: categories });
    if (panel.components.length === 0) {
      await interaction.editReply('Keine gültige Ticket-Kategorie konfiguriert.');
      return;
    }
    const embed = panel.embeds[0]!;
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(truncate(description, 4000));

    await channel.send({ embeds: [embed], components: panel.components, allowedMentions: { parse: [] } });
    await interaction.editReply({
      content: `✅ Ticket-Panel gepostet in ${channel.toString()}.`,
    });
  },
};
