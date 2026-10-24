import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { decodeNeuId } from '../../utils/plex-new.js';
import { neuButtonCooldownLeft, plexNewService, renderNeu } from '../plex-new.js';

/** Page buttons of `/neu` (`neu:<page>:<days>:<type>:<userId>`); only the user who ran the command may flip pages. */
export async function handleNeuButton(interaction: ButtonInteraction): Promise<void> {
  const view = decodeNeuId(interaction.customId);
  if (!view) {
    await interaction.reply({ content: 'Diese Schaltfläche wird nicht mehr unterstützt.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (view.userId !== interaction.user.id) {
    await interaction.reply({ content: 'Das ist nicht deine Ansicht. Nutze `/neu` selbst.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  if (neuButtonCooldownLeft(interaction.user.id) > 0) return; // rapid clicks: keep the current page, no new work
  const reply = await renderNeu(plexNewService, view);
  if (!reply.ok) {
    logger.debug({ page: view.page }, '/neu page render failed');
    await interaction.editReply({ content: reply.content, embeds: [], components: [] });
    return;
  }
  await interaction.editReply({ content: '', embeds: reply.embeds, components: reply.components });
}
