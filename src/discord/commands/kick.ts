import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { postModLog } from '../mod-log.js';
import type { SlashCommand } from './index.js';

export const kickCommand: SlashCommand = {
  category: 'moderation',
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a user — they can rejoin via invite')
    .addUserOption((o) => o.setName('user').setDescription('User to kick').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers) as SlashCommandBuilder,
  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? undefined;
    if (!interaction.guild) {
      await interaction.reply({ content: 'Guild only.', flags: MessageFlags.Ephemeral });
      return;
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: 'User ist nicht im Server.', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      await member.kick(reason);
      await postModLog({
        guild: interaction.guild,
        action: 'kick',
        moderator: interaction.user,
        target: user,
        reason,
      });
      await interaction.reply({ content: `👢 **${user.tag}** gekickt.`, flags: MessageFlags.Ephemeral });
    } catch {
      await interaction.reply({
        content: 'Konnte nicht kicken — Bot-Rolle muss über der Ziel-Rolle stehen.',
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
