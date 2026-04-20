import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { seerrRequests } from '../../db/schema.js';
import { buildSeerrApprovalButtons } from '../../embeds/seerr.js';
import { approveSeerrRequest, declineSeerrRequest } from '../../services/seerr.js';
import { logger } from '../../utils/logger.js';

export async function handleSeerrButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, idRaw] = interaction.customId.split(':');
  const requestId = Number(idRaw);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    await interaction.reply({ content: 'Invalid request id.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.memberPermissions?.has('Administrator')) {
    await interaction.reply({ content: 'Only administrators can approve/decline.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();

  try {
    if (action === 'approve') {
      await approveSeerrRequest(requestId);
      db.update(seerrRequests).set({ status: 'approved' }).where(eq(seerrRequests.seerrRequestId, requestId)).run();
    } else if (action === 'decline') {
      await declineSeerrRequest(requestId);
      db.update(seerrRequests).set({ status: 'declined' }).where(eq(seerrRequests.seerrRequestId, requestId)).run();
    } else {
      await interaction.followUp({ content: 'Unknown action.', flags: MessageFlags.Ephemeral });
      return;
    }

    const disabled = buildSeerrApprovalButtons(requestId, true);
    await interaction.editReply({ components: [disabled] });
    await interaction.followUp({
      content: `${action === 'approve' ? '✅ Approved' : '❌ Declined'} request #${requestId}.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    logger.error({ err, requestId, action }, 'seerr button failed');
    await interaction.followUp({
      content: `Failed to ${action} request #${requestId}. Check logs.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
