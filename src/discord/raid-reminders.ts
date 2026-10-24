import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import type { EmbedBuilder } from 'discord.js';
import { db } from '../db/client.js';
import { raidReminders } from '../db/schema.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { reminderChannelPayload, reminderDmPayload } from '../utils/raid-reminder.js';
import { getClient } from './client.js';
import {
  RaidReminderManager,
  type NewReminder,
  type ReminderGateway,
  type ReminderRow,
  type ReminderStore,
} from './raid-reminder-manager.js';

type Row = typeof raidReminders.$inferSelect;

function toRow(r: Row): ReminderRow {
  return {
    id: r.id,
    guildId: r.guildId,
    userId: r.userId,
    kind: r.kind,
    day: r.day,
    hour: r.hour,
    minute: r.minute,
    text: r.text,
    recurring: r.recurring,
    channelId: r.channelId,
    nextDueAt: r.nextDueAt.getTime(),
    pausedReason: r.pausedReason,
  };
}

export const raidReminderStore: ReminderStore = {
  insert(input: NewReminder, now: number) {
    const row = db
      .insert(raidReminders)
      .values({ ...input, nextDueAt: new Date(input.nextDueAt), createdAt: new Date(now) })
      .returning()
      .get();
    return toRow(row);
  },
  listByUser(guildId, userId) {
    return db
      .select()
      .from(raidReminders)
      .where(and(eq(raidReminders.guildId, guildId), eq(raidReminders.userId, userId)))
      .orderBy(asc(raidReminders.id))
      .all()
      .map(toRow);
  },
  due(now) {
    return db
      .select()
      .from(raidReminders)
      .where(and(isNull(raidReminders.pausedReason), lte(raidReminders.nextDueAt, new Date(now))))
      .orderBy(asc(raidReminders.nextDueAt))
      .all()
      .map(toRow);
  },
  update(id, patch) {
    const set: Partial<typeof raidReminders.$inferInsert> = {};
    if (patch.nextDueAt !== undefined) set.nextDueAt = new Date(patch.nextDueAt);
    if (patch.pausedReason !== undefined) set.pausedReason = patch.pausedReason;
    if (patch.pausedAt !== undefined) set.pausedAt = patch.pausedAt === null ? null : new Date(patch.pausedAt);
    if (patch.lastSentAt !== undefined) set.lastSentAt = new Date(patch.lastSentAt);
    if (Object.keys(set).length === 0) return;
    db.update(raidReminders).set(set).where(eq(raidReminders.id, id)).run();
  },
  delete(id) {
    db.delete(raidReminders).where(eq(raidReminders.id, id)).run();
  },
  deleteAllByUser(guildId, userId) {
    return db
      .delete(raidReminders)
      .where(and(eq(raidReminders.guildId, guildId), eq(raidReminders.userId, userId)))
      .run().changes;
  },
};

export const discordReminderGateway: ReminderGateway = {
  async sendDm(userId: string, embed: EmbedBuilder) {
    const user = await getClient().users.fetch(userId);
    await user.send(reminderDmPayload(embed));
  },
  async sendChannel(channelId: string, userId: string, embed: EmbedBuilder) {
    const channel = await getClient().channels.fetch(channelId);
    if (!channel || !channel.isSendable()) {
      throw Object.assign(new Error('channel not sendable'), { code: 10003 });
    }
    await channel.send(reminderChannelPayload(userId, embed));
  },
};

let manager: RaidReminderManager | null = null;

export function getRaidReminders(): RaidReminderManager {
  manager ??= new RaidReminderManager({
    store: raidReminderStore,
    gateway: discordReminderGateway,
    timeZone: config.TIME_ZONE,
    log: (level, msg, data) => logger[level](data ?? {}, msg),
  });
  return manager;
}

/** Scheduler tick (30 s): quiet by design, summary only at debug level when something happened. */
export async function runRaidReminderTick(): Promise<void> {
  const summary = await getRaidReminders().tick();
  if (summary.sent + summary.skipped + summary.paused + summary.failed > 0) {
    logger.debug(summary, 'raid reminder tick');
  }
}
