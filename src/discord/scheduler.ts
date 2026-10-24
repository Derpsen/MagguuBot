import { EmbedBuilder, type TextChannel } from 'discord.js';
import { and, eq, lte } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { reminders, scheduledAnnouncements } from '../db/schema.js';
import { Colors, truncate } from '../embeds/colors.js';
import { logger } from '../utils/logger.js';
import { nextReminderRetryAt } from '../utils/schedule.js';
import { tickBirthdays } from './birthday.js';
import { recoverAntiRaidProtection } from './anti-raid.js';
import { runAddonReleasePollTick } from './addon-release-poller.js';
import { runBlueTrackerTick } from './blue-tracker.js';
import { refreshWebsiteFaqCache } from './faq-autoanswer.js';
import { updateChannelTopics } from './channel-topics.js';
import { tickCountdowns } from './countdown-ticker.js';
import { getClient } from './client.js';
import { tickGiveaways } from './giveaway.js';
import { runRssFeedTick } from './rss-manager.js';
import { tickTicketAutoClose } from './ticket-autoclose.js';
import { runWeeklyDigestTick } from './weekly-digest.js';
import { tickMovieNights } from './movie-night.js';
import { runDownloadLiveTick } from './download-live.js';
import { runAutomaticBackupTick } from './automatic-backup.js';
import { runPlexActivityCleanupTick } from './plex-activity-cleanup.js';
import { runPlexPauseFlushTick } from './plex-activity-pause.js';
import { runPlexCardTick } from './plex-card.js';
import { runRaidReminderTick } from './raid-reminders.js';
import { runPlexNewDigestTick } from './plex-new-digest.js';
import { plexWeeklyNextRun, runPlexWeeklyTick } from './plex-weekly.js';
import { runPlexStaleSessionTick } from './plex-stale-sessions.js';
import { runDailySelfCheckTick } from './self-check.js';
import { runWebhookRetryTick } from '../server/webhook-retry.js';

const REMINDER_TICK_MS = 30_000;
const RAID_REMINDER_TICK_MS = 30_000;
const ANNOUNCE_TICK_MS = 30_000;
const BLUE_TRACKER_TICK_MS = 15 * 60_000;
const WEBSITE_FAQ_TICK_MS = 60 * 60_000;
// Checks often; channel-topics.ts itself limits PATCHes per channel (Discord: 2 topic edits / 10 min).
const TOPICS_TICK_MS = 2 * 60_000;
const COUNTDOWN_TICK_MS = 60_000;
const RSS_TICK_MS = 15 * 60_000;
const GIVEAWAY_TICK_MS = 30_000;
const BIRTHDAY_TICK_MS = 15 * 60_000;
const TICKET_AUTOCLOSE_TICK_MS = 30 * 60_000;
const WEEKLY_DIGEST_TICK_MS = 60 * 60_000;
const MOVIE_NIGHT_TICK_MS = 60_000;
const DOWNLOAD_LIVE_TICK_MS = 60_000;
const AUTOMATIC_BACKUP_TICK_MS = 60 * 60_000;
const WEBHOOK_RETRY_TICK_MS = 60_000;
const PLEX_ACTIVITY_CLEANUP_TICK_MS = 60 * 60_000;
const PLEX_PAUSE_FLUSH_TICK_MS = 30_000;
const PLEX_CARD_TICK_MS = 30_000;
const PLEX_WEEKLY_TICK_MS = 30 * 60_000;
/** Well below the 15 minute catch-up window of the new-added digest, so a transient failure is retried. */
const PLEX_NEW_DIGEST_TICK_MS = 5 * 60_000;
const PLEX_STALE_SESSION_TICK_MS = 60_000;
const SELF_CHECK_TICK_MS = 60 * 60_000;

let remindersTimer: NodeJS.Timeout | null = null;
let raidReminderTimer: NodeJS.Timeout | null = null;
let announceTimer: NodeJS.Timeout | null = null;
let blueTrackerTimer: NodeJS.Timeout | null = null;
let addonReleaseTimer: NodeJS.Timeout | null = null;
let websiteFaqTimer: NodeJS.Timeout | null = null;
let topicsTimer: NodeJS.Timeout | null = null;
let countdownTimer: NodeJS.Timeout | null = null;
let rssTimer: NodeJS.Timeout | null = null;
let giveawayTimer: NodeJS.Timeout | null = null;
let birthdayTimer: NodeJS.Timeout | null = null;
let ticketAutoCloseTimer: NodeJS.Timeout | null = null;
let weeklyDigestTimer: NodeJS.Timeout | null = null;
let movieNightTimer: NodeJS.Timeout | null = null;
let downloadLiveTimer: NodeJS.Timeout | null = null;
let automaticBackupTimer: NodeJS.Timeout | null = null;
let webhookRetryTimer: NodeJS.Timeout | null = null;
let plexActivityCleanupTimer: NodeJS.Timeout | null = null;
let plexPauseFlushTimer: NodeJS.Timeout | null = null;
let plexCardTimer: NodeJS.Timeout | null = null;
let plexWeeklyTimer: NodeJS.Timeout | null = null;
let plexNewDigestTimer: NodeJS.Timeout | null = null;
let plexStaleSessionTimer: NodeJS.Timeout | null = null;
let selfCheckTimer: NodeJS.Timeout | null = null;
const activeTicks = new Set<string>();

export function startScheduler(): void {
  if (remindersTimer) {
    logger.warn('scheduler already running');
    return;
  }
  remindersTimer = setInterval(() => {
    runTick('reminders', processDueReminders, 'reminder tick failed');
  }, REMINDER_TICK_MS);

  raidReminderTimer = setInterval(() => {
    runTick('raid-reminders', runRaidReminderTick, 'raid reminder tick failed');
  }, RAID_REMINDER_TICK_MS);

  announceTimer = setInterval(() => {
    runTick('announcements', processDueAnnouncements, 'announce tick failed');
  }, ANNOUNCE_TICK_MS);

  if (config.WOW_BLUE_TRACKER_URL) {
    blueTrackerTimer = setInterval(() => {
      runTick('blue-tracker', runBlueTrackerTick, 'blue-tracker tick failed');
    }, BLUE_TRACKER_TICK_MS);
  }

  const addonReleasePollEnabled = Boolean(config.MAGGUUUI_READ_TOKEN) && config.ADDON_RELEASE_POLL_MINUTES > 0;
  if (addonReleasePollEnabled) {
    addonReleaseTimer = setInterval(() => {
      runTick('addon-release', runAddonReleasePollTick, 'addon release poll tick failed');
    }, config.ADDON_RELEASE_POLL_MINUTES * 60_000);
  }

  // Always on: the cache also serves /faq autocomplete (public GET, once per hour).
  websiteFaqTimer = setInterval(() => {
    runTick('website-faq', refreshWebsiteFaqCache, 'website FAQ refresh failed');
  }, WEBSITE_FAQ_TICK_MS);

  topicsTimer = setInterval(() => {
    runTick('topics', updateChannelTopics, 'topics tick failed');
  }, TOPICS_TICK_MS);

  countdownTimer = setInterval(() => {
    runTick('countdowns', tickCountdowns, 'countdown tick failed');
  }, COUNTDOWN_TICK_MS);

  rssTimer = setInterval(() => {
    runTick('rss', runRssFeedTick, 'rss feed tick failed');
  }, RSS_TICK_MS);

  giveawayTimer = setInterval(() => {
    runTick('giveaways', tickGiveaways, 'giveaway tick failed');
  }, GIVEAWAY_TICK_MS);

  birthdayTimer = setInterval(() => {
    runTick('birthdays', tickBirthdays, 'birthday tick failed');
  }, BIRTHDAY_TICK_MS);

  ticketAutoCloseTimer = setInterval(() => {
    runTick('ticket-autoclose', tickTicketAutoClose, 'ticket autoclose tick failed');
  }, TICKET_AUTOCLOSE_TICK_MS);

  weeklyDigestTimer = setInterval(() => {
    runTick('weekly-digest', runWeeklyDigestTick, 'weekly digest tick failed');
  }, WEEKLY_DIGEST_TICK_MS);

  movieNightTimer = setInterval(() => {
    runTick('movie-night', tickMovieNights, 'movie night tick failed');
  }, MOVIE_NIGHT_TICK_MS);

  downloadLiveTimer = setInterval(() => {
    runTick('download-live', runDownloadLiveTick, 'download live tick failed');
  }, DOWNLOAD_LIVE_TICK_MS);

  automaticBackupTimer = setInterval(() => {
    runTick('automatic-backup', runAutomaticBackupTick, 'automatic backup tick failed');
  }, AUTOMATIC_BACKUP_TICK_MS);

  webhookRetryTimer = setInterval(() => {
    runTick('webhook-retry', runWebhookRetryTick, 'webhook retry tick failed');
  }, WEBHOOK_RETRY_TICK_MS);

  plexActivityCleanupTimer = setInterval(() => {
    runTick('plex-activity-cleanup', runPlexActivityCleanupTick, 'Plex activity cleanup tick failed');
  }, PLEX_ACTIVITY_CLEANUP_TICK_MS);

  plexPauseFlushTimer = setInterval(() => {
    runTick('plex-pause-flush', runPlexPauseFlushTick, 'Plex pause flush tick failed');
  }, PLEX_PAUSE_FLUSH_TICK_MS);

  plexCardTimer = setInterval(() => {
    runTick('plex-card', runPlexCardTick, 'Plex card tick failed');
  }, PLEX_CARD_TICK_MS);

  plexWeeklyTimer = setInterval(() => {
    runTick('plex-weekly', () => runPlexWeeklyTick(), 'Plex weekly card tick failed');
  }, PLEX_WEEKLY_TICK_MS);

  plexNewDigestTimer = setInterval(() => {
    runTick('plex-new-digest', runPlexNewDigestTick, 'Plex new-added digest tick failed');
  }, PLEX_NEW_DIGEST_TICK_MS);

  plexStaleSessionTimer = setInterval(() => {
    runTick('plex-stale-sessions', runPlexStaleSessionTick, 'Plex stale session tick failed');
  }, PLEX_STALE_SESSION_TICK_MS);

  selfCheckTimer = setInterval(() => {
    runTick('self-check', () => runDailySelfCheckTick(), 'daily self-check failed');
  }, SELF_CHECK_TICK_MS);

  setImmediate(() => {
    runTick('reminders', processDueReminders, 'reminder boot tick failed');
    runTick('raid-reminders', runRaidReminderTick, 'raid reminder boot tick failed');
    runTick('announcements', processDueAnnouncements, 'announce boot tick failed');
    runTick('topics', updateChannelTopics, 'topics boot tick failed');
    runTick('countdowns', tickCountdowns, 'countdown boot tick failed');
    runTick('rss', runRssFeedTick, 'rss boot tick failed');
    runTick('giveaways', tickGiveaways, 'giveaway boot tick failed');
    runTick('birthdays', tickBirthdays, 'birthday boot tick failed');
    runTick('anti-raid-recovery', recoverAntiRaidProtection, 'anti-raid recovery failed');
    runTick('weekly-digest', runWeeklyDigestTick, 'weekly digest boot tick failed');
    runTick('movie-night', tickMovieNights, 'movie night boot tick failed');
    runTick('download-live', runDownloadLiveTick, 'download live boot tick failed');
    runTick('automatic-backup', runAutomaticBackupTick, 'automatic backup boot tick failed');
    runTick('webhook-retry', runWebhookRetryTick, 'webhook retry boot tick failed');
    runTick('plex-activity-cleanup', runPlexActivityCleanupTick, 'Plex activity cleanup boot tick failed');
    runTick('plex-pause-flush', runPlexPauseFlushTick, 'Plex pause flush boot tick failed');
    runTick('plex-card', runPlexCardTick, 'Plex card boot tick failed');
    runTick('plex-stale-sessions', runPlexStaleSessionTick, 'Plex stale session boot tick failed');
    runTick('plex-weekly', () => runPlexWeeklyTick(), 'Plex weekly card boot tick failed');
    runTick('plex-new-digest', runPlexNewDigestTick, 'Plex new-added digest boot tick failed');
    if (config.WOW_BLUE_TRACKER_URL) {
      runTick('blue-tracker', runBlueTrackerTick, 'blue-tracker boot tick failed');
    }
    if (addonReleasePollEnabled) {
      runTick('addon-release', runAddonReleasePollTick, 'addon release poll boot tick failed');
    }
    runTick('website-faq', refreshWebsiteFaqCache, 'website FAQ boot refresh failed');
  });

  logger.info(
    {
      reminderMs: REMINDER_TICK_MS,
      raidReminderMs: RAID_REMINDER_TICK_MS,
      announceMs: ANNOUNCE_TICK_MS,
      topicsMs: TOPICS_TICK_MS,
      countdownMs: COUNTDOWN_TICK_MS,
      rssMs: RSS_TICK_MS,
      giveawayMs: GIVEAWAY_TICK_MS,
      birthdayMs: BIRTHDAY_TICK_MS,
      ticketAutoCloseMs: TICKET_AUTOCLOSE_TICK_MS,
      blueTrackerMs: config.WOW_BLUE_TRACKER_URL ? BLUE_TRACKER_TICK_MS : 'disabled',
      addonReleasePollMs: addonReleasePollEnabled ? config.ADDON_RELEASE_POLL_MINUTES * 60_000 : 'disabled',
      weeklyDigestMs: config.WEEKLY_DIGEST_ENABLED ? WEEKLY_DIGEST_TICK_MS : 'disabled',
      movieNightMs: MOVIE_NIGHT_TICK_MS,
      downloadLiveMs: DOWNLOAD_LIVE_TICK_MS,
      automaticBackupMs: config.AUTOMATIC_BACKUP_ENABLED ? AUTOMATIC_BACKUP_TICK_MS : 'disabled',
      webhookRetryMs: config.WEBHOOK_RETRY_ENABLED ? WEBHOOK_RETRY_TICK_MS : 'disabled',
      plexActivityCleanupMs: config.PLEX_ACTIVITY_RETENTION_DAYS > 0 ? PLEX_ACTIVITY_CLEANUP_TICK_MS : 'disabled',
      plexPauseFlushMs: PLEX_PAUSE_FLUSH_TICK_MS,
      plexCardMs: PLEX_CARD_TICK_MS,
      plexWeeklyMs: config.PLEX_WEEKLY_ENABLED ? PLEX_WEEKLY_TICK_MS : 'disabled',
      plexNewDigestMs: config.PLEX_NEW_DIGEST_ENABLED ? PLEX_NEW_DIGEST_TICK_MS : 'disabled',
      plexWeeklyNext: config.PLEX_WEEKLY_ENABLED ? plexWeeklyNextRun()?.toISOString() : 'disabled',
      plexStaleSessionMs: config.PLEX_STALE_SESSION_MINUTES > 0 ? PLEX_STALE_SESSION_TICK_MS : 'disabled',
    },
    'scheduler started',
  );
}

function runTick(key: string, task: () => Promise<void>, failureMessage: string): void {
  if (activeTicks.has(key)) {
    logger.warn({ tick: key }, 'scheduler tick still running, skipping overlap');
    return;
  }
  activeTicks.add(key);
  void task()
    .catch((err) => logger.error({ err }, failureMessage))
    .finally(() => activeTicks.delete(key));
}

export function stopScheduler(): void {
  if (remindersTimer) clearInterval(remindersTimer);
  if (raidReminderTimer) clearInterval(raidReminderTimer);
  if (announceTimer) clearInterval(announceTimer);
  if (blueTrackerTimer) clearInterval(blueTrackerTimer);
  if (addonReleaseTimer) clearInterval(addonReleaseTimer);
  if (websiteFaqTimer) clearInterval(websiteFaqTimer);
  if (topicsTimer) clearInterval(topicsTimer);
  if (countdownTimer) clearInterval(countdownTimer);
  if (rssTimer) clearInterval(rssTimer);
  if (giveawayTimer) clearInterval(giveawayTimer);
  if (birthdayTimer) clearInterval(birthdayTimer);
  if (ticketAutoCloseTimer) clearInterval(ticketAutoCloseTimer);
  if (weeklyDigestTimer) clearInterval(weeklyDigestTimer);
  if (movieNightTimer) clearInterval(movieNightTimer);
  if (downloadLiveTimer) clearInterval(downloadLiveTimer);
  if (automaticBackupTimer) clearInterval(automaticBackupTimer);
  if (webhookRetryTimer) clearInterval(webhookRetryTimer);
  if (plexActivityCleanupTimer) clearInterval(plexActivityCleanupTimer);
  if (plexPauseFlushTimer) clearInterval(plexPauseFlushTimer);
  if (plexCardTimer) clearInterval(plexCardTimer);
  if (plexWeeklyTimer) clearInterval(plexWeeklyTimer);
  if (plexNewDigestTimer) clearInterval(plexNewDigestTimer);
  if (plexStaleSessionTimer) clearInterval(plexStaleSessionTimer);
  if (selfCheckTimer) clearInterval(selfCheckTimer);
  remindersTimer = null;
  raidReminderTimer = null;
  announceTimer = null;
  blueTrackerTimer = null;
  addonReleaseTimer = null;
  websiteFaqTimer = null;
  topicsTimer = null;
  countdownTimer = null;
  rssTimer = null;
  giveawayTimer = null;
  birthdayTimer = null;
  ticketAutoCloseTimer = null;
  weeklyDigestTimer = null;
  movieNightTimer = null;
  downloadLiveTimer = null;
  automaticBackupTimer = null;
  webhookRetryTimer = null;
  plexActivityCleanupTimer = null;
  plexPauseFlushTimer = null;
  plexCardTimer = null;
  plexWeeklyTimer = null;
  plexNewDigestTimer = null;
  plexStaleSessionTimer = null;
  selfCheckTimer = null;
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
      if (!channel?.isSendable()) {
        throw new Error(`scheduled announcement channel ${a.channelId} is unavailable`);
      }
      const recurringFooter = a.recurrence !== 'none' ? `Scheduled · wiederholt ${a.recurrence}` : 'Scheduled announcement';
      const embed = new EmbedBuilder()
        .setColor(COLOR_MAP[a.color] ?? Colors.brand)
        .setTitle(truncate(a.title, 256))
        .setDescription(truncate(a.message, 4000))
        .setFooter({ text: recurringFooter })
        .setTimestamp(new Date());
      await channel.send({ embeds: [embed] });

      if (a.recurrence === 'none') {
        db.update(scheduledAnnouncements)
          .set({ fired: true, lastFiredAt: now })
          .where(eq(scheduledAnnouncements.id, a.id))
          .run();
      } else {
        const next = computeNextFireAt(a.fireAt, a.recurrence, now);
        db.update(scheduledAnnouncements)
          .set({ fireAt: next, lastFiredAt: now, fired: false })
          .where(eq(scheduledAnnouncements.id, a.id))
          .run();
      }
      logger.info({ announceId: a.id, recurrence: a.recurrence }, 'scheduled announcement fired');
    } catch (err) {
      logger.error({ err, announceId: a.id }, 'announce delivery failed');
    }
  }
}

function computeNextFireAt(currentFireAt: Date, recurrence: 'daily' | 'weekly' | 'monthly' | string, now: Date): Date {
  const next = new Date(currentFireAt.getTime());
  // Advance until strictly in the future to handle missed ticks (e.g. bot was offline)
  do {
    if (recurrence === 'daily') {
      next.setDate(next.getDate() + 1);
    } else if (recurrence === 'weekly') {
      next.setDate(next.getDate() + 7);
    } else if (recurrence === 'monthly') {
      next.setMonth(next.getMonth() + 1);
    } else {
      // unknown recurrence — treat as one-shot
      return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    }
  } while (next.getTime() <= now.getTime());
  return next;
}

async function processDueReminders(): Promise<void> {
  const now = new Date();
  const due = db.select().from(reminders).where(lte(reminders.dueAt, now)).all();
  if (due.length === 0) return;

  const client = getClient();

  for (const r of due) {
    let delivered = false;
    try {
      const user = await client.users.fetch(r.userId);
      const embed = new EmbedBuilder()
        .setColor(Colors.info)
        .setTitle('⏰ Reminder')
        .setDescription(truncate(r.message, 3000))
        .setFooter({ text: `gesetzt am ${r.createdAt.toLocaleString('de-DE')}` })
        .setTimestamp(new Date());

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
                allowedMentions: { users: [r.userId] },
              });
              delivered = true;
            }
          }
        }
      }

      if (!delivered) logger.warn({ reminderId: r.id, attempts: r.attempts }, 'could not deliver reminder');
    } catch (err) {
      logger.error({ err, reminderId: r.id }, 'reminder delivery error');
    }

    if (delivered) {
      db.delete(reminders).where(eq(reminders.id, r.id)).run();
      continue;
    }

    const retryAt = nextReminderRetryAt(r.attempts, now);
    if (!retryAt) {
      db.delete(reminders).where(eq(reminders.id, r.id)).run();
      logger.error({ reminderId: r.id, attempts: r.attempts + 1 }, 'reminder abandoned after repeated delivery failures');
      continue;
    }
    db.update(reminders)
      .set({ attempts: r.attempts + 1, dueAt: retryAt })
      .where(eq(reminders.id, r.id))
      .run();
  }
}
