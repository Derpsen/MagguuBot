import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { postModLog } from '../mod-log.js';
import type { SlashCommand } from './index.js';

const PER_CHANNEL_LIMIT = 100;

export const purgeUserCommand: SlashCommand = {
  category: 'moderation',
  data: new SlashCommandBuilder()
    .setName('purge-user')
    .setDescription('Alle Nachrichten eines Users aus allen Text-Channels löschen (letzte 14 Tage)')
    .addUserOption((o) =>
      o.setName('target').setDescription('Welcher User').setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName('limit-per-channel')
        .setDescription(`Max pro Channel (1–${PER_CHANNEL_LIMIT}, default ${PER_CHANNEL_LIMIT})`)
        .setMinValue(1)
        .setMaxValue(PER_CHANNEL_LIMIT),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Nur in Servern.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target = interaction.options.getUser('target', true);
    const limit = interaction.options.getInteger('limit-per-channel') ?? PER_CHANNEL_LIMIT;

    const botMember = await interaction.guild.members.fetchMe();
    const textChannels = interaction.guild.channels.cache.filter(
      (c): c is TextChannel => c.type === ChannelType.GuildText,
    );

    let totalDeleted = 0;
    let skippedNoPerms = 0;
    let scannedChannels = 0;
    const perChannel: Array<{ name: string; count: number }> = [];

    for (const channel of textChannels.values()) {
      const perms = channel.permissionsFor(botMember);
      if (
        !perms ||
        !perms.has(PermissionFlagsBits.ViewChannel) ||
        !perms.has(PermissionFlagsBits.ManageMessages) ||
        !perms.has(PermissionFlagsBits.ReadMessageHistory)
      ) {
        skippedNoPerms++;
        continue;
      }

      scannedChannels++;

      try {
        const recent = await channel.messages.fetch({ limit: PER_CHANNEL_LIMIT });
        const hits = recent.filter((m) => m.author.id === target.id).first(limit);
        if (hits.length === 0) continue;

        const deleted = await channel.bulkDelete(hits, true);
        if (deleted.size > 0) {
          totalDeleted += deleted.size;
          perChannel.push({ name: channel.name, count: deleted.size });
        }
      } catch (err) {
        logger.warn({ err, channel: channel.name, userId: target.id }, 'purge-user failed in channel');
      }
    }

    await postModLog({
      guild: interaction.guild,
      action: 'purge',
      moderator: interaction.user,
      target,
      reason: `purge-user — all channels (scanned ${scannedChannels}, skipped ${skippedNoPerms})`,
      extra: [
        { name: 'Total deleted', value: `${totalDeleted}`, inline: true },
        { name: 'Hit channels', value: `${perChannel.length}`, inline: true },
        { name: 'Limit per channel', value: `${limit}`, inline: true },
      ],
    });

    if (totalDeleted === 0) {
      await interaction.editReply(
        `Keine Nachrichten von **${target.tag}** in den letzten ${PER_CHANNEL_LIMIT} Messages pro Channel gefunden${
          skippedNoPerms > 0 ? ` (${skippedNoPerms} Channels übersprungen — keine Permissions)` : ''
        }.`,
      );
      return;
    }

    const lines = perChannel
      .sort((a, b) => b.count - a.count)
      .slice(0, 15)
      .map((c) => `- \`#${c.name}\`: **${c.count}**`);
    const more = perChannel.length > 15 ? `\n_…+${perChannel.length - 15} weitere_` : '';
    const skipNote = skippedNoPerms > 0 ? `\n\n_${skippedNoPerms} Channels übersprungen — Bot hat dort keine Manage-Messages-Permission._` : '';

    await interaction.editReply(
      `🧹 **${totalDeleted}** Nachrichten von **${target.tag}** gelöscht in **${perChannel.length}** Channels:\n${lines.join('\n')}${more}${skipNote}`,
    );
  },
};
