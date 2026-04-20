import { EmbedBuilder, type TextChannel } from 'discord.js';
import { eq, lte } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { reminders } from '../db/schema.js';
import { Colors, truncate } from '../embeds/colors.js';
import { logger } from '../utils/logger.js';
import { getClient } from './client.js';
import { updateStatsChannels } from './stats-channels.js';

const REMINDER_TICK_MS = 30_000;
const STATS_TICK_MS = 5 * 60_000;

let remindersTimer: NodeJS.Timeout | null = null;
let statsTimer: NodeJS.Timeout | null = null;

export function startScheduler(): void {
  remindersTimer = setInterval(() => {
    void processDueReminders().catch((err) => logger.error({ err }, 'reminder tick failed'));
  }, REMINDER_TICK_MS);

  statsTimer = setInterval(() => {
    void updateStatsChannels().catch((err) => logger.error({ err }, 'stats tick failed'));
  }, STATS_TICK_MS);

  setImmediate(() => {
    void processDueReminders().catch((err) => logger.error({ err }, 'reminder boot tick failed'));
    void updateStatsChannels().catch((err) => logger.error({ err }, 'stats boot tick failed'));
  });

  logger.info({ reminderMs: REMINDER_TICK_MS, statsMs: STATS_TICK_MS }, 'scheduler started');
}

export function stopScheduler(): void {
  if (remindersTimer) clearInterval(remindersTimer);
  if (statsTimer) clearInterval(statsTimer);
  remindersTimer = null;
  statsTimer = null;
}

async function processDueReminders(): Promise<void> {
  const now = new Date();
  const due = db.select().from(reminders).where(lte(reminders.dueAt, now)).all();
  if (due.length === 0) return;

  const client = getClient();

  for (const r of due) {
    try {
      const user = await client.users.fetch(r.userId);
      const embed = new EmbedBuilder()
        .setColor(Colors.info)
        .setTitle('⏰ Reminder')
        .setDescription(truncate(r.message, 3000))
        .setFooter({ text: `gesetzt am ${r.createdAt.toLocaleString('de-DE')}` })
        .setTimestamp(new Date());

      let delivered = false;
      try {
        await user.send({ embeds: [embed] });
        delivered = true;
      } catch {
        if (r.guildId && r.channelId) {
          const guild = await client.guilds.fetch(config.DISCORD_GUILD_ID).catch(() => null);
          if (guild) {
            const channel = await guild.channels.fetch(r.channelId).catch(() => null);
            if (channel && channel.isSendable()) {
              await (channel as TextChannel).send({
                content: user.toString(),
                embeds: [embed],
              });
              delivered = true;
            }
          }
        }
      }

      if (!delivered) logger.warn({ reminderId: r.id }, 'could not deliver reminder');
    } catch (err) {
      logger.error({ err, reminderId: r.id }, 'reminder delivery error');
    } finally {
      db.delete(reminders).where(eq(reminders.id, r.id)).run();
    }
  }
}
