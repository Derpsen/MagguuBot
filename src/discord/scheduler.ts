import { EmbedBuilder, type TextChannel } from 'discord.js';
import { and, eq, lte } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { reminders, scheduledAnnouncements } from '../db/schema.js';
import { Colors, truncate } from '../embeds/colors.js';
import { logger } from '../utils/logger.js';
import { runBlueTrackerTick } from './blue-tracker.js';
import { updateChannelTopics } from './channel-topics.js';
import { tickCountdowns } from './countdown-ticker.js';
import { getClient } from './client.js';
import { runRssFeedTick } from './rss-manager.js';
import { updateStatsChannels } from './stats-channels.js';

const REMINDER_TICK_MS = 30_000;
const STATS_TICK_MS = 5 * 60_000;
const ANNOUNCE_TICK_MS = 30_000;
const BLUE_TRACKER_TICK_MS = 15 * 60_000;
const TOPICS_TICK_MS = 5 * 60_000;
const COUNTDOWN_TICK_MS = 60_000;
const RSS_TICK_MS = 15 * 60_000;

let remindersTimer: NodeJS.Timeout | null = null;
let statsTimer: NodeJS.Timeout | null = null;
let announceTimer: NodeJS.Timeout | null = null;
let blueTrackerTimer: NodeJS.Timeout | null = null;
let topicsTimer: NodeJS.Timeout | null = null;
let countdownTimer: NodeJS.Timeout | null = null;
let rssTimer: NodeJS.Timeout | null = null;

export function startScheduler(): void {
  remindersTimer = setInterval(() => {
    void processDueReminders().catch((err) => logger.error({ err }, 'reminder tick failed'));
  }, REMINDER_TICK_MS);

  statsTimer = setInterval(() => {
    void updateStatsChannels().catch((err) => logger.error({ err }, 'stats tick failed'));
  }, STATS_TICK_MS);

  announceTimer = setInterval(() => {
    void processDueAnnouncements().catch((err) => logger.error({ err }, 'announce tick failed'));
  }, ANNOUNCE_TICK_MS);

  if (config.WOW_BLUE_TRACKER_URL) {
    blueTrackerTimer = setInterval(() => {
      void runBlueTrackerTick().catch((err) => logger.error({ err }, 'blue-tracker tick failed'));
    }, BLUE_TRACKER_TICK_MS);
  }

  topicsTimer = setInterval(() => {
    void updateChannelTopics().catch((err) => logger.error({ err }, 'topics tick failed'));
  }, TOPICS_TICK_MS);

  countdownTimer = setInterval(() => {
    void tickCountdowns().catch((err) => logger.error({ err }, 'countdown tick failed'));
  }, COUNTDOWN_TICK_MS);

  rssTimer = setInterval(() => {
    void runRssFeedTick().catch((err) => logger.error({ err }, 'rss feed tick failed'));
  }, RSS_TICK_MS);

  setImmediate(() => {
    void processDueReminders().catch((err) => logger.error({ err }, 'reminder boot tick failed'));
    void updateStatsChannels().catch((err) => logger.error({ err }, 'stats boot tick failed'));
    void processDueAnnouncements().catch((err) => logger.error({ err }, 'announce boot tick failed'));
    void updateChannelTopics().catch((err) => logger.error({ err }, 'topics boot tick failed'));
    void tickCountdowns().catch((err) => logger.error({ err }, 'countdown boot tick failed'));
    void runRssFeedTick().catch((err) => logger.error({ err }, 'rss boot tick failed'));
    if (config.WOW_BLUE_TRACKER_URL) {
      void runBlueTrackerTick().catch((err) => logger.error({ err }, 'blue-tracker boot tick failed'));
    }
  });

  logger.info(
    {
      reminderMs: REMINDER_TICK_MS,
      statsMs: STATS_TICK_MS,
      announceMs: ANNOUNCE_TICK_MS,
      topicsMs: TOPICS_TICK_MS,
      countdownMs: COUNTDOWN_TICK_MS,
      rssMs: RSS_TICK_MS,
      blueTrackerMs: config.WOW_BLUE_TRACKER_URL ? BLUE_TRACKER_TICK_MS : 'disabled',
    },
    'scheduler started',
  );
}

export function stopScheduler(): void {
  if (remindersTimer) clearInterval(remindersTimer);
  if (statsTimer) clearInterval(statsTimer);
  if (announceTimer) clearInterval(announceTimer);
  if (blueTrackerTimer) clearInterval(blueTrackerTimer);
  if (topicsTimer) clearInterval(topicsTimer);
  if (countdownTimer) clearInterval(countdownTimer);
  if (rssTimer) clearInterval(rssTimer);
  remindersTimer = null;
  statsTimer = null;
  announceTimer = null;
  blueTrackerTimer = null;
  topicsTimer = null;
  countdownTimer = null;
  rssTimer = null;
}

const COLOR_MAP: Record<string, number> = {
  brand: Colors.brand,
  info: Colors.info,
  success: Colors.success,
  warn: Colors.warn,
  danger: Colors.danger,
};

async function processDueAnnouncements(): Promise<void> {
  const now = new Date();
  const due = db
    .select()
    .from(scheduledAnnouncements)
    .where(and(eq(scheduledAnnouncements.fired, false), lte(scheduledAnnouncements.fireAt, now)))
    .all();
  if (due.length === 0) return;

  const client = getClient();
  for (const a of due) {
    try {
      const channel = (await client.channels.fetch(a.channelId).catch(() => null)) as TextChannel | null;
      if (channel?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setColor(COLOR_MAP[a.color] ?? Colors.brand)
          .setTitle(a.title)
          .setDescription(truncate(a.message, 4000))
          .setFooter({ text: 'Scheduled announcement' })
          .setTimestamp(new Date());
        await channel.send({ embeds: [embed] });
      }
      db.update(scheduledAnnouncements)
        .set({ fired: true })
        .where(eq(scheduledAnnouncements.id, a.id))
        .run();
      logger.info({ announceId: a.id }, 'scheduled announcement fired');
    } catch (err) {
      logger.error({ err, announceId: a.id }, 'announce delivery failed');
    }
  }
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
