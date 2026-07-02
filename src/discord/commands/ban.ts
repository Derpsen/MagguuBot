import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { postModLog } from '../mod-log.js';
import type { SlashCommand } from './index.js';

export const banCommand: SlashCommand = {
  category: 'moderation',
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Einen Nutzer vom Server bannen')
    .addUserOption((o) => o.setName('user').setDescription('Zu bannender Nutzer').setRequired(true))
    .addIntegerOption((o) =>
      o
        .setName('delete-days')
        .setDescription('Nachrichtenverlauf löschen (Tage, 0–7)')
        .setMinValue(0)
        .setMaxValue(7),
    )
    .addStringOption((o) => o.setName('reason').setDescription('Begründung').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers) as SlashCommandBuilder,
  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? undefined;
    const deleteDays = interaction.options.getInteger('delete-days') ?? 0;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild) {
      await interaction.editReply({ content: 'Dieser Befehl ist nur auf einem Server verfügbar.' });
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
      await interaction.editReply({ content: `🔨 **${user.displayName}** gebannt.` });
    } catch {
      await interaction.editReply({
        content: 'Konnte nicht bannen — Bot-Rolle muss über der Ziel-Rolle stehen.',
      });
    }
  },
};

export const unbanCommand: SlashCommand = {
  category: 'moderation',
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Eine Sperre anhand der Nutzer-ID aufheben')
    .addStringOption((o) => o.setName('user-id').setDescription('ID des gesperrten Nutzers').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Begründung').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers) as SlashCommandBuilder,
  async execute(interaction) {
    const userId = interaction.options.getString('user-id', true);
    const reason = interaction.options.getString('reason') ?? undefined;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild) {
      await interaction.editReply({ content: 'Dieser Befehl funktioniert nur auf einem Server.' });
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
      await interaction.editReply({
        content: `🕊️ Ban für **${user.displayName}** aufgehoben.`,
      });
    } catch {
      await interaction.editReply({
        content: 'Sperre konnte nicht aufgehoben werden — Nutzer nicht gesperrt oder ID falsch.',
      });
    }
  },
};
