import type { EmbedBuilder, MessageCreateOptions, MessageEditOptions } from 'discord.js';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { plexActivityCard, plexUserCard } from '../db/schema.js';
import { enforceEmbedTotalSize } from '../embeds/colors.js';
import { logger } from '../utils/logger.js';
import { emptyPlexCardState, type PlexCardState } from '../utils/plex-card.js';
import {
  PLEX_CARD_MAX_USERS,
  parsePlexCardUserConfig,
  resolvePlexCardUser,
  type PlexCardUserConfig,
} from '../utils/plex-card-users.js';
import { getChannel } from './channel-store.js';
import { getClient } from './client.js';
import { runPlexCardCleanupTick } from './plex-card-cleanup.js';
import {
  PlexCardManager,
  type PlexCardGateway,
  type PlexCardRecord,
  type PlexCardStore,
} from './plex-card-manager.js';

const sessionSchema = z.object({
  key: z.string(),
  sessionKey: z.string().nullable(),
  user: z.string(),
  player: z.string(),
  title: z.string(),
  mediaType: z.string(),
  state: z.enum(['play', 'pause', 'buffer']),
  watched: z.boolean(),
  startedAt: z.number(),
  updatedAt: z.number(),
});

const recentSchema = z.object({
  key: z.string().nullable(),
  kind: z.enum(['stop', 'watched', 'error', 'info']),
  user: z.string(),
  title: z.string(),
  at: z.number(),
});

const stateSchema = z.object({
  sessions: z.array(sessionSchema),
  recent: z.array(recentSchema),
  changedAt: z.number(),
});

function parseState(json: string): PlexCardState {
  try {
    const parsed = stateSchema.safeParse(JSON.parse(json));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through to an empty state: a broken row must not block the card
  }
  return emptyPlexCardState();
}

const migratedChannels = new Set<string>();

function userCardRow(record: PlexCardRecord, createdAt: number) {
  return {
    guildId: config.DISCORD_GUILD_ID,
    channelId: record.channelId,
    userKey: record.userKey,
    displayName: record.displayName,
    messageId: record.messageId,
    contentHash: record.contentHash,
    stateJson: JSON.stringify(record.state),
    postedAt: record.postedAt === null ? null : new Date(record.postedAt),
    createdAt: new Date(createdAt),
    updatedAt: new Date(),
  };
}

function toRecord(row: typeof plexUserCard.$inferSelect): PlexCardRecord {
  return {
    channelId: row.channelId,
    userKey: row.userKey,
    displayName: row.displayName,
    messageId: row.messageId,
    contentHash: row.contentHash,
    state: parseState(row.stateJson),
    postedAt: row.postedAt?.getTime() ?? null,
  };
}

/**
 * One-time, idempotent move from the old single card (`plex_activity_card`) to per-user cards:
 * runs only while the channel has no per-user card yet, splits the old running sessions and history by
 * user, and seeds one card per user WITHOUT a message id (the tick posts them one after another).
 * The old card is not touched any more; its message falls into the one-time cleanup.
 * Returns the number of seeded cards.
 */
export function migrateLegacyPlexCard(channelId: string, userConfig: PlexCardUserConfig = currentUserConfig()): number {
  const guildId = config.DISCORD_GUILD_ID;
  const existing = db.select({ userKey: plexUserCard.userKey }).from(plexUserCard)
    .where(and(eq(plexUserCard.guildId, guildId), eq(plexUserCard.channelId, channelId)))
    .limit(1).get();
  if (existing) return 0;
  const legacy = db.select().from(plexActivityCard)
    .where(and(eq(plexActivityCard.guildId, guildId), eq(plexActivityCard.channelId, channelId)))
    .get();
  if (!legacy) return 0;
  const old = parseState(legacy.stateJson);

  const byUser = new Map<string, { name: string; state: PlexCardState }>();
  const bucket = (raw: string): { name: string; state: PlexCardState } | null => {
    const user = resolvePlexCardUser(raw, userConfig);
    if (!user) return null;
    let entry = byUser.get(user.key);
    if (!entry) {
      if (byUser.size >= PLEX_CARD_MAX_USERS) return null;
      entry = { name: user.name, state: { sessions: [], recent: [], changedAt: old.changedAt } };
      byUser.set(user.key, entry);
    }
    return entry;
  };
  for (const session of old.sessions) bucket(session.user)?.state.sessions.push(session);
  for (const recent of old.recent) bucket(recent.user)?.state.recent.push(recent);

  const base = Date.now();
  let n = 0;
  db.transaction((tx) => {
    for (const [userKey, entry] of byUser) {
      tx.insert(plexUserCard).values(userCardRow({
        channelId,
        userKey,
        displayName: entry.name,
        messageId: null,
        contentHash: null,
        state: entry.state,
        postedAt: null,
      }, base + n)).onConflictDoNothing().run();
      n += 1;
    }
  });
  if (n > 0) logger.info({ cards: n }, 'Plex cards seeded from the old single card');
  return n;
}

function ensureMigrated(channelId: string): void {
  if (migratedChannels.has(channelId)) return;
  migratedChannels.add(channelId);
  try {
    migrateLegacyPlexCard(channelId);
  } catch (err) {
    migratedChannels.delete(channelId);
    logger.warn({ err }, 'Plex card migration failed, will retry');
  }
}

export const plexCardStore: PlexCardStore = {
  load(channelId, userKey) {
    ensureMigrated(channelId);
    const row = db.select().from(plexUserCard)
      .where(and(
        eq(plexUserCard.guildId, config.DISCORD_GUILD_ID),
        eq(plexUserCard.channelId, channelId),
        eq(plexUserCard.userKey, userKey),
      ))
      .get();
    return row ? toRecord(row) : null;
  },
  list(channelId) {
    ensureMigrated(channelId);
    return db.select().from(plexUserCard)
      .where(and(eq(plexUserCard.guildId, config.DISCORD_GUILD_ID), eq(plexUserCard.channelId, channelId)))
      .orderBy(asc(plexUserCard.createdAt), asc(plexUserCard.userKey))
      .all()
      .map(toRecord);
  },
  save(record: PlexCardRecord) {
    const values = userCardRow(record, Date.now());
    const { createdAt: _createdAt, ...update } = values;
    db.insert(plexUserCard)
      .values(values)
      .onConflictDoUpdate({
        target: [plexUserCard.guildId, plexUserCard.channelId, plexUserCard.userKey],
        set: update,
      })
      .run();
  },
};

let userConfigCache: { aliases: string; exclude: string; value: PlexCardUserConfig } | null = null;

/** Parsed aliases/exclude from the current config (re-parsed only when the env strings change). */
export function currentUserConfig(): PlexCardUserConfig {
  const aliases = config.PLEX_CARD_USER_ALIASES;
  const exclude = config.PLEX_CARD_USER_EXCLUDE;
  if (!userConfigCache || userConfigCache.aliases !== aliases || userConfigCache.exclude !== exclude) {
    userConfigCache = { aliases, exclude, value: parsePlexCardUserConfig(aliases, exclude) };
  }
  return userConfigCache.value;
}

async function textChannel(channelId: string) {
  const channel = await getClient().channels.fetch(channelId);
  if (!channel?.isTextBased() || !('messages' in channel)) {
    throw new Error(`channel ${channelId} is not text-based`);
  }
  return channel;
}

type CardChannel = Awaited<ReturnType<typeof textChannel>>;

/** Exactly what is sent for a new card: one embed (trimmed to Discord's 6000 total), no content, no pings at all. */
export function cardPostOptions(embed: EmbedBuilder): MessageCreateOptions {
  enforceEmbedTotalSize(embed);
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

/** Exactly what is sent when a card is edited in place. */
export function cardEditOptions(embed: EmbedBuilder): MessageEditOptions {
  enforceEmbedTotalSize(embed);
  return { embeds: [embed], components: [], allowedMentions: { parse: [] } };
}

/** Gateway for single-card features (post / PATCH-edit by id); the channel lookup is injectable for tests. */
export function createDiscordCardGateway(resolveChannel: (channelId: string) => Promise<CardChannel> = textChannel): PlexCardGateway {
  return {
    async post(channelId, embed: EmbedBuilder) {
      const channel = await resolveChannel(channelId);
      if (!channel.isSendable()) throw new Error(`channel ${channelId} is not sendable`);
      const message = await channel.send(cardPostOptions(embed));
      return message.id;
    },
    async edit(channelId, messageId, embed: EmbedBuilder) {
      const channel = await resolveChannel(channelId);
      // PATCH by id: no fetch round trip, and Discord answers 10008 when the message is gone.
      await channel.messages.edit(messageId, cardEditOptions(embed));
    },
    async delete(channelId, messageId) {
      const channel = await resolveChannel(channelId);
      await channel.messages.delete(messageId);
    },
  };
}

/** Shared Discord gateway for single-card features. */
export const discordCardGateway: PlexCardGateway = createDiscordCardGateway();

let manager: PlexCardManager | null = null;

export function getPlexCard(): PlexCardManager {
  manager ??= new PlexCardManager({
    store: plexCardStore,
    gateway: discordCardGateway,
    resolveUser: (raw) => resolvePlexCardUser(raw, currentUserConfig()),
    log: (level, msg, data) => logger[level](data ?? {}, msg),
  });
  return manager;
}

export function plexCardChannelId(): string | undefined {
  return getChannel('plexActivity');
}

/** 30 s tick: expires sessions without any event for hours, retries outstanding flushes, then the one-time cleanup. */
export async function runPlexCardTick(): Promise<void> {
  const channelId = plexCardChannelId();
  if (!channelId) return;
  await getPlexCard().tick(channelId);
  await runPlexCardCleanupTick(channelId, getPlexCard().syncStatus(channelId));
}

export async function flushPlexCardOnShutdown(): Promise<void> {
  if (!manager) return;
  await manager.flushAllPending();
}
