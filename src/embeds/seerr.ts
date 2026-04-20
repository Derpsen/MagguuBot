import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { Colors, truncate } from './colors.js';

export interface SeerrRequestEmbedInput {
  requestId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year?: string | number;
  overview?: string;
  posterUrl?: string | null;
  requestedBy?: string;
  status: 'pending' | 'approved' | 'declined';
}

export function buildSeerrRequestEmbed(i: SeerrRequestEmbedInput): EmbedBuilder {
  const color =
    i.status === 'approved' ? Colors.success : i.status === 'declined' ? Colors.danger : Colors.seerr;
  const statusLabel =
    i.status === 'approved' ? '✅ Approved' : i.status === 'declined' ? '❌ Declined' : '⏳ Pending approval';
  const emoji = i.mediaType === 'movie' ? '🎬' : '📺';
  const yearTag = i.year ? `  ·  ${i.year}` : '';

  const e = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `Seerr  ·  Request #${i.requestId}` })
    .setTitle(`${emoji}  ${i.title}${yearTag}`)
    .setTimestamp(new Date());

  if (i.overview) e.setDescription(truncate(i.overview, 600));
  if (i.posterUrl) e.setThumbnail(i.posterUrl);

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: 'Status', value: statusLabel, inline: true },
    { name: 'Type', value: i.mediaType === 'movie' ? 'Movie' : 'TV Show', inline: true },
  ];
  if (i.requestedBy) fields.push({ name: 'Requested by', value: i.requestedBy, inline: true });
  e.addFields(fields);

  e.setFooter({ text: 'MagguuUI  ·  Seerr request' });
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
