import { EmbedBuilder } from 'discord.js';
import type { RadarrCalendarEntry } from '../services/radarr.js';
import type { SonarrCalendarEntry } from '../services/sonarr.js';
import { Colors, truncate } from './colors.js';

interface Input {
  sonarr: SonarrCalendarEntry[];
  radarr: RadarrCalendarEntry[];
  days: number;
}

export function buildCalendarEmbed(i: Input): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(Colors.brand)
    .setAuthor({ name: `Upcoming · nächste ${i.days} Tage` })
    .setTitle('📅  Coming up')
    .setTimestamp(new Date());

  const sonarrLines = groupByDay(
    i.sonarr
      .filter((s) => !s.hasFile)
      .map((s) => ({
        ts: Date.parse(s.airDateUtc),
        label: formatEpisode(s),
      })),
  );
  const radarrLines = groupByDay(
    i.radarr
      .filter((r) => !r.hasFile)
      .map((r) => {
        const release = r.digitalRelease ?? r.physicalRelease ?? r.inCinemas;
        return {
          ts: release ? Date.parse(release) : Date.now(),
          label: `${r.title}${r.year ? ` (${r.year})` : ''}`,
        };
      }),
  );

  if (sonarrLines) {
    e.addFields({ name: '📺 Sonarr · Episodes', value: truncate(sonarrLines, 1000), inline: false });
  }
  if (radarrLines) {
    e.addFields({ name: '🎬 Radarr · Movies', value: truncate(radarrLines, 1000), inline: false });
  }
  if (!sonarrLines && !radarrLines) {
    e.setDescription(`_Nichts geplant in den nächsten ${i.days} Tagen._`);
  }

  e.setFooter({ text: 'MagguuBot  ·  only unaired / not-yet-downloaded' });
  return e;
}

function formatEpisode(s: SonarrCalendarEntry): string {
  const series = s.series?.title ?? 'Unknown';
  const code = `S${String(s.seasonNumber).padStart(2, '0')}E${String(s.episodeNumber).padStart(2, '0')}`;
  const title = s.title ? ` · ${s.title}` : '';
  return `**${series}** ${code}${title}`;
}

interface Line {
  ts: number;
  label: string;
}

function groupByDay(items: Line[]): string | null {
  if (items.length === 0) return null;
  items.sort((a, b) => a.ts - b.ts);
  const byDay = new Map<string, string[]>();
  for (const it of items) {
    const date = new Date(it.ts);
    const key = date.toISOString().slice(0, 10);
    const list = byDay.get(key) ?? [];
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const mins = date.getUTCMinutes().toString().padStart(2, '0');
    list.push(`  \`${hours}:${mins}\`  ${it.label}`);
    byDay.set(key, list);
  }
  const chunks: string[] = [];
  for (const [day, lines] of byDay) {
    chunks.push(`**${formatDay(day)}**\n${lines.slice(0, 8).join('\n')}`);
  }
  return chunks.join('\n\n');
}

function formatDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return 'Heute';
  if (diffDays === 1) return 'Morgen';
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
}
