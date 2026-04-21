import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { Colors, truncate } from './colors.js';

export type SeerrRequestStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'available'
  | 'failed'
  | 'deleted';

export interface SeerrRequestEmbedInput {
  requestId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year?: string | number;
  overview?: string;
  posterUrl?: string | null;
  requestedBy?: string;
  status: SeerrRequestStatus;
}

const STATUS_META: Record<
  SeerrRequestStatus,
  { label: string; color: number; footerHint: string }
> = {
  pending: {
    label: '⏳ Pending approval',
    color: Colors.seerr,
    footerHint: 'Seerr request',
  },
  approved: {
    label: '✅ Approved',
    color: Colors.success,
    footerHint: 'request approved — download wird gestartet',
  },
  declined: {
    label: '❌ Declined',
    color: Colors.danger,
    footerHint: 'request abgelehnt',
  },
  available: {
    label: '🎉 Available',
    color: Colors.success,
    footerHint: 'jetzt auf Plex verfügbar',
  },
  failed: {
    label: '💥 Failed',
    color: Colors.danger,
    footerHint: 'request konnte nicht ausgeliefert werden — bitte bei einem Admin melden',
  },
  deleted: {
    label: '🗑️ Deleted',
    color: Colors.muted,
    footerHint: 'request wurde entfernt',
  },
};

export function buildSeerrRequestEmbed(i: SeerrRequestEmbedInput): EmbedBuilder {
  const meta = STATUS_META[i.status];
  const emoji = i.mediaType === 'movie' ? '🎬' : '📺';
  const yearTag = i.year ? `  ·  ${i.year}` : '';

  const e = new EmbedBuilder()
    .setColor(meta.color)
    .setAuthor({ name: `Seerr  ·  Request #${i.requestId}` })
    .setTitle(`${emoji}  ${i.title}${yearTag}`)
    .setTimestamp(new Date());

  if (i.overview) e.setDescription(truncate(i.overview, 600));
  if (i.posterUrl) e.setThumbnail(i.posterUrl);

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: 'Status', value: meta.label, inline: true },
    { name: 'Type', value: i.mediaType === 'movie' ? 'Movie' : 'TV Show', inline: true },
  ];
  if (i.requestedBy) fields.push({ name: 'Requested by', value: i.requestedBy, inline: true });
  e.addFields(fields);

  e.setFooter({ text: `MagguuUI  ·  ${meta.footerHint}` });
  return e;
}

export function buildSeerrApprovalButtons(requestId: number, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`seerr:approve:${requestId}`)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`seerr:decline:${requestId}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

export type SeerrIssueType = 'VIDEO' | 'AUDIO' | 'SUBTITLES' | 'OTHER';
export type SeerrIssueNotification =
  | 'ISSUE_CREATED'
  | 'ISSUE_COMMENT'
  | 'ISSUE_REOPENED'
  | 'ISSUE_RESOLVED';

export interface SeerrIssueEmbedInput {
  notification: SeerrIssueNotification;
  issueId?: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year?: string | number;
  issueType?: SeerrIssueType | string;
  issueStatus?: 'OPEN' | 'RESOLVED' | string;
  message?: string;
  posterUrl?: string | null;
  reportedBy?: string;
  commentedBy?: string;
  reporterDiscordId?: string;
  commenterDiscordId?: string;
}

const ISSUE_NOTIFICATION_META: Record<
  SeerrIssueNotification,
  { label: string; color: number; icon: string; footerHint: string }
> = {
  ISSUE_CREATED: {
    label: 'Neues Issue',
    color: Colors.danger,
    icon: '🐛',
    footerHint: 'bitte prüfen',
  },
  ISSUE_COMMENT: {
    label: 'Neuer Kommentar',
    color: Colors.info,
    icon: '💬',
    footerHint: 'Kommentar zu bestehendem Issue',
  },
  ISSUE_REOPENED: {
    label: 'Issue wieder geöffnet',
    color: Colors.warn,
    icon: '🔁',
    footerHint: 'Problem tritt erneut auf',
  },
  ISSUE_RESOLVED: {
    label: 'Issue gelöst',
    color: Colors.success,
    icon: '✅',
    footerHint: 'Issue geschlossen',
  },
};

const ISSUE_TYPE_EMOJI: Record<string, string> = {
  VIDEO: '🎞️',
  AUDIO: '🔊',
  SUBTITLES: '💬',
  OTHER: '❓',
};

export function buildSeerrIssueEmbed(i: SeerrIssueEmbedInput): EmbedBuilder {
  const meta = ISSUE_NOTIFICATION_META[i.notification];
  const mediaEmoji = i.mediaType === 'movie' ? '🎬' : '📺';
  const yearTag = i.year ? `  ·  ${i.year}` : '';
  const issueRef = i.issueId ? `  ·  Issue #${i.issueId}` : '';

  const e = new EmbedBuilder()
    .setColor(meta.color)
    .setAuthor({ name: `Seerr  ·  ${meta.label}${issueRef}` })
    .setTitle(`${meta.icon}  ${mediaEmoji}  ${i.title}${yearTag}`)
    .setTimestamp(new Date());

  if (i.message) e.setDescription(truncate(i.message, 1500));
  if (i.posterUrl) e.setThumbnail(i.posterUrl);

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (i.issueType) {
    const icon = ISSUE_TYPE_EMOJI[i.issueType] ?? '❓';
    fields.push({ name: 'Typ', value: `${icon} ${i.issueType}`, inline: true });
  }
  if (i.issueStatus) {
    const icon = i.issueStatus === 'RESOLVED' ? '🟢' : '🔴';
    fields.push({ name: 'Status', value: `${icon} ${i.issueStatus}`, inline: true });
  }
  if (i.reportedBy) {
    const mention = i.reporterDiscordId ? `<@${i.reporterDiscordId}>` : i.reportedBy;
    fields.push({ name: 'Gemeldet von', value: mention, inline: true });
  }
  if (i.commentedBy && i.notification === 'ISSUE_COMMENT') {
    const mention = i.commenterDiscordId ? `<@${i.commenterDiscordId}>` : i.commentedBy;
    fields.push({ name: 'Kommentar von', value: mention, inline: true });
  }
  if (fields.length) e.addFields(fields);

  e.setFooter({ text: `MagguuUI  ·  ${meta.footerHint}` });
  return e;
}
