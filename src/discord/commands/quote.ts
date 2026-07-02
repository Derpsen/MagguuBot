import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import type { SlashCommand } from './index.js';

const MESSAGE_LINK = /https?:\/\/(?:ptb\.|canary\.)?discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;

export const quoteCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('quote')
    .setDescription('Zitiert eine Nachricht als Embed (Message-Link oder ID)')
    .addStringOption((o) =>
      o.setName('link').setDescription('Message-Link oder Message-ID').setRequired(true),
    ) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guild || !interaction.channel) {
      await interaction.reply({ content: 'Nur im Server.', flags: MessageFlags.Ephemeral });
      return;
    }
    const input = interaction.options.getString('link', true).trim();
    const match = input.match(MESSAGE_LINK);

    let channelId = interaction.channelId;
    let messageId = input;
    if (match) {
      const guildId = match[1];
      channelId = match[2] ?? interaction.channelId;
      messageId = match[3] ?? input;
      if (guildId !== interaction.guild.id) {
        await interaction.reply({
          content: 'Cross-server-Quote nicht erlaubt.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await interaction.deferReply();
    const channel = (await interaction.guild.channels.fetch(channelId).catch(() => null)) as
      | TextChannel
      | null;
    if (!channel || !channel.isTextBased()) {
      await interaction.editReply({
        content: 'Channel nicht gefunden.',
      });
      return;
    }
    const target = await channel.messages.fetch(messageId).catch(() => null);
    if (!target) {
      await interaction.editReply({
        content: 'Message nicht gefunden — falsche ID oder bereits gelöscht.',
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.muted)
      .setAuthor({
        name: target.author.username,
        iconURL: target.author.displayAvatarURL(),
      })
      .setDescription(target.content || '_(kein Text)_')
      .addFields({
        name: '​',
        value: `[Jump to message](${target.url}) · in <#${target.channelId}>`,
      })
      .setFooter({ text: `Quoted by ${interaction.user.username}` })
      .setTimestamp(target.createdAt);
    if (target.attachments.size > 0) {
      const first = target.attachments.first();
      if (first?.contentType?.startsWith('image/')) embed.setImage(first.url);
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
