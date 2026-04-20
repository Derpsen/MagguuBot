import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import type { SlashCommand } from './index.js';

const COLOR_CHOICES = [
  { name: 'Brand (lila)', value: 'brand' },
  { name: 'Info (blau)', value: 'info' },
  { name: 'Erfolg (grün)', value: 'success' },
  { name: 'Warnung (gelb)', value: 'warn' },
  { name: 'Danger (rot)', value: 'danger' },
] as const;

const COLOR_MAP: Record<string, number> = {
  brand: Colors.brand,
  info: Colors.info,
  success: Colors.success,
  warn: Colors.warn,
  danger: Colors.danger,
};

export const announceCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Admin: post a styled embed announcement in a channel')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Target channel')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    )
    .addStringOption((o) => o.setName('title').setDescription('Title').setRequired(true).setMaxLength(256))
    .addStringOption((o) =>
      o.setName('message').setDescription('Body').setRequired(true).setMaxLength(4000),
    )
    .addStringOption((o) =>
      o.setName('color').setDescription('Accent color').addChoices(...COLOR_CHOICES),
    )
    .addRoleOption((o) => o.setName('ping').setDescription('Optional role to mention'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages) as SlashCommandBuilder,
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel', true) as TextChannel;
    const title = interaction.options.getString('title', true);
    const message = interaction.options.getString('message', true);
    const colorKey = interaction.options.getString('color') ?? 'brand';
    const pingRole = interaction.options.getRole('ping');

    const embed = new EmbedBuilder()
      .setColor(COLOR_MAP[colorKey] ?? Colors.brand)
      .setTitle(title)
      .setDescription(message.replaceAll('\\n', '\n'))
      .setFooter({ text: `Posted by ${interaction.user.tag}` })
      .setTimestamp(new Date());

    await channel.send({
      content: pingRole ? pingRole.toString() : undefined,
      embeds: [embed],
      allowedMentions: pingRole ? { roles: [pingRole.id] } : undefined,
    });

    await interaction.reply({
      content: `✅ Gepostet in ${channel.toString()}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
