import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { PermissionFlagsBits, type EmbedBuilder } from 'discord.js';
import { db } from '../db/client.js';
import { raidReminders } from '../db/schema.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { reminderChannelPayload, reminderDmPayload } from '../utils/raid-reminder.js';
import { getChannel } from './channel-store.js';
import { getClient } from './client.js';
import {
  RaidReminderManager,
  type NewReminder,
  type ReminderGateway,
  type ReminderRow,
  type ReminderStore,
} from './raid-reminder-manager.js';

/** Permissions the bot needs to deliver a channel reminder (same set the other cards use). */
export const REMINDER_CHANNEL_PERMISSIONS =
  PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks;

export interface ReminderChannelLike {
  id: string;
  permissionsFor(who: never): { has(bits: bigint): boolean } | null;
}

/**
 * Delivery gate: `#updates` (addonUpdates) is reserved for MagguuUI releases, and the bot must be allowed to
 * view/send/embed. Throws a coded Discord-style error (50013, permanent) so the manager pauses the
 * subscription once (warn log, no alarm) instead of failing on every tick.
 */
export function assertReminderChannelAllowed(channel: ReminderChannelLike, me: unknown, blockedChannelId: string | undefined): void {
  if (blockedChannelId && channel.id === blockedChannelId) {
    throw Object.assign(new Error('channel reserved for releases'), { code: 50013 });
  }
  const perms = channel.permissionsFor(me as never);
  if (!perms?.has(REMINDER_CHANNEL_PERMISSIONS)) {
    throw Object.assign(new Error('missing channel permissions'), { code: 50013 });
  }
}

/** What the subscriber must (still) be allowed to do in the target channel for the bot to post on their behalf. */
export const SUBSCRIBER_CHANNEL_PERMISSIONS = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages;

/** Discord: Unknown Member (left the guild) / Unknown User. */
const UNKNOWN_MEMBER_CODES = new Set([10007, 10013]);

/**
 * Re-check at send time (the creation check can be stale): the bot may write everywhere, so without this a user who
 * lost access (role/overwrite/mute change) or left the server could still make it post their text and ping them in
 * that channel. A subscriber who is gone or lacks View/Send gets the same permanent, coded error as missing bot
 * rights, so the manager pauses the subscription once (one warn log, no alarm, nothing is posted, nobody is pinged).
 */
export function assertSubscriberChannelAllowed(channel: ReminderChannelLike, member: unknown): void {
  const perms = member ? channel.permissionsFor(member as never) : null;
  if (!perms?.has(SUBSCRIBER_CHANNEL_PERMISSIONS)) {
    throw Object.assign(new Error('subscriber lacks channel permissions'), { code: 50013 });
  }
}

async function fetchSubscriber(channel: SendableGuildChannel, userId: string): Promise<unknown> {
  try {
    return await channel.guild.members.fetch(userId);
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (typeof code === 'number' && UNKNOWN_MEMBER_CODES.has(code)) return null; // gone = no rights
    throw err; // transient (rate limit, network): retried within the 15 min grace
  }
}

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
    pauseNotifiedAt: r.pauseNotifiedAt ? r.pauseNotifiedAt.getTime() : null,
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
    if (patch.pauseNotifiedAt !== undefined) set.pauseNotifiedAt = patch.pauseNotifiedAt === null ? null : new Date(patch.pauseNotifiedAt);
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

/** The slice of the discord.js client the gateway touches (kept narrow so the wiring is testable with fakes). */
export interface ReminderClientLike {
  users: { fetch(id: string): Promise<{ send(payload: never): Promise<unknown> }> };
  channels: { fetch(id: string): Promise<unknown> };
}

interface SendableGuildChannel extends ReminderChannelLike {
  isSendable(): boolean;
  isDMBased(): boolean;
  send(payload: never): Promise<unknown>;
  guild: { members: { me: unknown; fetchMe(): Promise<unknown>; fetch(id: string): Promise<unknown> } };
}

/** Builds the Discord delivery gateway; `discordReminderGateway` is this with the live client and `#updates` lock. */
export function createReminderGateway(
  getReminderClient: () => ReminderClientLike,
  getBlockedChannelId: () => string | undefined,
): ReminderGateway {
  return {
    async sendDm(userId: string, embed: EmbedBuilder) {
      const user = await getReminderClient().users.fetch(userId);
      await user.send(reminderDmPayload(embed) as never);
    },
    async sendChannel(channelId: string, userId: string, embed: EmbedBuilder) {
      const channel = (await getReminderClient().channels.fetch(channelId)) as SendableGuildChannel | null;
      if (!channel || !channel.isSendable() || channel.isDMBased()) {
        throw Object.assign(new Error('channel not sendable'), { code: 10003 });
      }
      const me = channel.guild.members.me ?? (await channel.guild.members.fetchMe());
      assertReminderChannelAllowed(channel, me, getBlockedChannelId());
      assertSubscriberChannelAllowed(channel, await fetchSubscriber(channel, userId));
      await channel.send(reminderChannelPayload(userId, embed) as never);
    },
  };
}

export const discordReminderGateway: ReminderGateway = createReminderGateway(
  () => getClient() as unknown as ReminderClientLike,
  () => getChannel('addonUpdates'),
);

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
