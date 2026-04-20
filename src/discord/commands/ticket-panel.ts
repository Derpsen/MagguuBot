import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import type { SlashCommand } from './index.js';

export const ticketPanelCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Admin: Ticket-Panel mit Button in einem Channel posten')
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

    const channel = interaction.options.getChannel('channel', true) as TextChannel;
    const title = interaction.options.getString('title') ?? '🎫 Support-Tickets';
    const description =
      interaction.options.getString('description') ??
      'Brauchst du Hilfe? Klick auf **Ticket öffnen** — ein privater Channel wird für dich und die Mods erstellt. Schließen kannst du ihn jederzeit über den Button im Ticket.';

    const embed = new EmbedBuilder()
      .setColor(Colors.brand)
      .setTitle(title)
      .setDescription(description);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket:open')
        .setStyle(ButtonStyle.Primary)
        .setLabel('Ticket öffnen')
        .setEmoji('🎫'),
    );

    await channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({
      content: `✅ Ticket-Panel gepostet in ${channel.toString()}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
