import { EmbedBuilder } from 'discord.js';
import type { RadarrQueueResponse } from '../services/radarr.js';
import type { SabQueueResponse } from '../services/sabnzbd.js';
import type { SonarrQueueResponse } from '../services/sonarr.js';
import { Colors, formatBytes } from './colors.js';

interface Line {
  title: string;
  progress: number;
  size: number;
  timeleft?: string;
}

interface BuildQueueEmbedInput {
  sonarr: SonarrQueueResponse | null;
  radarr: RadarrQueueResponse | null;
  sab: SabQueueResponse | null;
}

export function buildQueueEmbed(i: BuildQueueEmbedInput): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(Colors.brand)
    .setAuthor({ name: 'Download Queue' })
    .setTitle('📥  Active downloads')
    .setTimestamp(new Date());

  const sonarrLines: Line[] = (i.sonarr?.records ?? []).slice(0, 10).map((r) => ({
    title: r.title,
    progress: r.size === 0 ? 0 : ((r.size - r.sizeleft) / r.size) * 100,
    size: r.size,
    timeleft: r.timeleft,
  }));
  const radarrLines: Line[] = (i.radarr?.records ?? []).slice(0, 10).map((r) => ({
    title: r.title,
    progress: r.size === 0 ? 0 : ((r.size - r.sizeleft) / r.size) * 100,
    size: r.size,
    timeleft: r.timeleft,
  }));
  const sabLines: Line[] = (i.sab?.queue.slots ?? []).slice(0, 10).map((s) => ({
    title: s.filename,
    progress: Number(s.percentage) || 0,
    size: Math.round(Number(s.mb) * 1024 * 1024) || 0,
    timeleft: s.timeleft,
  }));

  if (sonarrLines.length > 0) {
    e.addFields({ name: `📺 Sonarr  ·  ${i.sonarr?.totalRecords ?? 0}`, value: renderLines(sonarrLines) });
  }
  if (radarrLines.length > 0) {
    e.addFields({ name: `🎬 Radarr  ·  ${i.radarr?.totalRecords ?? 0}`, value: renderLines(radarrLines) });
  }
  if (sabLines.length > 0) {
    e.addFields({ name: `📦 SABnzbd  ·  ${i.sab?.queue.noofslots_total ?? 0}`, value: renderLines(sabLines) });
  }
  if (!sonarrLines.length && !radarrLines.length && !sabLines.length) {
    e.setDescription('_Queue is empty._');
  }

  e.setFooter({ text: 'MagguuBot  ·  live snapshot' });
  return e;
}

function renderLines(lines: Line[]): string {
  return lines
    .map((l) => {
      const bar = progressBar(l.progress);
      const pct = `${l.progress.toFixed(0)}%`.padStart(4, ' ');
      const size = formatBytes(l.size);
      const tl = l.timeleft ? `  ·  ⏱ ${l.timeleft}` : '';
      const title = l.title.length > 58 ? l.title.slice(0, 57) + '…' : l.title;
      return `\`${bar}\` ${pct}  ${size}${tl}\n${title}`;
    })
    .join('\n\n');
}

function progressBar(pct: number): string {
  const width = 14;
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}
