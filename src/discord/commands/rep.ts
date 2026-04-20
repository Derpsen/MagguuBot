import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
} from 'discord.js';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { reputation, reputationLog } from '../../db/schema.js';
import { Colors } from '../../embeds/colors.js';
import type { SlashCommand } from './index.js';

const REP_COOLDOWN_MS = 2 * 60 * 60 * 1000;

export const repCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('rep')
    .setDescription('Reputation — thank other members or view the leaderboard')
    .addSubcommand((s: SlashCommandSubcommandBuilder) =>
      s
        .setName('give')
        .setDescription('Einem User +1 rep geben (2h Cooldown, nicht self)')
        .addUserOption((o) =>
          o.setName('user').setDescription('Wem gibst du rep?').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('show')
        .setDescription('Rep eines Users anzeigen')
        .addUserOption((o) =>
          o.setName('user').setDescription('User (default: dich selbst)'),
        ),
    )
    .addSubcommand((s) => s.setName('leaderboard').setDescription('Top 10 nach Rep')) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ content: 'Nur im Server.', flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand(true);
    const guildId = interaction.guildId;

    if (sub === 'give') {
      const target = interaction.options.getUser('user', true);
      if (target.id === interaction.user.id) {
        await interaction.reply({
          content: '❌ Du kannst dir nicht selbst rep geben.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (target.bot) {
        await interaction.reply({
          content: '❌ Bots brauchen keine rep.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const since = new Date(Date.now() - REP_COOLDOWN_MS);
      const recent = db
        .select({ count: sql<number>`count(*)` })
        .from(reputationLog)
        .where(
          and(
            eq(reputationLog.guildId, guildId),
            eq(reputationLog.giverId, interaction.user.id),
            gt(reputationLog.createdAt, since),
          ),
        )
        .get();

      if ((recent?.count ?? 0) > 0) {
        await interaction.reply({
          content: '⏳ Du musst 2 Stunden warten bis zum nächsten rep.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      db.insert(reputation)
        .values({ guildId, userId: target.id, rep: 1 })
        .onConflictDoUpdate({
          target: [reputation.guildId, reputation.userId],
          set: { rep: sql`${reputation.rep} + 1`, updatedAt: new Date() },
        })
        .run();

      db.insert(reputationLog)
        .values({ guildId, giverId: interaction.user.id, receiverId: target.id })
        .run();

      const row = db
        .select()
        .from(reputation)
        .where(and(eq(reputation.guildId, guildId), eq(reputation.userId, target.id)))
        .get();

      await interaction.reply({
        content: `❤️ ${interaction.user.toString()} gab ${target.toString()} +1 rep — jetzt bei **${row?.rep ?? 1}**.`,
      });
      return;
    }

    if (sub === 'show') {
      const target = interaction.options.getUser('user') ?? interaction.user;
      const row = db
        .select()
        .from(reputation)
        .where(and(eq(reputation.guildId, guildId), eq(reputation.userId, target.id)))
        .get();
      await interaction.reply({
        content: `${target.toString()} hat **${row?.rep ?? 0}** rep.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'leaderboard') {
      const rows = db
        .select()
        .from(reputation)
        .where(eq(reputation.guildId, guildId))
        .orderBy(desc(reputation.rep))
        .limit(10)
        .all();

      if (rows.length === 0) {
        await interaction.reply({ content: 'Noch keine Rep vergeben.', flags: MessageFlags.Ephemeral });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.brand)
        .setTitle('❤️ Rep-Leaderboard')
        .setDescription(
          rows
            .map((r, i) => `**${i + 1}.** <@${r.userId}> — ${r.rep} rep`)
            .join('\n'),
        );
      await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    }
  },
};
