import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { warnings } from '../../db/schema.js';
import { postModLog } from '../mod-log.js';
import type { SlashCommand } from './index.js';

export const warnCommand: SlashCommand = {
  category: 'moderation',
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a user — stored in DB, announced in mod-log')
    .addUserOption((o) => o.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers) as SlashCommandBuilder,
  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? undefined;
    if (!interaction.guild) {
      await interaction.reply({ content: 'Guild only.', flags: MessageFlags.Ephemeral });
      return;
    }

    db.insert(warnings)
      .values({
        guildId: interaction.guild.id,
        userId: user.id,
        moderatorId: interaction.user.id,
        reason,
      })
      .run();

    const count = db
      .select()
      .from(warnings)
      .where(and(eq(warnings.guildId, interaction.guild.id), eq(warnings.userId, user.id)))
      .all().length;

    await postModLog({
      guild: interaction.guild,
      action: 'warn',
      moderator: interaction.user,
      target: user,
      reason,
      extra: [{ name: 'Total warnings', value: `${count}`, inline: true }],
    });

    await interaction.reply({
      content: `⚠️ **${user.tag}** verwarnt. Insgesamt **${count}** Warnung(en).`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
