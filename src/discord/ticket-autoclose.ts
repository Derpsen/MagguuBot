import { EmbedBuilder, type TextChannel } from 'discord.js';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tickets } from '../db/schema.js';
import { Colors } from '../embeds/colors.js';
import { logger } from '../utils/logger.js';
import { getClient } from './client.js';

const WARN_AFTER_MS = 24 * 60 * 60 * 1000;
const CLOSE_AFTER_MS = 48 * 60 * 60 * 1000;

export async function tickTicketAutoClose(): Promise<void> {
  const now = new Date();
  const warnCutoff = new Date(now.getTime() - WARN_AFTER_MS);
  const closeCutoff = new Date(now.getTime() - CLOSE_AFTER_MS);

  const stale = db
    .select()
    .from(tickets)
    .where(and(isNull(tickets.closedAt), lt(tickets.lastActivityAt, warnCutoff)))
    .all();
  if (stale.length === 0) return;

  const client = getClient();
  for (const ticket of stale) {
    try {
      const channel = (await client.channels.fetch(ticket.channelId).catch(() => null)) as
        | TextChannel
        | null;
      if (!channel?.isSendable()) continue;

      if (ticket.lastActivityAt && ticket.lastActivityAt < closeCutoff) {
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(Colors.muted)
              .setDescription(
                '🕒 Ticket automatisch geschlossen — keine Aktivität seit 48h. Channel wird in 5s gelöscht.',
              ),
          ],
        });
        db.update(tickets)
          .set({ closedAt: now, closeReason: 'auto-close: 48h inactive' })
          .where(eq(tickets.channelId, ticket.channelId))
          .run();
        setTimeout(() => {
          channel.delete('ticket auto-close').catch(() => {});
        }, 5000);
        logger.info({ ticketId: ticket.id }, 'ticket auto-closed');
        continue;
      }

      const recent = await channel.messages.fetch({ limit: 1 }).catch(() => null);
      const lastMsg = recent?.first();
      if (
        lastMsg?.author.bot &&
        lastMsg.embeds.some((embed) => embed.title?.includes('Inaktivitäts-Warnung'))
      ) {
        continue;
      }

      await channel.send({
        content: `<@${ticket.openerId}>`,
        allowedMentions: { users: [ticket.openerId] },
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.warn)
            .setTitle('⏰ Inaktivitäts-Warnung')
            .setDescription(
              'Dieses Ticket war 24h inaktiv. Antworte hier, sonst wird der Channel in 24h automatisch geschlossen.',
            ),
        ],
      });
    } catch (err) {
      logger.error({ err, ticketId: ticket.id }, 'ticket autoclose failed');
    }
  }
}
