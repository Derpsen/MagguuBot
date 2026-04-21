import { type TextChannel } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { countdowns } from '../db/schema.js';
import { buildCountdownEmbed, renderTimeLeft } from '../embeds/countdown.js';
import { logger } from '../utils/logger.js';
import { getClient } from './client.js';

export async function tickCountdowns(): Promise<void> {
  const rows = db
    .select()
    .from(countdowns)
    .where(eq(countdowns.finished, false))
    .all();
  if (rows.length === 0) return;

  const client = getClient();

  for (const row of rows) {
    const now = Date.now();
    const msLeft = row.targetAt.getTime() - now;
    const passed = msLeft <= 0;
    const label = passed ? 'expired' : renderTimeLeft(msLeft);

    if (!passed && label === row.lastRenderedLabel) continue;

    try {
      const channel = (await client.channels.fetch(row.channelId).catch(() => null)) as TextChannel | null;
      if (!channel?.isTextBased()) {
        logger.debug({ id: row.id }, 'countdown channel gone, marking finished');
        db.update(countdowns).set({ finished: true }).where(eq(countdowns.id, row.id)).run();
        continue;
      }
      const message = await channel.messages.fetch(row.messageId).catch(() => null);
      if (!message) {
        db.update(countdowns).set({ finished: true }).where(eq(countdowns.id, row.id)).run();
        continue;
      }

      const embed = buildCountdownEmbed({
        title: row.title,
        description: row.description,
        targetAt: row.targetAt,
        finished: passed,
      });
      await message.edit({ embeds: [embed] });

      if (passed) {
        await channel.send(`🎉 **${row.title}** — jetzt!`);
        db.update(countdowns).set({ finished: true }).where(eq(countdowns.id, row.id)).run();
      } else {
        db.update(countdowns)
          .set({ lastRenderedLabel: label })
          .where(and(eq(countdowns.id, row.id)))
          .run();
      }
    } catch (err) {
      logger.warn({ err, id: row.id }, 'countdown tick failed');
    }
  }
}
