import { EmbedBuilder } from 'discord.js';
import type { ArrDiskSpace, ArrHealthIssue, ArrSystemStatus } from '../services/sonarr.js';
import type { SabQueueResponse, SabVersion } from '../services/sabnzbd.js';
import type { SeerrRequestCount, SeerrStatus } from '../services/seerr.js';
import { Colors, formatBytes, truncate } from './colors.js';

interface ArrBlock {
  status: ArrSystemStatus | null;
  queueCount: number | null;
  health: ArrHealthIssue[];
  diskSpace: ArrDiskSpace[];
  configured: boolean;
}

interface SabBlock {
  version: SabVersion | null;
  queue: SabQueueResponse | null;
  configured: boolean;
}

interface SeerrBlock {
  status: SeerrStatus | null;
  count: SeerrRequestCount | null;
  configured: boolean;
}

export interface ArrStatusEmbedInput {
  sonarr: ArrBlock;
  radarr: ArrBlock;
  sab: SabBlock;
  seerr: SeerrBlock;
}

export function buildArrStatusEmbed(i: ArrStatusEmbedInput): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(Colors.brand)
    .setAuthor({ name: 'Service Status' })
    .setTitle('🧪  Media-Stack Snapshot')
    .setTimestamp(new Date());

  const rows: string[] = [];
  rows.push(renderArrRow('📺', 'Sonarr', i.sonarr));
  rows.push(renderArrRow('🎬', 'Radarr', i.radarr));
  rows.push(renderSabRow(i.sab));
  rows.push(renderSeerrRow(i.seerr));
  e.setDescription(rows.join('\n'));

  const diskLines = collectDiskLines(i.sonarr.diskSpace, i.radarr.diskSpace);
  if (diskLines.length) {
    e.addFields({ name: '💾 Disk', value: truncate(diskLines.join('\n'), 1000) });
  }

  const healthLines = collectHealthLines(i.sonarr.health, 'Sonarr').concat(
    collectHealthLines(i.radarr.health, 'Radarr'),
  );
  if (healthLines.length) {
    e.addFields({ name: '🩺 Health Issues', value: truncate(healthLines.join('\n'), 1000) });
  }

  e.setFooter({ text: 'MagguuBot  ·  live snapshot' });
  return e;
}

function renderArrRow(emoji: string, name: string, b: ArrBlock): string {
  if (!b.configured) return `${emoji} **${name}**  ·  ⚪ nicht konfiguriert`;
  if (!b.status) return `${emoji} **${name}**  ·  🔴 offline`;
  const version = b.status.version ? `v${b.status.version}` : 'unknown';
  const queue = b.queueCount === null ? '—' : String(b.queueCount);
  const errCount = b.health.filter((h) => h.type === 'error').length;
  const warnCount = b.health.filter((h) => h.type === 'warning').length;
  const healthTag =
    errCount > 0
      ? `🔴 ${errCount} err`
      : warnCount > 0
        ? `🟡 ${warnCount} warn`
        : '🟢 clean';
  return `${emoji} **${name}**  ·  ✅ \`${version}\`  ·  queue \`${queue}\`  ·  ${healthTag}`;
}

function renderSabRow(b: SabBlock): string {
  if (!b.configured) return `📦 **SABnzbd**  ·  ⚪ nicht konfiguriert`;
  if (!b.queue && !b.version) return `📦 **SABnzbd**  ·  🔴 offline`;
  const version = b.version?.version ? `v${b.version.version}` : 'unknown';
  const count = b.queue?.queue.noofslots_total ?? 0;
  const paused = b.queue?.queue.paused ?? false;
  const speed = b.queue?.queue.speed ?? '0 B/s';
  const stateTag = paused ? '⏸ paused' : `⚡ ${speed}`;
  return `📦 **SABnzbd**  ·  ✅ \`${version}\`  ·  queue \`${count}\`  ·  ${stateTag}`;
}

function renderSeerrRow(b: SeerrBlock): string {
  if (!b.configured) return `💜 **Seerr**  ·  ⚪ nicht konfiguriert`;
  if (!b.status) return `💜 **Seerr**  ·  🔴 offline`;
  const version = b.status.version ? `v${b.status.version}` : 'unknown';
  const pending = b.count?.pending ?? 0;
  const approved = b.count?.approved ?? 0;
  const update = b.status.updateAvailable ? '  ·  🆙 update' : '';
  return `💜 **Seerr**  ·  ✅ \`${version}\`  ·  pending \`${pending}\`  ·  approved \`${approved}\`${update}`;
}

function collectDiskLines(a: ArrDiskSpace[], b: ArrDiskSpace[]): string[] {
  const seen = new Map<string, ArrDiskSpace>();
  for (const d of [...a, ...b]) {
    if (!seen.has(d.path)) seen.set(d.path, d);
  }
  return Array.from(seen.values())
    .sort((x, y) => y.freeSpace - x.freeSpace)
    .slice(0, 5)
    .map((d) => {
      const label = d.label || d.path;
      const pct = d.totalSpace > 0 ? Math.round((d.freeSpace / d.totalSpace) * 100) : 0;
      const tag = pct < 10 ? '🔴' : pct < 20 ? '🟡' : '🟢';
      return `${tag} \`${truncate(label, 30)}\`  ·  ${formatBytes(d.freeSpace)} frei  /  ${formatBytes(d.totalSpace)}  ·  ${pct}%`;
    });
}

function collectHealthLines(issues: ArrHealthIssue[], serviceName: string): string[] {
  return issues.slice(0, 5).map((h) => {
    const icon = h.type === 'error' ? '🔴' : h.type === 'warning' ? '🟡' : '🟢';
    return `${icon} **${serviceName}**  ·  ${truncate(h.message ?? h.source ?? 'unknown', 150)}`;
  });
}
