import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import { postModLog } from '../mod-log.js';
import type { SlashCommand } from './index.js';

const MAX_SLOWMODE_SECONDS = 21600;

export const slowmodeCommand: SlashCommand = {
  category: 'moderation',
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Setze (oder entferne) Discord-Slowmode auf diesen Channel')
    .addIntegerOption((o) =>
      o
        .setName('seconds')
        .setDescription('Sekunden zwischen Nachrichten pro User (0 = aus, max 21600)')
        .setMinValue(0)
        .setMaxValue(MAX_SLOWMODE_SECONDS)
        .setRequired(true),
    )
    .addStringOption((o) => o.setName('reason').setDescription('Audit-log Grund').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Guild only.', flags: MessageFlags.Ephemeral });
      return;
    }
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'Slowmode geht nur in normalen Text-Channels.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const seconds = interaction.options.getInteger('seconds', true);
    const reason = interaction.options.getString('reason') ?? undefined;

    try {
      await (channel as TextChannel).setRateLimitPerUser(seconds, reason ?? `slowmode by ${interaction.user.tag}`);
    } catch {
      await interaction.reply({
        content: 'Konnte Slowmode nicht setzen — fehlende Permissions?',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const label = seconds === 0 ? 'aus' : formatSeconds(seconds);
    await postModLog({
      guild: interaction.guild,
      action: 'slowmode',
      moderator: interaction.user,
      reason,
      extra: [
        { name: 'Channel', value: `<#${channel.id}>`, inline: true },
        { name: 'Slowmode', value: label, inline: true },
      ],
    });

    await interaction.reply({
      content:
        seconds === 0
          ? `🔓 Slowmode in ${channel.toString()} ausgeschaltet.`
          : `🐌 Slowmode in ${channel.toString()} auf **${label}** gesetzt.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  return `${Math.round(s / 3600)}h`;
}
