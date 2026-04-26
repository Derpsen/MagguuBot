import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { suggestions } from '../../db/schema.js';
import { buildSuggestionButtons, buildSuggestionEmbed, type SuggestionStatus } from '../../embeds/suggestion.js';
import { logger } from '../../utils/logger.js';

export async function handleSuggestionButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, idStr] = interaction.customId.split(':');
  const id = Number(idStr);
  if (!Number.isFinite(id) || (action !== 'up' && action !== 'down')) {
    await interaction.reply({ content: 'Unbekannte Aktion.', flags: MessageFlags.Ephemeral });
    return;
  }
  const row = db.select().from(suggestions).where(eq(suggestions.id, id)).get();
  if (!row) {
    await interaction.reply({ content: 'Vorschlag nicht gefunden.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (row.status === 'accepted' || row.status === 'denied') {
    await interaction.reply({
      content: 'Voting für diesen Vorschlag ist geschlossen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (interaction.user.id === row.authorId) {
    await interaction.reply({
      content: 'Du kannst nicht für deinen eigenen Vorschlag voten.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const userId = interaction.user.id;
  const upvoters = new Set(row.upvoters);
  const downvoters = new Set(row.downvoters);

  let action_taken: 'added' | 'switched' | 'removed';
  if (action === 'up') {
    if (upvoters.has(userId)) {
      upvoters.delete(userId);
      action_taken = 'removed';
    } else {
      upvoters.add(userId);
      downvoters.delete(userId);
      action_taken = downvoters.has(userId) ? 'switched' : 'added';
    }
  } else {
    if (downvoters.has(userId)) {
      downvoters.delete(userId);
      action_taken = 'removed';
    } else {
      downvoters.add(userId);
      upvoters.delete(userId);
      action_taken = upvoters.has(userId) ? 'switched' : 'added';
    }
  }

  const upArr = Array.from(upvoters);
  const downArr = Array.from(downvoters);

  db.update(suggestions)
    .set({ upvoters: upArr, downvoters: downArr, updatedAt: new Date() })
    .where(eq(suggestions.id, id))
    .run();

  try {
    const author = await interaction.client.users.fetch(row.authorId).catch(() => null);
    const embed = buildSuggestionEmbed({
      id: row.id,
      text: row.text,
      authorTag: author?.username ?? row.authorId,
      authorId: row.authorId,
      authorAvatarUrl: author?.displayAvatarURL() ?? '',
      status: row.status as SuggestionStatus,
      upvotes: upArr.length,
      downvotes: downArr.length,
    });
    await interaction.update({ embeds: [embed], components: [buildSuggestionButtons(row.id)] });
  } catch (err) {
    logger.warn({ err, id }, 'suggestion vote: embed update failed');
    await interaction.reply({
      content: `Vote registriert (${action_taken}), Embed-Update fehlgeschlagen.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
