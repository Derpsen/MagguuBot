import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { getTicketCategory } from '../ticket-categories.js';

export async function handleTicketCategorySelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const value = interaction.values[0];
  if (!value) {
    await interaction.reply({ content: 'Keine Kategorie gewählt.', flags: MessageFlags.Ephemeral });
    return;
  }
  const category = getTicketCategory(value);
  if (!category) {
    await interaction.reply({
      content: `Kategorie **${value}** nicht gefunden.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`ticket-modal:${category.key}`)
    .setTitle(`${category.emoji} ${category.label}`.slice(0, 45));

  const topicInput = new TextInputBuilder()
    .setCustomId('topic')
    .setLabel('Worum gehts? (kurz)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100)
    .setPlaceholder('z.B. "Plex buffert seit gestern"');

  const detailsInput = new TextInputBuilder()
    .setCustomId('details')
    .setLabel('Details (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(2000)
    .setPlaceholder('Beschreib das Problem so genau wie du kannst — was hast du versucht, was hast du gesehen?');

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(topicInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(detailsInput),
  );

  await interaction.showModal(modal);
}
