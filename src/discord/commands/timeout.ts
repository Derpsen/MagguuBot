import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type GuildMember } from 'discord.js';
import { postModLog } from '../mod-log.js';
import type { SlashCommand } from './index.js';

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

export const timeoutCommand: SlashCommand = {
  category: 'moderation',
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Einem Nutzer eine Auszeit geben (0 Minuten hebt sie auf)')
    .addUserOption((o) => o.setName('user').setDescription('Nutzer für die Auszeit').setRequired(true))
    .addIntegerOption((o) =>
      o
        .setName('minutes')
        .setDescription('Dauer in Minuten (0 hebt auf, maximal 40320 = 28 Tage)')
        .setMinValue(0)
        .setMaxValue(40320)
        .setRequired(true),
    )
    .addStringOption((o) => o.setName('reason').setDescription('Begründung').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers) as SlashCommandBuilder,
  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const minutes = interaction.options.getInteger('minutes', true);
    const reason = interaction.options.getString('reason') ?? undefined;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild) {
      await interaction.editReply({ content: 'Dieser Befehl ist nur auf einem Server verfügbar.' });
      return;
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      await interaction.editReply({ content: 'User ist nicht im Server.' });
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

      await interaction.editReply({
        content:
          minutes === 0
            ? `🔊 Timeout von **${user.displayName}** aufgehoben.`
            : `🔇 **${user.displayName}** für **${minutes} Minuten** getimeoutet.`,
      });
    } catch {
      await interaction.editReply({
        content: 'Konnte nicht timeouten — Bot-Rolle muss über der Ziel-Rolle stehen.',
      });
    }
  },
};
