import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { MovieNight, MovieNightNomination } from '../db/schema.js';
import { Colors, truncate } from './colors.js';

export interface MovieNightView {
  night: MovieNight;
  nominations: MovieNightNomination[];
  voteCounts: Map<number, number>;
}

export function buildMovieNightEmbed(view: MovieNightView): EmbedBuilder {
  const { night, nominations, voteCounts } = view;
  const status = night.status === 'open' ? '🟢 Voting offen' : night.status === 'closed' ? '🟡 Voting beendet' : '✅ Abgeschlossen';
  const lines = nominations
    .map((nomination, index) => {
      const title = nomination.url
        ? `[${truncate(nomination.title, 80)}](${nomination.url})`
        : `**${truncate(nomination.title, 80)}**`;
      return `${index + 1}. ${title} · **${voteCounts.get(nomination.id) ?? 0}** Stimme(n)`;
    })
    .join('\n');
  const schedule = night.scheduledAt
    ? `<t:${Math.floor(night.scheduledAt.getTime() / 1000)}:F> · <t:${Math.floor(night.scheduledAt.getTime() / 1000)}:R>`
    : 'Noch kein Termin gesetzt';

  return new EmbedBuilder()
    .setColor(night.status === 'open' ? Colors.brand : Colors.plex)
    .setTitle(truncate(`🎬 ${night.title}`, 256))
    .setDescription(lines ? truncate(lines, 4096) : 'Noch keine Nominierungen. Nutze `/movie-night nominate`.')
    .addFields(
      { name: 'Status', value: status, inline: true },
      { name: 'Termin', value: schedule, inline: true },
      { name: 'Nominierungen', value: `${nominations.length}/25`, inline: true },
    )
    .setFooter({ text: 'Eine Stimme pro Person · erneute Auswahl ändert deine Stimme' })
    .setTimestamp(new Date());
}

export function buildMovieNightComponents(view: MovieNightView): ActionRowBuilder<StringSelectMenuBuilder>[] {
  if (view.night.status !== 'open' || view.nominations.length === 0) return [];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`movie-night:vote:${view.night.id}`)
    .setPlaceholder('Für einen Film abstimmen …')
    .addOptions(
      view.nominations.slice(0, 25).map((nomination) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(truncate(nomination.title, 100))
          .setDescription(`${view.voteCounts.get(nomination.id) ?? 0} Stimme(n)`)
          .setValue(String(nomination.id)),
      ),
    );
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
}
