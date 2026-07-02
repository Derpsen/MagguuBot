import { and, desc, eq, lte, or } from 'drizzle-orm';
import { MessageFlags, type StringSelectMenuInteraction, type TextChannel } from 'discord.js';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { movieNightNominations, movieNights, movieNightVotes } from '../db/schema.js';
import { buildMovieNightComponents, buildMovieNightEmbed, type MovieNightView } from '../embeds/movie-night.js';
import { logger } from '../utils/logger.js';
import { getClient } from './client.js';
import { getFeatureState, setFeatureState } from './feature-state.js';

export function getActiveMovieNight(guildId = config.DISCORD_GUILD_ID) {
  return db
    .select()
    .from(movieNights)
    .where(and(eq(movieNights.guildId, guildId), or(eq(movieNights.status, 'open'), eq(movieNights.status, 'closed'))))
    .orderBy(desc(movieNights.id))
    .get();
}

export function getOpenMovieNight(guildId = config.DISCORD_GUILD_ID) {
  return db
    .select()
    .from(movieNights)
    .where(and(eq(movieNights.guildId, guildId), eq(movieNights.status, 'open')))
    .orderBy(desc(movieNights.id))
    .get();
}

export function loadMovieNightView(movieNightId: number): MovieNightView | null {
  const night = db.select().from(movieNights).where(eq(movieNights.id, movieNightId)).get();
  if (!night) return null;
  const nominations = db
    .select()
    .from(movieNightNominations)
    .where(eq(movieNightNominations.movieNightId, movieNightId))
    .all();
  const votes = db.select().from(movieNightVotes).where(eq(movieNightVotes.movieNightId, movieNightId)).all();
  const voteCounts = new Map<number, number>();
  for (const vote of votes) voteCounts.set(vote.nominationId, (voteCounts.get(vote.nominationId) ?? 0) + 1);
  return { night, nominations, voteCounts };
}

export async function refreshMovieNightMessage(movieNightId: number): Promise<void> {
  const view = loadMovieNightView(movieNightId);
  if (!view?.night.messageId) return;
  const channel = (await getClient().channels.fetch(view.night.channelId).catch(() => null)) as TextChannel | null;
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(view.night.messageId).catch(() => null);
  if (!message) return;
  await message.edit({ embeds: [buildMovieNightEmbed(view)], components: buildMovieNightComponents(view) });
}

export async function handleMovieNightVote(interaction: StringSelectMenuInteraction): Promise<void> {
  const [, action, nightRaw] = interaction.customId.split(':');
  const nightId = Number(nightRaw);
  const nominationId = Number(interaction.values[0]);
  if (action !== 'vote' || !Number.isSafeInteger(nightId) || !Number.isSafeInteger(nominationId)) {
    await interaction.reply({ content: 'Ungültige Abstimmung.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const view = loadMovieNightView(nightId);
  if (!view || view.night.status !== 'open') {
    await interaction.editReply('Dieses Voting ist nicht mehr offen.');
    return;
  }
  const nomination = view.nominations.find((entry) => entry.id === nominationId);
  if (!nomination) {
    await interaction.editReply('Diese Nominierung gehört nicht zur aktuellen Runde.');
    return;
  }
  db.insert(movieNightVotes)
    .values({ movieNightId: nightId, nominationId, userId: interaction.user.id })
    .onConflictDoUpdate({
      target: [movieNightVotes.movieNightId, movieNightVotes.userId],
      set: { nominationId, createdAt: new Date() },
    })
    .run();
  await refreshMovieNightMessage(nightId);
  await interaction.editReply(`✅ Deine Stimme geht an **${nomination.title}**.`);
}

export function winningNomination(view: MovieNightView) {
  return [...view.nominations].sort((a, b) => {
    const voteDiff = (view.voteCounts.get(b.id) ?? 0) - (view.voteCounts.get(a.id) ?? 0);
    return voteDiff || a.id - b.id;
  })[0];
}

export async function tickMovieNights(now = new Date()): Promise<void> {
  const upcoming = db
    .select()
    .from(movieNights)
    .where(
      and(
        eq(movieNights.guildId, config.DISCORD_GUILD_ID),
        or(eq(movieNights.status, 'open'), eq(movieNights.status, 'closed')),
      ),
    )
    .all();
  for (const night of upcoming) {
    if (!night.scheduledAt) continue;
    const reminderKey = `movieNight:reminder:${night.id}`;
    const until = night.scheduledAt.getTime() - now.getTime();
    const channel = (await getClient().channels.fetch(night.channelId).catch(() => null)) as TextChannel | null;
    if (until > 0 && until <= 60 * 60_000 && !getFeatureState(reminderKey) && channel?.isSendable()) {
      await channel.send({
        content: night.status === 'open'
          ? `⏰ **${night.title}** startet <t:${Math.floor(night.scheduledAt.getTime() / 1000)}:R>. Letzte Chance zum Abstimmen!`
          : `⏰ **${night.title}** startet <t:${Math.floor(night.scheduledAt.getTime() / 1000)}:R>. Das Voting ist bereits beendet.`,
        allowedMentions: { parse: [] },
      });
      setFeatureState(reminderKey, now.toISOString());
    }
  }

  const due = db
    .select()
    .from(movieNights)
    .where(
      and(
        eq(movieNights.guildId, config.DISCORD_GUILD_ID),
        or(eq(movieNights.status, 'open'), eq(movieNights.status, 'closed')),
        lte(movieNights.scheduledAt, now),
      ),
    )
    .all();
  for (const night of due) {
    const view = loadMovieNightView(night.id);
    if (!view) continue;
    const winner = winningNomination(view);
    db.update(movieNights)
      .set({ status: 'finished', closedAt: now })
      .where(eq(movieNights.id, night.id))
      .run();
    await refreshMovieNightMessage(night.id);
    const channel = (await getClient().channels.fetch(night.channelId).catch(() => null)) as TextChannel | null;
    if (channel?.isSendable()) {
      await channel.send({
        content: winner
          ? `🎬 **Movie Night startet!** Gewonnen hat **${winner.title}** mit ${view.voteCounts.get(winner.id) ?? 0} Stimme(n).`
          : `🎬 **Movie Night startet!** Es gab keine Nominierungen.`,
        allowedMentions: { parse: [] },
      });
    }
    logger.info({ movieNightId: night.id, winnerId: winner?.id }, 'movie night finished');
  }
}
