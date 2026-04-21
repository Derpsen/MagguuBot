import { EmbedBuilder } from 'discord.js';
import { Colors, formatBytes, truncate } from './colors.js';

interface ArrCommon {
  service: 'sonarr' | 'radarr';
  posterUrl?: string | null;
  indexer?: string;
  size?: number;
  quality?: string;
  releaseGroup?: string;
  releaseTitle?: string;
}

function qualityBadge(q: string | undefined): string {
  if (!q) return '—';
  const l = q.toLowerCase();
  if (l.includes('2160') || l.includes('4k') || l.includes('uhd')) return `💎 ${q}`;
  if (l.includes('1080')) return `🔷 ${q}`;
  if (l.includes('720')) return `🟢 ${q}`;
  if (l.includes('480') || l.includes('sd')) return `⚪ ${q}`;
  return q;
}

export interface GrabEmbedInput extends ArrCommon {
  title: string;
  year?: number | string;
  episode?: { season: number; number: number; title?: string };
}

export function buildGrabEmbed(i: GrabEmbedInput): EmbedBuilder {
  const serviceLabel = i.service === 'sonarr' ? 'Sonarr' : 'Radarr';
  const color = i.service === 'sonarr' ? Colors.sonarr : Colors.radarr;
  const emoji = i.service === 'sonarr' ? '📺' : '🎬';
  const episodeTag =
    i.episode
      ? `  ·  S${String(i.episode.season).padStart(2, '0')}E${String(i.episode.number).padStart(2, '0')}`
      : '';
  const yearTag = i.year ? `  ·  ${i.year}` : '';

  const e = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${serviceLabel}  ·  Grabbed` })
    .setTitle(`${emoji}  ${i.title}${yearTag}${episodeTag}`)
    .setTimestamp(new Date());

  if (i.posterUrl) e.setThumbnail(i.posterUrl);
  if (i.episode?.title) e.setDescription(truncate(i.episode.title, 400));

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (i.quality) fields.push({ name: 'Quality', value: qualityBadge(i.quality), inline: true });
  if (i.size) fields.push({ name: 'Size', value: formatBytes(i.size), inline: true });
  if (i.indexer) fields.push({ name: 'Indexer', value: i.indexer, inline: true });
  if (i.releaseGroup) fields.push({ name: 'Release Group', value: i.releaseGroup, inline: true });
  if (i.releaseTitle) fields.push({ name: 'Release', value: `\`${truncate(i.releaseTitle, 1000)}\``, inline: false });
  if (fields.length) e.addFields(fields);

  e.setFooter({ text: 'MagguuUI  ·  download started' });
  return e;
}

export interface ImportEmbedInput extends ArrCommon {
  title: string;
  year?: number | string;
  episode?: { season: number; number: number; title?: string };
  isUpgrade?: boolean;
}

export function buildImportEmbed(i: ImportEmbedInput): EmbedBuilder {
  const color = i.isUpgrade ? Colors.info : Colors.success;
  const label = i.isUpgrade ? 'Upgraded' : 'Imported';
  const serviceLabel = i.service === 'sonarr' ? 'Sonarr' : 'Radarr';
  const emoji = i.service === 'sonarr' ? '📺' : '🎬';
  const episodeTag =
    i.episode
      ? `  ·  S${String(i.episode.season).padStart(2, '0')}E${String(i.episode.number).padStart(2, '0')}`
      : '';
  const yearTag = i.year ? `  ·  ${i.year}` : '';

  const e = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${serviceLabel}  ·  ${label}` })
    .setTitle(`${emoji}  ${i.title}${yearTag}${episodeTag}`)
    .setTimestamp(new Date());

  if (i.posterUrl) e.setThumbnail(i.posterUrl);
  if (i.episode?.title) e.setDescription(truncate(i.episode.title, 400));

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (i.quality) fields.push({ name: 'Quality', value: qualityBadge(i.quality), inline: true });
  if (i.size) fields.push({ name: 'Size', value: formatBytes(i.size), inline: true });
  if (i.releaseGroup) fields.push({ name: 'Release Group', value: i.releaseGroup, inline: true });
  if (fields.length) e.addFields(fields);

  e.setFooter({ text: `MagguuUI  ·  available on Plex` });
  return e;
}

export interface FailureEmbedInput {
  service: 'sonarr' | 'radarr';
  title: string;
  reason?: string;
  eventType: string;
  downloadClient?: string;
  releaseTitle?: string;
  quality?: string;
}

const FAILURE_LABELS: Record<string, { label: string; icon: string; hint: string }> = {
  DownloadFailure: { label: 'Download failed', icon: '❌', hint: 'download client reported an error' },
  Failed: { label: 'Download failed', icon: '❌', hint: 'download client reported an error' },
  ImportFailure: { label: 'Import failed', icon: '📥', hint: 'download completed but could not be imported' },
  ManualInteractionRequired: {
    label: 'Manual action required',
    icon: '✋',
    hint: 'review in the queue — file needs manual handling',
  },
};

export function buildFailureEmbed(i: FailureEmbedInput): EmbedBuilder {
  const serviceLabel = i.service === 'sonarr' ? 'Sonarr' : 'Radarr';
  const meta = FAILURE_LABELS[i.eventType] ?? { label: i.eventType, icon: '⚠️', hint: 'requires attention' };

  const e = new EmbedBuilder()
    .setColor(Colors.danger)
    .setAuthor({ name: `${serviceLabel}  ·  ${meta.label}` })
    .setTitle(`${meta.icon}  ${i.title}`)
    .setDescription(truncate(i.reason ?? 'No reason provided.', 1500))
    .setFooter({ text: `MagguuUI  ·  ${meta.hint}` })
    .setTimestamp(new Date());

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (i.quality) fields.push({ name: 'Quality', value: qualityBadge(i.quality), inline: true });
  if (i.downloadClient) fields.push({ name: 'Download client', value: i.downloadClient, inline: true });
  if (i.releaseTitle) fields.push({ name: 'Release', value: `\`${truncate(i.releaseTitle, 1000)}\``, inline: false });
  if (fields.length) e.addFields(fields);

  return e;
}

export interface AppUpdateEmbedInput {
  service: 'sonarr' | 'radarr';
  previousVersion?: string;
  newVersion?: string;
  message?: string;
}

export function buildAppUpdateEmbed(i: AppUpdateEmbedInput): EmbedBuilder {
  const serviceLabel = i.service === 'sonarr' ? 'Sonarr' : 'Radarr';
  const color = i.service === 'sonarr' ? Colors.sonarr : Colors.radarr;
  const emoji = i.service === 'sonarr' ? '📺' : '🎬';

  const e = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${serviceLabel}  ·  Application updated` })
    .setTitle(`${emoji}  🔄  Neue Version installiert`)
    .setTimestamp(new Date());

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (i.previousVersion) fields.push({ name: 'Vorherige Version', value: `\`${i.previousVersion}\``, inline: true });
  if (i.newVersion) fields.push({ name: 'Neue Version', value: `\`${i.newVersion}\``, inline: true });
  if (fields.length) e.addFields(fields);
  if (i.message) e.setDescription(truncate(i.message, 1500));

  e.setFooter({ text: `MagguuUI  ·  ${serviceLabel} restart empfohlen wenn nötig` });
  return e;
}

export interface DeleteEmbedInput {
  service: 'sonarr' | 'radarr';
  kind: 'series' | 'movie' | 'episodeFile' | 'movieFile';
  title: string;
  year?: number | string;
  reason?: string;
  posterUrl?: string | null;
  episode?: { season: number; number: number; title?: string };
  quality?: string;
  size?: number;
  deletedFiles?: boolean;
}

export function buildDeleteEmbed(i: DeleteEmbedInput): EmbedBuilder {
  const serviceLabel = i.service === 'sonarr' ? 'Sonarr' : 'Radarr';
  const isFileDelete = i.kind === 'episodeFile' || i.kind === 'movieFile';
  const icon = isFileDelete ? '🗂️' : '🗑️';
  const action =
    i.kind === 'series'
      ? 'Serie entfernt'
      : i.kind === 'movie'
        ? 'Film entfernt'
        : i.kind === 'episodeFile'
          ? 'Episode-File gelöscht'
          : 'Movie-File gelöscht';

  const episodeTag =
    i.episode
      ? `  ·  S${String(i.episode.season).padStart(2, '0')}E${String(i.episode.number).padStart(2, '0')}`
      : '';
  const yearTag = i.year ? `  ·  ${i.year}` : '';

  const e = new EmbedBuilder()
    .setColor(Colors.muted)
    .setAuthor({ name: `${serviceLabel}  ·  ${action}` })
    .setTitle(`${icon}  ${i.title}${yearTag}${episodeTag}`)
    .setTimestamp(new Date());

  if (i.posterUrl) e.setThumbnail(i.posterUrl);
  if (i.episode?.title) e.setDescription(truncate(i.episode.title, 400));

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (i.quality) fields.push({ name: 'Quality', value: qualityBadge(i.quality), inline: true });
  if (i.size) fields.push({ name: 'Size', value: formatBytes(i.size), inline: true });
  if (i.reason) fields.push({ name: 'Grund', value: truncate(i.reason, 1000), inline: false });
  if (fields.length) e.addFields(fields);

  const footerHint = isFileDelete
    ? 'File aus der Library entfernt'
    : i.deletedFiles
      ? 'inkl. Files auf Disk'
      : 'nur aus der Library entfernt';
  e.setFooter({ text: `MagguuUI  ·  ${footerHint}` });
  return e;
}

export interface HealthEmbedInput {
  service: string;
  level: 'ok' | 'warning' | 'error';
  message: string;
  type?: string;
}

export function buildHealthEmbed(i: HealthEmbedInput): EmbedBuilder {
  const color = i.level === 'error' ? Colors.danger : i.level === 'warning' ? Colors.warn : Colors.success;
  const icon = i.level === 'error' ? '🔴' : i.level === 'warning' ? '🟡' : '🟢';
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${i.service}  ·  Health` })
    .setTitle(`${icon}  ${i.type ?? i.level.toUpperCase()}`)
    .setDescription(truncate(i.message, 1500))
    .setTimestamp(new Date());
}
