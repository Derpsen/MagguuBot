import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Guild,
  type User,
} from 'discord.js';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { warnings } from '../../db/schema.js';
import { getSetting } from '../../settings.js';
import { logger } from '../../utils/logger.js';
import { postModLog } from '../mod-log.js';
import { pickEscalation, runEscalation } from '../warn-escalation.js';
import type { SlashCommand } from './index.js';

const ESCALATION_TIMEOUT_MS = 60 * 60 * 1000;

export const warnCommand: SlashCommand = {
  category: 'moderation',
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Einen Nutzer verwarnen und im Moderationsprotokoll erfassen')
    .addUserOption((o) => o.setName('user').setDescription('Zu verwarnender Nutzer').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Begründung').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers) as SlashCommandBuilder,
  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? undefined;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild) {
      await interaction.editReply({ content: 'Dieser Befehl ist nur auf einem Server verfügbar.' });
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
      .select({ count: sql<number>`count(*)` })
      .from(warnings)
      .where(and(eq(warnings.guildId, interaction.guild.id), eq(warnings.userId, user.id)))
      .get()?.count ?? 0;

    const escalation = await maybeEscalate(interaction.guild, interaction.user, user, count);

    await postModLog({
      guild: interaction.guild,
      action: 'warn',
      moderator: interaction.user,
      target: user,
      reason,
      extra: [
        { name: 'Total warnings', value: `${count}`, inline: true },
        ...(escalation ? [{ name: '⚠️ Eskalation', value: escalation, inline: true }] : []),
      ],
    });

    const escalationLine = escalation ? `\n${escalation}` : '';
    await interaction.editReply({
      content: `⚠️ **${user.displayName}** verwarnt. Insgesamt **${count}** Warnung(en).${escalationLine}`,
    });
  },
};

async function maybeEscalate(guild: Guild, moderator: User, user: User, count: number): Promise<string | null> {
  const step = pickEscalation(count, {
    enabled: getSetting('warnEscalationEnabled'),
    timeoutAt: getSetting('warnEscalationTimeoutAt'),
    kickAt: getSetting('warnEscalationKickAt'),
  });
  if (!step) return null;

  const [invoker, member] = await Promise.all([
    guild.members.fetch(moderator.id).catch(() => null),
    guild.members.fetch(user.id).catch(() => null),
  ]);
  if (!member) return null;

  return runEscalation(
    step,
    count,
    {
      guildOwnerId: guild.ownerId,
      botUserId: guild.client.user.id,
      invokerId: moderator.id,
      invoker,
      targetId: user.id,
      target: member,
    },
    async (action) => {
      const auditReason = `Auto-Eskalation: ${count} Warnungen erreicht`;
      if (action === 'kick') await member.kick(auditReason);
      else await member.timeout(ESCALATION_TIMEOUT_MS, auditReason);
    },
    (err) => logger.warn({ err, userId: user.id, action: step.action }, 'auto-escalation on warn failed'),
  );
}
