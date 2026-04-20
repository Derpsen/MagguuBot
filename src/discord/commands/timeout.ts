import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type GuildMember } from 'discord.js';
import { postModLog } from '../mod-log.js';
import type { SlashCommand } from './index.js';

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

export const timeoutCommand: SlashCommand = {
  category: 'moderation',
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a user for N minutes (0 = remove timeout)')
    .addUserOption((o) => o.setName('user').setDescription('User to timeout').setRequired(true))
    .addIntegerOption((o) =>
      o
        .setName('minutes')
        .setDescription('Duration in minutes (0 lifts an active timeout, max 40320 = 28 days)')
        .setMinValue(0)
        .setMaxValue(40320)
        .setRequired(true),
    )
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers) as SlashCommandBuilder,
  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const minutes = interaction.options.getInteger('minutes', true);
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
      const durationMs = minutes === 0 ? null : Math.min(minutes * 60 * 1000, MAX_TIMEOUT_MS);
      await (member as GuildMember).timeout(durationMs, reason);

      await postModLog({
        guild: interaction.guild,
        action: minutes === 0 ? 'untimeout' : 'timeout',
        moderator: interaction.user,
        target: user,
        reason,
        extra: minutes === 0 ? [] : [{ name: 'Duration', value: `${minutes} min`, inline: true }],
      });

      await interaction.reply({
        content:
          minutes === 0
            ? `🔊 Timeout von **${user.tag}** aufgehoben.`
            : `🔇 **${user.tag}** für **${minutes} Minuten** getimeoutet.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch {
      await interaction.reply({
        content: 'Konnte nicht timeouten — Bot-Rolle muss über der Ziel-Rolle stehen.',
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
