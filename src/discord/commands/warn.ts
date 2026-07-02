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
import type { SlashCommand } from './index.js';

const ESCALATION_TIMEOUT_MS = 60 * 60 * 1000;

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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild) {
      await interaction.editReply({ content: 'Guild only.' });
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

    const escalation = await maybeEscalate(interaction.guild, user, count);

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

async function maybeEscalate(guild: Guild, user: User, count: number): Promise<string | null> {
  if (!getSetting('warnEscalationEnabled')) return null;
  const timeoutAt = getSetting('warnEscalationTimeoutAt');
  const kickAt = getSetting('warnEscalationKickAt');

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return null;

  if (kickAt > 0 && count >= kickAt) {
    if (member.kickable) {
      try {
        await member.kick(`Auto-Eskalation: ${count} Warnungen erreicht`);
        return `Auto-kick (${count} ≥ ${kickAt})`;
      } catch (err) {
        logger.warn({ err, userId: user.id }, 'auto-kick on warn-escalation failed');
      }
    }
    return `Eskalation fehlgeschlagen — fehlende Permissions (${count} ≥ ${kickAt})`;
  }

  if (timeoutAt > 0 && count >= timeoutAt) {
    if (member.moderatable) {
      try {
        await member.timeout(ESCALATION_TIMEOUT_MS, `Auto-Eskalation: ${count} Warnungen erreicht`);
        return `Auto-timeout 1h (${count} ≥ ${timeoutAt})`;
      } catch (err) {
        logger.warn({ err, userId: user.id }, 'auto-timeout on warn-escalation failed');
      }
    }
    return `Eskalation fehlgeschlagen — fehlende Permissions (${count} ≥ ${timeoutAt})`;
  }

  return null;
}
