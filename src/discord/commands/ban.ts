import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { postModLog } from '../mod-log.js';
import type { SlashCommand } from './index.js';

export const banCommand: SlashCommand = {
  category: 'moderation',
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user from the server')
    .addUserOption((o) => o.setName('user').setDescription('User to ban').setRequired(true))
    .addIntegerOption((o) =>
      o
        .setName('delete-days')
        .setDescription('Delete message history (days, 0-7)')
        .setMinValue(0)
        .setMaxValue(7),
    )
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers) as SlashCommandBuilder,
  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? undefined;
    const deleteDays = interaction.options.getInteger('delete-days') ?? 0;
    if (!interaction.guild) {
      await interaction.reply({ content: 'Guild only.', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      await interaction.guild.members.ban(user.id, { reason, deleteMessageSeconds: deleteDays * 86400 });
      await postModLog({
        guild: interaction.guild,
        action: 'ban',
        moderator: interaction.user,
        target: user,
        reason,
        extra: deleteDays > 0 ? [{ name: 'Msgs purged', value: `last ${deleteDays}d`, inline: true }] : [],
      });
      await interaction.reply({ content: `🔨 **${user.tag}** gebannt.`, flags: MessageFlags.Ephemeral });
    } catch {
      await interaction.reply({
        content: 'Konnte nicht bannen — Bot-Rolle muss über der Ziel-Rolle stehen.',
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

export const unbanCommand: SlashCommand = {
  category: 'moderation',
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Lift a ban (by user ID)')
    .addStringOption((o) => o.setName('user-id').setDescription('The banned user ID').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers) as SlashCommandBuilder,
  async execute(interaction) {
    const userId = interaction.options.getString('user-id', true);
    const reason = interaction.options.getString('reason') ?? undefined;
    if (!interaction.guild) {
      await interaction.reply({ content: 'Guild only.', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      const user = await interaction.client.users.fetch(userId);
      await interaction.guild.members.unban(userId, reason);
      await postModLog({
        guild: interaction.guild,
        action: 'unban',
        moderator: interaction.user,
        target: user,
        reason,
      });
      await interaction.reply({
        content: `🕊️ Ban für **${user.tag}** aufgehoben.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch {
      await interaction.reply({
        content: 'Konnte nicht unbannen — User nicht gebannt oder ID falsch.',
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
