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
  if (i.quality) fields.push({ name: 'Quality', value: i.quality, inline: true });
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
  if (i.quality) fields.push({ name: 'Quality', value: i.quality, inline: true });
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
}

export function buildFailureEmbed(i: FailureEmbedInput): EmbedBuilder {
  const serviceLabel = i.service === 'sonarr' ? 'Sonarr' : 'Radarr';
  return new EmbedBuilder()
    .setColor(Colors.danger)
    .setAuthor({ name: `${serviceLabel}  ·  ${i.eventType}` })
    .setTitle(`⚠️  ${i.title}`)
    .setDescription(truncate(i.reason ?? 'No reason provided.', 1500))
    .setFooter({ text: 'MagguuUI  ·  requires attention' })
    .setTimestamp(new Date());
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
