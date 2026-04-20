import { EmbedBuilder } from 'discord.js';
import { Colors, formatBytes, truncate } from './colors.js';

export type SabEventStatus = 'complete' | 'failed' | 'warning';

export interface SabEventEmbedInput {
  status: SabEventStatus;
  name: string;
  category?: string;
  sizeBytes?: number;
  failMessage?: string;
  storageDir?: string;
}

export function buildSabEventEmbed(i: SabEventEmbedInput): EmbedBuilder {
  const color =
    i.status === 'complete' ? Colors.success : i.status === 'warning' ? Colors.warn : Colors.danger;
  const label =
    i.status === 'complete' ? 'Download complete' : i.status === 'warning' ? 'Warning' : 'Download failed';
  const icon = i.status === 'complete' ? '✅' : i.status === 'warning' ? '⚠️' : '❌';

  const e = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `SABnzbd  ·  ${label}` })
    .setTitle(`${icon}  ${truncate(i.name, 240)}`)
    .setTimestamp(new Date())
    .setFooter({ text: 'MagguuBot  ·  SABnzbd' });

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (i.category) fields.push({ name: 'Category', value: i.category, inline: true });
  if (i.sizeBytes) fields.push({ name: 'Size', value: formatBytes(i.sizeBytes), inline: true });
  if (i.storageDir) fields.push({ name: 'Path', value: `\`${truncate(i.storageDir, 1000)}\``, inline: false });
  if (i.failMessage) fields.push({ name: 'Reason', value: truncate(i.failMessage, 1000), inline: false });
  if (fields.length) e.addFields(fields);

  return e;
}
