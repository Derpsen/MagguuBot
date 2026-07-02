import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type TextChannel,
} from 'discord.js';
import { randomInt } from 'node:crypto';
import { and, eq, lte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { giveaways, type Giveaway } from '../db/schema.js';
import { Colors } from '../embeds/colors.js';
import { logger } from '../utils/logger.js';
import { getClient } from './client.js';

export function buildGiveawayEmbed(g: Giveaway, ended: boolean): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(ended ? Colors.muted : 0xff73fa)
    .setTitle(`🎉 ${g.prize}`)
    .setDescription(
      ended
        ? buildEndedDescription(g)
        : [
            `**Klick auf 🎁 um teilzunehmen!**`,
            '',
            `🏆 Gewinner: **${g.winnersCount}**`,
            `⏰ Endet: <t:${Math.floor(g.endsAt.getTime() / 1000)}:R>`,
            `👥 Teilnehmer: **${g.participants.length}**`,
            g.requiredRoleId ? `🔐 Voraussetzung: <@&${g.requiredRoleId}>` : '',
          ]
            .filter(Boolean)
            .join('\n'),
    )
    .setFooter({ text: `Hosted by · Giveaway-ID #${g.id}` })
    .setTimestamp(g.endsAt);
  return e;
}

function buildEndedDescription(g: Giveaway): string {
  if (g.winners.length === 0) return `🎉 Giveaway beendet — niemand hat teilgenommen.`;
  return [
    `🎉 Giveaway beendet!`,
    '',
    `🏆 **Gewinner:** ${g.winners.map((id) => `<@${id}>`).join(', ')}`,
    `👥 Teilnehmer: ${g.participants.length}`,
  ].join('\n');
}

export function buildGiveawayButtons(giveawayId: number, ended: boolean): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:enter:${giveawayId}`)
      .setLabel(ended ? 'Beendet' : 'Teilnehmen')
      .setEmoji('🎁')
      .setStyle(ended ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(ended),
  );
  return row;
}

let activeGiveawayTick: Promise<void> | null = null;

export function tickGiveaways(): Promise<void> {
  if (activeGiveawayTick) return activeGiveawayTick.then(() => tickGiveaways());
  activeGiveawayTick = runGiveawayTick().finally(() => {
    activeGiveawayTick = null;
  });
  return activeGiveawayTick;
}

async function runGiveawayTick(): Promise<void> {
  const now = new Date();
  const due = db
    .select()
    .from(giveaways)
    .where(and(eq(giveaways.ended, false), lte(giveaways.endsAt, now)))
    .all();
  if (due.length === 0) return;

  const client = getClient();
  for (const g of due) {
    try {
      const winners = pickWinners(g.participants, g.winnersCount);
      const ch = (await client.channels.fetch(g.channelId).catch(() => null)) as TextChannel | null;
      if (!ch?.isSendable()) {
        db.update(giveaways).set({ ended: true, winners }).where(eq(giveaways.id, g.id)).run();
        logger.warn({ giveawayId: g.id }, 'giveaway channel unavailable, marking ended');
        continue;
      }
      const updated: Giveaway = { ...g, ended: true, winners };
      const message = await ch.messages.fetch(g.messageId).catch(() => null);
      if (message) {
        await message.edit({
          embeds: [buildGiveawayEmbed(updated, true)],
          components: [buildGiveawayButtons(g.id, true)],
        });
      }
      if (winners.length > 0) {
        await ch.send({
          content: `🎉 Glückwunsch ${winners.map((id) => `<@${id}>`).join(', ')} — ihr habt **${g.prize}** gewonnen!`,
          allowedMentions: { users: winners },
        });
      } else {
        await ch.send({ content: `Keine Teilnehmer beim Giveaway **${g.prize}**.` });
      }
      db.update(giveaways).set({ ended: true, winners }).where(eq(giveaways.id, g.id)).run();
    } catch (err) {
      logger.error({ err, giveawayId: g.id }, 'giveaway end failed');
    }
  }
}

function pickWinners(participants: string[], count: number): string[] {
  const pool = [...new Set(participants)];
  const winners: string[] = [];
  const target = Math.min(count, pool.length);
  while (winners.length < target && pool.length > 0) {
    const idx = randomInt(pool.length);
    const winner = pool.splice(idx, 1)[0];
    if (winner) winners.push(winner);
  }
  return winners;
}
