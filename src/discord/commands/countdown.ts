import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { countdowns } from '../../db/schema.js';
import { buildCountdownEmbed, renderTimeLeft } from '../../embeds/countdown.js';
import { logger } from '../../utils/logger.js';
import type { SlashCommand } from './index.js';

const DURATION_RE = /^\s*(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*$/i;

function parseTarget(input: string): Date | null {
  const trimmed = input.trim();

  // ISO absolute: 2026-05-01T18:00 or 2026-05-01 18:00
  const iso = Date.parse(trimmed.replace(' ', 'T'));
  if (!Number.isNaN(iso)) return new Date(iso);

  // Relative duration: 2d 3h 30m
  const m = trimmed.match(DURATION_RE);
  if (m && (m[1] || m[2] || m[3])) {
    const d = Number(m[1] ?? 0);
    const h = Number(m[2] ?? 0);
    const min = Number(m[3] ?? 0);
    const ms = ((d * 24 + h) * 60 + min) * 60 * 1000;
    if (ms > 0) return new Date(Date.now() + ms);
  }

  return null;
}

export const countdownCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('countdown')
    .setDescription('Live-Countdown zu einem Event')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Neuen Countdown erstellen')
        .addStringOption((o) =>
          o.setName('title').setDescription('Event-Titel').setRequired(true).setMaxLength(200),
        )
        .addStringOption((o) =>
          o
            .setName('when')
            .setDescription('ISO-Datum (2026-05-01 18:00) oder relative (2d 3h 30m)')
            .setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('description').setDescription('Kurze Beschreibung').setMaxLength(1800),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Zielchannel (default: aktueller)')
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Aktive Countdowns zeigen'))
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Countdown entfernen')
        .addIntegerOption((o) =>
          o.setName('id').setDescription('Countdown-ID (aus /countdown list)').setRequired(true),
        ),
    ) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Nur im Server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const title = interaction.options.getString('title', true);
      const whenRaw = interaction.options.getString('when', true);
      const description = interaction.options.getString('description');
      const targetChannel =
        (interaction.options.getChannel('channel') as TextChannel | null) ??
        (interaction.channel as TextChannel);

      const targetAt = parseTarget(whenRaw);
      if (!targetAt || targetAt.getTime() <= Date.now()) {
        await interaction.reply({
          content: '❌ Ungültiges Datum. Formate: `2026-05-01 18:00` ODER `2d 3h 30m`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const embed = buildCountdownEmbed({ title, description, targetAt, finished: false });
      const message = await targetChannel.send({ embeds: [embed] });

      const inserted = db
        .insert(countdowns)
        .values({
          guildId: interaction.guild.id,
          channelId: targetChannel.id,
          messageId: message.id,
          title,
          description,
          targetAt,
          createdBy: interaction.user.id,
          lastRenderedLabel: renderTimeLeft(targetAt.getTime() - Date.now()),
        })
        .returning({ id: countdowns.id })
        .get();

      await interaction.editReply(
        `⏳ Countdown \`#${inserted?.id ?? '?'}\` in ${targetChannel} angelegt — Ziel: <t:${Math.floor(targetAt.getTime() / 1000)}:F>.`,
      );
      return;
    }

    if (sub === 'list') {
      const rows = db
        .select()
        .from(countdowns)
        .where(and(eq(countdowns.guildId, interaction.guild.id), eq(countdowns.finished, false)))
        .orderBy(desc(countdowns.targetAt))
        .all();
      if (rows.length === 0) {
        await interaction.reply({ content: 'Keine aktiven Countdowns.', flags: MessageFlags.Ephemeral });
        return;
      }
      const lines = rows.map((r) => {
        const unix = Math.floor(r.targetAt.getTime() / 1000);
        return `\`#${r.id}\` **${r.title}** — <t:${unix}:R>  ·  <#${r.channelId}>`;
      });
      await interaction.reply({
        content: `**Aktive Countdowns (${rows.length}):**\n${lines.join('\n')}`.slice(0, 1900),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'remove') {
      const id = interaction.options.getInteger('id', true);
      const row = db.select().from(countdowns).where(eq(countdowns.id, id)).get();
      if (!row || row.guildId !== interaction.guild.id) {
        await interaction.reply({
          content: `❌ Countdown \`#${id}\` nicht gefunden.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const channel = await interaction.client.channels.fetch(row.channelId);
        if (channel?.isTextBased()) {
          const msg = await channel.messages.fetch(row.messageId).catch(() => null);
          if (msg) await msg.delete().catch(() => null);
        }
      } catch (err) {
        logger.debug({ err, id }, 'countdown message cleanup failed');
      }
      db.delete(countdowns).where(eq(countdowns.id, id)).run();
      await interaction.editReply(`🗑️ Countdown \`#${id}\` entfernt.`);
    }
  },
};

