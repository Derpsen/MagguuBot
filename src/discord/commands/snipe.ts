import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import { getLastDeleted, getLastEdited } from '../snipe.js';
import type { SlashCommand } from './index.js';

export const snipeCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('snipe')
    .setDescription('Zeigt die letzte gelöschte Message in diesem Channel (mod-only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guildId || !interaction.channelId) {
      await interaction.reply({ content: 'Nur im Server.', flags: MessageFlags.Ephemeral });
      return;
    }
    const snap = getLastDeleted(interaction.channelId);
    if (!snap) {
      await interaction.reply({
        content: '🌬 Keine gesnipten Messages in diesem Channel (oder älter als 1h).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(Colors.danger)
      .setAuthor({ name: `Sniped: ${snap.authorTag}`, iconURL: snap.authorAvatarUrl || undefined })
      .setDescription(snap.content || '_(kein Text — nur Attachments)_')
      .setFooter({ text: `gelöscht vor ${formatAgo(Date.now() - snap.deletedAt)}` })
      .setTimestamp(new Date(snap.deletedAt));
    if (snap.attachments.length > 0) {
      embed.addFields({ name: 'Attachments', value: snap.attachments.join('\n').slice(0, 1024) });
    }
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export const editSnipeCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('editsnipe')
    .setDescription('Zeigt die letzte editierte Message (vorher/nachher) in diesem Channel (mod-only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guildId || !interaction.channelId) {
      await interaction.reply({ content: 'Nur im Server.', flags: MessageFlags.Ephemeral });
      return;
    }
    const snap = getLastEdited(interaction.channelId);
    if (!snap) {
      await interaction.reply({
        content: '🌬 Keine editierten Messages in diesem Channel (oder älter als 1h).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(Colors.warn)
      .setAuthor({ name: `Edit-Sniped: ${snap.authorTag}`, iconURL: snap.authorAvatarUrl || undefined })
      .addFields(
        { name: 'Vorher', value: snap.content.slice(0, 1024) || '_(leer)_' },
        { name: 'Nachher', value: snap.newContent.slice(0, 1024) || '_(leer)_' },
      )
      .setFooter({ text: `editiert vor ${formatAgo(Date.now() - snap.editedAt)}` })
      .setTimestamp(new Date(snap.editedAt));
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

function formatAgo(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h`;
}
