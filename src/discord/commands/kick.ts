import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { checkModerationTarget } from '../moderation-guard.js';
import { postModLog } from '../mod-log.js';
import type { SlashCommand } from './index.js';

export const kickCommand: SlashCommand = {
  category: 'moderation',
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Einen Nutzer vom Server entfernen – erneuter Beitritt bleibt möglich')
    .addUserOption((o) => o.setName('user').setDescription('Zu entfernender Nutzer').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Begründung').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers) as SlashCommandBuilder,
  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? undefined;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild) {
      await interaction.editReply({ content: 'Dieser Befehl ist nur auf einem Server verfügbar.' });
      return;
    }

    const [invoker, member] = await Promise.all([
      interaction.guild.members.fetch(interaction.user.id).catch(() => null),
      interaction.guild.members.fetch(user.id).catch(() => null),
    ]);
    const denied = checkModerationTarget({
      action: 'kick',
      guildOwnerId: interaction.guild.ownerId,
      botUserId: interaction.client.user.id,
      invokerId: interaction.user.id,
      invoker,
      targetId: user.id,
      target: member,
    });
    if (denied || !member) {
      await interaction.editReply({ content: denied ?? 'User ist nicht im Server.' });
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
      await interaction.editReply({ content: `👢 **${user.displayName}** gekickt.` });
    } catch {
      await interaction.editReply({
        content: 'Konnte nicht kicken — Bot-Rolle muss über der Ziel-Rolle stehen.',
      });
    }
  },
};
