import { EmbedBuilder } from 'discord.js';
import type { TautulliStatRow, TautulliStatSection } from '../services/tautulli.js';
import { Colors, truncate } from './colors.js';

type StatType = 'movies' | 'shows' | 'users';

interface Input {
  type: StatType;
  days: number;
  section: TautulliStatSection | undefined;
}

const TITLES: Record<StatType, { emoji: string; label: string; empty: string }> = {
  movies: {
    emoji: '🎬',
    label: 'Top Filme',
    empty: 'Keine Film-Plays im Zeitraum.',
  },
  shows: {
    emoji: '📺',
    label: 'Top Serien',
    empty: 'Keine Serien-Plays im Zeitraum.',
  },
  users: {
    emoji: '👥',
    label: 'Top User',
    empty: 'Keine User-Aktivität im Zeitraum.',
  },
};

export function buildPlexTopEmbed(i: Input): EmbedBuilder {
  const meta = TITLES[i.type];
  const e = new EmbedBuilder()
    .setColor(Colors.plex)
    .setAuthor({ name: `Plex · letzte ${i.days} Tage` })
    .setTitle(`${meta.emoji}  ${meta.label}`)
    .setTimestamp(new Date())
    .setFooter({ text: 'MagguuBot  ·  Tautulli home-stats' });

  if (!i.section || i.section.rows.length === 0) {
    e.setDescription(`_${meta.empty}_`);
    return e;
  }

  const lines = i.section.rows.slice(0, 10).map((row, idx) => formatRow(row, idx + 1, i.type));
  e.setDescription(lines.join('\n'));
  return e;
}

function formatRow(row: TautulliStatRow, rank: number, type: StatType): string {
  const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `**${rank}.**`;
  const plays = row.total_plays ?? 0;
  const duration = formatDuration(row.total_duration);

  if (type === 'users') {
    const name = row.friendly_name ?? row.user ?? 'Unknown';
    return `${rankEmoji} **${truncate(name, 40)}** — ${plays} plays${duration ? ` · ${duration}` : ''}`;
  }

  const title = row.title ?? 'Unknown';
  const year = row.year ? ` (${row.year})` : '';
  return `${rankEmoji} **${truncate(title, 60)}**${year} — ${plays} plays${duration ? ` · ${duration}` : ''}`;
}

function formatDuration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
