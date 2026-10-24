import type { EmbedBuilder, MessageCreateOptions, MessageEditOptions } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { plexActivityCard } from '../db/schema.js';
import { enforceEmbedTotalSize } from '../embeds/colors.js';
import { logger } from '../utils/logger.js';
import { emptyPlexCardState, type PlexCardState } from '../utils/plex-card.js';
import { getChannel } from './channel-store.js';
import { getClient } from './client.js';
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

export const plexCardStore: PlexCardStore = {
  load(channelId) {
    const row = db.select().from(plexActivityCard)
      .where(and(eq(plexActivityCard.guildId, config.DISCORD_GUILD_ID), eq(plexActivityCard.channelId, channelId)))
      .get();
    if (!row) return null;
    return {
      channelId: row.channelId,
      messageId: row.messageId,
      contentHash: row.contentHash,
      state: parseState(row.stateJson),
      postedAt: row.postedAt?.getTime() ?? null,
    };
  },
  save(record: PlexCardRecord) {
    const values = {
      guildId: config.DISCORD_GUILD_ID,
      channelId: record.channelId,
      messageId: record.messageId,
      contentHash: record.contentHash,
      stateJson: JSON.stringify(record.state),
      postedAt: record.postedAt === null ? null : new Date(record.postedAt),
      updatedAt: new Date(),
    };
    db.insert(plexActivityCard)
      .values(values)
      .onConflictDoUpdate({
        target: [plexActivityCard.guildId, plexActivityCard.channelId],
        set: values,
      })
      .run();
  },
};

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
    log: (level, msg, data) => logger[level](data ?? {}, msg),
  });
  return manager;
}

export function plexCardChannelId(): string | undefined {
  return getChannel('plexActivity');
}

/** 30 s tick: expires sessions without any event for hours and retries an outstanding flush. */
export async function runPlexCardTick(): Promise<void> {
  const channelId = plexCardChannelId();
  if (!channelId) return;
  await getPlexCard().tick(channelId);
}

export async function flushPlexCardOnShutdown(): Promise<void> {
  if (!manager) return;
  await manager.flushAllPending();
}
