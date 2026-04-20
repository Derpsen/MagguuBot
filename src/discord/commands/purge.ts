import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import { postModLog } from '../mod-log.js';
import type { SlashCommand } from './index.js';

export const purgeCommand: SlashCommand = {
  category: 'moderation',
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk-delete messages in the current channel (max 100)')
    .addIntegerOption((o) =>
      o.setName('count').setDescription('How many messages').setMinValue(1).setMaxValue(100).setRequired(true),
    )
    .addUserOption((o) => o.setName('from').setDescription('Only from this user'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages) as SlashCommandBuilder,
  async execute(interaction) {
    const count = interaction.options.getInteger('count', true);
    const filterUser = interaction.options.getUser('from');
    if (!interaction.guild || !interaction.channel || interaction.channel.isDMBased()) {
      await interaction.reply({ content: 'Nur in Server-Textkanälen.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const channel = interaction.channel as TextChannel;
      const fetched = await channel.messages.fetch({ limit: 100 });
      const filtered = filterUser
        ? fetched.filter((m) => m.author.id === filterUser.id).first(count)
        : fetched.first(count);

      const deleted = await channel.bulkDelete(filtered, true);

      await postModLog({
        guild: interaction.guild,
        action: 'purge',
        moderator: interaction.user,
        reason: filterUser ? `nur von ${filterUser.tag}` : undefined,
        extra: [
          { name: 'Channel', value: channel.toString(), inline: true },
          { name: 'Deleted', value: `${deleted.size}`, inline: true },
        ],
      });

      await interaction.editReply(`🧹 **${deleted.size}** Nachrichten gelöscht.`);
    } catch {
      await interaction.editReply(
        'Konnte nicht löschen — Nachrichten älter als 14 Tage lassen sich nicht bulk-löschen.',
      );
    }
  },
};
