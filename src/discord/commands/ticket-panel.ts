import {
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type TextChannel,
} from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import { listTicketCategories } from '../ticket-categories.js';
import type { SlashCommand } from './index.js';

export const ticketPanelCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Admin: Ticket-Panel mit Kategorien-SelectMenu posten')
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
    const categories = listTicketCategories();
    const description =
      interaction.options.getString('description') ??
      [
        'Brauchst du Hilfe? Wähl eine **Kategorie** unten — ein privater Ticket-Channel wird erstellt.',
        '',
        '**Kategorien:**',
        ...categories.map((c) => `${c.emoji} **${c.label}** — ${c.description}`),
        '',
        '_Schließen kannst du das Ticket jederzeit über den Button im Channel._',
      ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(Colors.brand)
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: 'Eine offene Anfrage pro User · automatisch geschlossen nach 48h Inaktivität' });

    const select = new StringSelectMenuBuilder()
      .setCustomId('ticket-category:open')
      .setPlaceholder('🎫 Kategorie wählen → Ticket öffnen')
      .setMinValues(1)
      .setMaxValues(1);

    const options = categories.map((c) => {
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(c.label.slice(0, 100))
        .setValue(c.key)
        .setEmoji(c.emoji);
      if (c.description) opt.setDescription(c.description.slice(0, 100));
      return opt;
    });
    select.addOptions(...options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    await channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({
      content: `✅ Ticket-Panel gepostet in ${channel.toString()}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
