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

export interface EpisodeRef {
  season: number;
  number: number;
  title?: string;
}

export function formatEpisodeRange(episodes: EpisodeRef[]): string | undefined {
  if (episodes.length === 0) return undefined;
  const sorted = [...episodes].sort((a, b) => a.season - b.season || a.number - b.number);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (sorted.length === 1) return `S${pad(first.season)}E${pad(first.number)}`;
  const sameSeason = first.season === last.season;
  const consecutive = sameSeason && last.number - first.number === sorted.length - 1
    && sorted.every((ep, idx) => ep.season === first.season && ep.number === first.number + idx);
  if (consecutive) return `S${pad(first.season)}E${pad(first.number)}-E${pad(last.number)}`;
  return `S${pad(first.season)}E${pad(first.number)}–S${pad(last.season)}E${pad(last.number)}`;
}

function episodeList(i: { episode?: EpisodeRef; episodes?: EpisodeRef[] }): EpisodeRef[] {
  if (i.episodes?.length) return i.episodes;
  return i.episode ? [i.episode] : [];
}

function episodeTag(episodes: EpisodeRef[]): string {
  const range = formatEpisodeRange(episodes);
  return range ? `  ·  ${range}` : '';
}

function episodeDescription(episodes: EpisodeRef[]): string | undefined {
  const titles = episodes.map((ep) => ep.title?.trim()).filter((title): title is string => Boolean(title));
  if (titles.length === 0) return undefined;
  if (titles.length <= 3) return titles.join(' · ');
  return `${titles.slice(0, 3).join(' · ')} · +${titles.length - 3}`;
}

export interface GrabEmbedInput extends ArrCommon {
  title: string;
  year?: number | string;
  episode?: EpisodeRef;
  episodes?: EpisodeRef[];
}

export function buildGrabEmbed(i: GrabEmbedInput): EmbedBuilder {
  const serviceLabel = i.service === 'sonarr' ? 'Sonarr' : 'Radarr';
  const color = i.service === 'sonarr' ? Colors.sonarr : Colors.radarr;
  const emoji = i.service === 'sonarr' ? '📺' : '🎬';
  const episodes = episodeList(i);
  const yearTag = i.year ? `  ·  ${i.year}` : '';

  const e = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${serviceLabel}  ·  Grabbed` })
    .setTitle(truncate(`${emoji}  ${i.title}${yearTag}${episodeTag(episodes)}`, 256))
    .setTimestamp(new Date());

  if (i.posterUrl) e.setThumbnail(i.posterUrl);
  const description = episodeDescription(episodes);
  if (description) e.setDescription(truncate(description, 400));

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (i.quality) fields.push({ name: 'Quality', value: truncate(qualityBadge(i.quality)), inline: true });
  if (i.size) fields.push({ name: 'Size', value: formatBytes(i.size), inline: true });
  if (i.indexer) fields.push({ name: 'Indexer', value: truncate(i.indexer), inline: true });
  if (i.releaseGroup) fields.push({ name: 'Release Group', value: truncate(i.releaseGroup), inline: true });
  if (i.releaseTitle) fields.push({ name: 'Release', value: `\`${truncate(i.releaseTitle, 1000)}\``, inline: false });
  if (fields.length) e.addFields(fields);

  e.setFooter({ text: 'MagguuUI  ·  download started' });
  return e;
}

export interface ImportEmbedInput extends ArrCommon {
  title: string;
  year?: number | string;
  episode?: EpisodeRef;
  episodes?: EpisodeRef[];
  isUpgrade?: boolean;
}

export function buildImportEmbed(i: ImportEmbedInput): EmbedBuilder {
  const color = i.isUpgrade ? Colors.info : Colors.success;
  const label = i.isUpgrade ? 'Upgraded' : 'Imported';
  const serviceLabel = i.service === 'sonarr' ? 'Sonarr' : 'Radarr';
  const emoji = i.service === 'sonarr' ? '📺' : '🎬';
  const episodes = episodeList(i);
  const yearTag = i.year ? `  ·  ${i.year}` : '';

  const e = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${serviceLabel}  ·  ${label}` })
    .setTitle(truncate(`${emoji}  ${i.title}${yearTag}${episodeTag(episodes)}`, 256))
    .setTimestamp(new Date());

  if (i.posterUrl) e.setThumbnail(i.posterUrl);
  const description = episodeDescription(episodes);
  if (description) e.setDescription(truncate(description, 400));

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (i.quality) fields.push({ name: 'Quality', value: truncate(qualityBadge(i.quality)), inline: true });
  if (i.size) fields.push({ name: 'Size', value: formatBytes(i.size), inline: true });
  if (i.releaseGroup) fields.push({ name: 'Release Group', value: truncate(i.releaseGroup), inline: true });
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
    .setTitle(truncate(`${meta.icon}  ${i.title}`, 256))
    .setDescription(truncate(i.reason ?? 'No reason provided.', 1500))
    .setFooter({ text: `MagguuUI  ·  ${meta.hint}` })
    .setTimestamp(new Date());

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (i.quality) fields.push({ name: 'Quality', value: truncate(qualityBadge(i.quality)), inline: true });
  if (i.downloadClient) fields.push({ name: 'Download client', value: truncate(i.downloadClient), inline: true });
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
  if (i.previousVersion) fields.push({ name: 'Vorherige Version', value: `\`${truncate(i.previousVersion, 1022)}\``, inline: true });
  if (i.newVersion) fields.push({ name: 'Neue Version', value: `\`${truncate(i.newVersion, 1022)}\``, inline: true });
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
  episode?: EpisodeRef;
  episodes?: EpisodeRef[];
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

  const episodes = episodeList(i);
  const yearTag = i.year ? `  ·  ${i.year}` : '';

  const e = new EmbedBuilder()
    .setColor(Colors.muted)
    .setAuthor({ name: `${serviceLabel}  ·  ${action}` })
    .setTitle(truncate(`${icon}  ${i.title}${yearTag}${episodeTag(episodes)}`, 256))
    .setTimestamp(new Date());

  if (i.posterUrl) e.setThumbnail(i.posterUrl);
  const description = episodeDescription(episodes);
  if (description) e.setDescription(truncate(description, 400));

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (i.quality) fields.push({ name: 'Quality', value: truncate(qualityBadge(i.quality)), inline: true });
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
    .setTitle(truncate(`${icon}  ${i.type ?? i.level.toUpperCase()}`, 256))
    .setDescription(truncate(i.message, 1500))
    .setTimestamp(new Date());
}
