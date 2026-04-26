import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { Colors, truncate } from './colors.js';

export type SuggestionStatus = 'open' | 'accepted' | 'denied' | 'in-progress';

const STATUS_META: Record<SuggestionStatus, { label: string; color: number; emoji: string }> = {
  'open': { label: 'Offen', color: Colors.suggestion, emoji: '💡' },
  'accepted': { label: 'Angenommen', color: Colors.success, emoji: '✅' },
  'denied': { label: 'Abgelehnt', color: Colors.danger, emoji: '❌' },
  'in-progress': { label: 'In Arbeit', color: Colors.warn, emoji: '🛠️' },
};

export interface SuggestionEmbedInput {
  id: number;
  text: string;
  authorTag: string;
  authorId: string;
  authorAvatarUrl: string;
  status: SuggestionStatus;
  upvotes: number;
  downvotes: number;
  staffNote?: string;
}

export function buildSuggestionEmbed(i: SuggestionEmbedInput): EmbedBuilder {
  const meta = STATUS_META[i.status];
  const score = i.upvotes - i.downvotes;
  const scoreLabel = score > 0 ? `+${score}` : `${score}`;

  const e = new EmbedBuilder()
    .setColor(meta.color)
    .setAuthor({ name: `${i.authorTag} schlägt vor`, iconURL: i.authorAvatarUrl })
    .setDescription(truncate(i.text, 1800))
    .addFields(
      { name: 'Status', value: `${meta.emoji} ${meta.label}`, inline: true },
      { name: 'Score', value: `**${scoreLabel}**  ·  👍 ${i.upvotes}   👎 ${i.downvotes}`, inline: true },
    )
    .setTimestamp(new Date());

  if (i.staffNote) {
    e.addFields({ name: '📝 Staff-Notiz', value: truncate(i.staffNote, 800) });
  }

  e.setFooter({ text: `Suggestion #${i.id}  ·  ${i.authorId}` });
  return e;
}

export function buildSuggestionButtons(suggestionId: number, locked = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`suggestion:up:${suggestionId}`)
      .setEmoji('👍')
      .setStyle(ButtonStyle.Success)
      .setDisabled(locked),
    new ButtonBuilder()
      .setCustomId(`suggestion:down:${suggestionId}`)
      .setEmoji('👎')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(locked),
  );
}
