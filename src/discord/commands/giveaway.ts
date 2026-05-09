import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Role,
  type TextChannel,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { giveaways } from '../../db/schema.js';
import { buildGiveawayButtons, buildGiveawayEmbed, tickGiveaways } from '../giveaway.js';
import type { SlashCommand } from './index.js';

const DURATION_REGEX = /^(\d+)\s*(s|m|h|d)$/i;

function parseDuration(raw: string): number | null {
  const m = raw.trim().match(DURATION_REGEX);
  if (!m) return null;
  const n = Number.parseInt(m[1] ?? '', 10);
  const unit = (m[2] ?? '').toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return null;
  const factor = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return n * factor;
}

export const giveawayCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Giveaway starten / beenden / re-rollen')
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Neues Giveaway starten')
        .addStringOption((o) =>
          o.setName('preis').setDescription('Was wird verlost?').setRequired(true).setMaxLength(200),
        )
        .addStringOption((o) =>
          o.setName('dauer').setDescription('Dauer (z.B. 30m, 2h, 1d)').setRequired(true),
        )
        .addIntegerOption((o) =>
          o.setName('gewinner').setDescription('Anzahl Gewinner').setMinValue(1).setMaxValue(20),
        )
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Ziel-Channel').addChannelTypes(ChannelType.GuildText),
        )
        .addRoleOption((o) => o.setName('rolle').setDescription('Voraussetzung: nur User mit dieser Rolle')),
    )
    .addSubcommand((s) =>
      s
        .setName('end')
        .setDescription('Giveaway sofort beenden')
        .addIntegerOption((o) => o.setName('id').setDescription('Giveaway-ID').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('reroll')
        .setDescription('Neuen Gewinner ziehen')
        .addIntegerOption((o) => o.setName('id').setDescription('Giveaway-ID').setRequired(true)),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Nur im Server.', flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
      const prize = interaction.options.getString('preis', true);
      const durationRaw = interaction.options.getString('dauer', true);
      const winnersCount = interaction.options.getInteger('gewinner') ?? 1;
      const channelOpt = interaction.options.getChannel('channel') as TextChannel | null;
      const requiredRole = interaction.options.getRole('rolle') as Role | null;
      const durationMs = parseDuration(durationRaw);
      if (!durationMs) {
        await interaction.reply({
          content: 'Ungültige Dauer. Format: `30s`, `5m`, `2h`, `1d`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const channel = channelOpt ?? (interaction.channel as TextChannel);
      if (!channel?.isSendable()) {
        await interaction.reply({ content: 'Ungültiger Channel.', flags: MessageFlags.Ephemeral });
        return;
      }
      const endsAt = new Date(Date.now() + durationMs);

      const inserted = db
        .insert(giveaways)
        .values({
          guildId: interaction.guild.id,
          channelId: channel.id,
          messageId: 'pending',
          prize,
          winnersCount,
          endsAt,
          hostId: interaction.user.id,
          participants: [],
          winners: [],
          requiredRoleId: requiredRole?.id ?? null,
        })
        .returning({ id: giveaways.id })
        .get();
      if (!inserted) {
        await interaction.reply({ content: 'Insert fehlgeschlagen.', flags: MessageFlags.Ephemeral });
        return;
      }

      const fresh = db.select().from(giveaways).where(eq(giveaways.id, inserted.id)).get();
      if (!fresh) return;
      const message = await channel.send({
        embeds: [buildGiveawayEmbed(fresh, false)],
        components: [buildGiveawayButtons(fresh.id, false)],
      });
      db.update(giveaways).set({ messageId: message.id }).where(eq(giveaways.id, fresh.id)).run();

      await interaction.reply({
        content: `✅ Giveaway gestartet: ${message.url}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'end') {
      const id = interaction.options.getInteger('id', true);
      const g = db.select().from(giveaways).where(eq(giveaways.id, id)).get();
      if (!g) {
        await interaction.reply({ content: 'Giveaway nicht gefunden.', flags: MessageFlags.Ephemeral });
        return;
      }
      db.update(giveaways).set({ endsAt: new Date() }).where(eq(giveaways.id, id)).run();
      await tickGiveaways();
      await interaction.reply({ content: `✅ Giveaway #${id} beendet.`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'reroll') {
      const id = interaction.options.getInteger('id', true);
      const g = db.select().from(giveaways).where(eq(giveaways.id, id)).get();
      if (!g || !g.ended) {
        await interaction.reply({
          content: 'Giveaway nicht gefunden oder noch nicht beendet.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const pool = g.participants.filter((p) => !g.winners.includes(p));
      if (pool.length === 0) {
        await interaction.reply({
          content: 'Keine weiteren Teilnehmer für Reroll.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const newWinner = pool[Math.floor(Math.random() * pool.length)];
      if (!newWinner) return;
      const channel = (await interaction.guild.channels.fetch(g.channelId).catch(() => null)) as
        | TextChannel
        | null;
      if (channel?.isSendable()) {
        await channel.send({
          content: `🎲 Reroll für Giveaway **${g.prize}**: <@${newWinner}> hat gewonnen!`,
          allowedMentions: { users: [newWinner] },
        });
      }
      await interaction.reply({ content: `✅ Reroll: <@${newWinner}>`, flags: MessageFlags.Ephemeral });
      return;
    }
  },
};
