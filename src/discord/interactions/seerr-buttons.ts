import { MessageFlags, PermissionFlagsBits, type ButtonInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { seerrRequests } from '../../db/schema.js';
import { buildSeerrApprovalButtons } from '../../embeds/seerr.js';
import { isAdmin } from '../../server/auth/middleware.js';
import { approveSeerrRequest, declineSeerrRequest, SeerrRequestError } from '../../services/seerr.js';
import { logger } from '../../utils/logger.js';

function canModerateSeerr(interaction: ButtonInteraction): boolean {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator))
    || isAdmin(interaction.user.id);
}

function seerrButtonErrorMessage(action: string, requestId: number, err: unknown): string {
  if (err instanceof SeerrRequestError && (err.status === 401 || err.status === 403)) {
    return 'Seerr hat den API-Key abgelehnt. In Seerr unter Settings → General den API-Key kopieren und in MagguuBot als SEERR_API_KEY setzen.';
  }
  if (err instanceof SeerrRequestError) {
    return `Seerr hat ${action === 'approve' ? 'Approve' : 'Decline'} für #${requestId} mit HTTP ${err.status} abgelehnt.`;
  }
  return `Request #${requestId} konnte nicht ${action === 'approve' ? 'angenommen' : 'abgelehnt'} werden.`;
}

export async function handleSeerrButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, idRaw] = interaction.customId.split(':');
  const requestId = Number(idRaw);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    await interaction.reply({ content: 'Ungültige Anfrage-ID.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!canModerateSeerr(interaction)) {
    await interaction.reply({ content: 'Nur Administratoren können Anfragen annehmen oder ablehnen.', flags: MessageFlags.Ephemeral });
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
      await interaction.followUp({ content: 'Unbekannte Aktion.', flags: MessageFlags.Ephemeral });
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
      content: seerrButtonErrorMessage(action ?? '', requestId, err),
      flags: MessageFlags.Ephemeral,
    });
  }
}
