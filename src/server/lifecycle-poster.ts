import type { EmbedBuilder, Message } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { eventLifecycleMessages } from '../db/schema.js';
import { editEmbed, postEmbed } from './discord-poster.js';

interface LifecyclePostArgs {
  lifecycleKey: string;
  channelId: string | undefined;
  embed: EmbedBuilder;
  source: string;
  eventType: string;
  state: string;
  payload: unknown;
}

export async function postOrEditLifecycleEmbed(args: LifecyclePostArgs): Promise<Message | null> {
  const existing = db.select().from(eventLifecycleMessages)
    .where(and(
      eq(eventLifecycleMessages.guildId, config.DISCORD_GUILD_ID),
      eq(eventLifecycleMessages.lifecycleKey, args.lifecycleKey),
    ))
    .get();

  if (existing && args.channelId === existing.channelId) {
    const edited = await editEmbed({
      channelId: existing.channelId,
      messageId: existing.messageId,
      embed: args.embed,
      source: args.source,
      eventType: args.eventType,
      payload: args.payload,
    });
    if (edited) {
      db.update(eventLifecycleMessages)
        .set({ state: args.state, updatedAt: new Date() })
        .where(and(
          eq(eventLifecycleMessages.guildId, config.DISCORD_GUILD_ID),
          eq(eventLifecycleMessages.lifecycleKey, args.lifecycleKey),
        ))
        .run();
      return edited;
    }
  }

  const posted = await postEmbed({
    channelId: args.channelId,
    embed: args.embed,
    source: args.source,
    eventType: args.eventType,
    payload: args.payload,
  });
  if (posted) {
    db.insert(eventLifecycleMessages)
      .values({
        guildId: config.DISCORD_GUILD_ID,
        lifecycleKey: args.lifecycleKey,
        channelId: posted.channelId,
        messageId: posted.id,
        state: args.state,
      })
      .onConflictDoUpdate({
        target: [eventLifecycleMessages.guildId, eventLifecycleMessages.lifecycleKey],
        set: {
          channelId: posted.channelId,
          messageId: posted.id,
          state: args.state,
          updatedAt: new Date(),
        },
      })
      .run();
  }
  return posted;
}
