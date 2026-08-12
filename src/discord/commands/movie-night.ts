import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type TextChannel } from 'discord.js';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { movieNightNominations, movieNights } from '../../db/schema.js';
import { buildMovieNightComponents, buildMovieNightEmbed } from '../../embeds/movie-night.js';
import { parseFutureTime } from '../../utils/schedule.js';
import { getChannel } from '../channel-store.js';
import {
  getActiveMovieNight,
  getOpenMovieNight,
  loadMovieNightView,
  refreshMovieNightMessage,
  winningNomination,
} from '../movie-night.js';
import type { SlashCommand } from './index.js';

export const movieNightCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('movie-night')
    .setDescription('Filmabend planen, Filme nominieren und abstimmen')
    .addSubcommand((sub) => sub
      .setName('create')
      .setDescription('Neue Movie-Night starten (Admin)')
      .addStringOption((option) => option.setName('titel').setDescription('Titel der Runde').setMaxLength(100))
      .addStringOption((option) => option.setName('wann').setDescription('z.B. 2h, 1d oder 2026-07-04T20:00'))
      .addChannelOption((option) => option.setName('channel').setDescription('Zielkanal').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((sub) => sub
      .setName('nominate')
      .setDescription('Film nominieren')
      .addStringOption((option) => option.setName('titel').setDescription('Film-/Serientitel').setRequired(true).setMaxLength(100))
      .addStringOption((option) => option.setName('url').setDescription('Optionaler Plex-/TMDB-Link').setMaxLength(500)))
    .addSubcommand((sub) => sub.setName('status').setDescription('Aktuelle Movie-Night anzeigen'))
    .addSubcommand((sub) => sub.setName('close').setDescription('Voting manuell beenden (Admin)')) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guild) throw new Error('movie-night requires a guild');
    const sub = interaction.options.getSubcommand();
    if ((sub === 'create' || sub === 'close') && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Nur Administratoren.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: sub === 'nominate' ? MessageFlags.Ephemeral : undefined });

    if (sub === 'create') {
      if (getOpenMovieNight(interaction.guild.id)) {
        await interaction.editReply('Es gibt bereits eine aktive Movie-Night. Beende sie zuerst mit `/movie-night close`.');
        return;
      }
      const explicit = interaction.options.getChannel('channel') as TextChannel | null;
      const channelId = explicit?.id ?? getChannel('movieNight') ?? interaction.channelId;
      const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isSendable()) {
        await interaction.editReply('Der Movie-Night-Kanal ist nicht sendbar.');
        return;
      }
      const when = interaction.options.getString('wann');
      const scheduledAt = when ? parseFutureTime(when) : null;
      if (when && !scheduledAt) {
        await interaction.editReply('Ungültiger Termin. Beispiele: `2h`, `1d`, `2026-07-04T20:00`.');
        return;
      }
      const inserted = db.insert(movieNights).values({
        guildId: interaction.guild.id,
        channelId,
        title: interaction.options.getString('titel') ?? 'Movie Night',
        scheduledAt,
        createdBy: interaction.user.id,
      }).returning({ id: movieNights.id }).get();
      if (!inserted) throw new Error('movie night insert failed');
      const view = loadMovieNightView(inserted.id);
      if (!view) throw new Error('movie night could not be loaded');
      const message = await channel.send({ embeds: [buildMovieNightEmbed(view)] });
      db.update(movieNights).set({ messageId: message.id }).where(eq(movieNights.id, inserted.id)).run();
      await interaction.editReply(`✅ Movie-Night #${inserted.id} gestartet: ${message.url}`);
      return;
    }

    const night = sub === 'status'
      ? getActiveMovieNight(interaction.guild.id)
      : getOpenMovieNight(interaction.guild.id);
    if (!night) {
      await interaction.editReply('Aktuell gibt es keine Movie-Night.');
      return;
    }
    if (sub === 'nominate') {
      if (night.status !== 'open') {
        await interaction.editReply('Das Voting ist bereits geschlossen.');
        return;
      }
      const existing = db
        .select()
        .from(movieNightNominations)
        .where(eq(movieNightNominations.movieNightId, night.id))
        .orderBy(desc(movieNightNominations.id))
        .all();
      if (existing.length >= 25) {
        await interaction.editReply('Die Runde hat bereits 25 Nominierungen.');
        return;
      }
      const title = interaction.options.getString('titel', true).trim();
      if (existing.some((entry) => entry.title.toLocaleLowerCase('de-DE') === title.toLocaleLowerCase('de-DE'))) {
        await interaction.editReply('Dieser Titel wurde bereits nominiert.');
        return;
      }
      const rawUrl = interaction.options.getString('url');
      const url = rawUrl ? validHttpUrl(rawUrl) : null;
      if (rawUrl && !url) {
        await interaction.editReply('Der Link muss mit `http://` oder `https://` beginnen.');
        return;
      }
      db.insert(movieNightNominations).values({
        movieNightId: night.id,
        title,
        url,
        nominatedBy: interaction.user.id,
      }).run();
      await refreshMovieNightMessage(night.id);
      await interaction.editReply(`✅ **${title}** wurde nominiert.`);
      return;
    }
    if (sub === 'status') {
      const view = loadMovieNightView(night.id);
      if (!view) throw new Error('movie night view missing');
      await interaction.editReply({ embeds: [buildMovieNightEmbed(view)], components: buildMovieNightComponents(view) });
      return;
    }
    if (sub === 'close') {
      const view = loadMovieNightView(night.id);
      if (!view) throw new Error('movie night view missing');
      const winner = winningNomination(view);
      db.update(movieNights).set({ status: 'closed', closedAt: new Date() }).where(eq(movieNights.id, night.id)).run();
      await refreshMovieNightMessage(night.id);
      await interaction.editReply(winner
        ? `🗳️ Voting beendet. Aktuell führt **${winner.title}** mit ${view.voteCounts.get(winner.id) ?? 0} Stimme(n).`
        : '🗳️ Voting beendet – es gab keine Nominierungen.');
    }
  },
};

function validHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
