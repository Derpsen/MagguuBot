import { EmbedBuilder, type Message, type TextChannel } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { stickyMessages } from '../db/schema.js';
import { Colors, truncate } from '../embeds/colors.js';
import { logger } from '../utils/logger.js';

const REPOST_DEBOUNCE_MS = 3_000;
const debounceTimers = new Map<string, NodeJS.Timeout>();

export function buildStickyEmbed(content: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.info)
    .setDescription(truncate(content, 4000))
    .setFooter({ text: '📌 Sticky' });
}

export function getSticky(channelId: string) {
  return db
    .select()
    .from(stickyMessages)
    .where(
      and(
        eq(stickyMessages.guildId, config.DISCORD_GUILD_ID),
        eq(stickyMessages.channelId, channelId),
      ),
    )
    .get();
}

export function setSticky(channelId: string, content: string, createdBy: string): void {
  db.insert(stickyMessages)
    .values({
      guildId: config.DISCORD_GUILD_ID,
      channelId,
      content,
      currentMessageId: null,
      createdBy,
    })
    .onConflictDoUpdate({
      target: [stickyMessages.guildId, stickyMessages.channelId],
      set: { content, updatedAt: new Date(), createdBy },
    })
    .run();
}

export function clearSticky(channelId: string): boolean {
  const res = db
    .delete(stickyMessages)
    .where(
      and(
        eq(stickyMessages.guildId, config.DISCORD_GUILD_ID),
        eq(stickyMessages.channelId, channelId),
      ),
    )
    .run();
  return res.changes > 0;
}

function updateCurrentMessageId(channelId: string, messageId: string | null): void {
  db.update(stickyMessages)
    .set({ currentMessageId: messageId, updatedAt: new Date() })
    .where(
      and(
        eq(stickyMessages.guildId, config.DISCORD_GUILD_ID),
        eq(stickyMessages.channelId, channelId),
      ),
    )
    .run();
}

export function listStickies(): Array<{ channelId: string; content: string }> {
  return db
    .select({ channelId: stickyMessages.channelId, content: stickyMessages.content })
    .from(stickyMessages)
    .where(eq(stickyMessages.guildId, config.DISCORD_GUILD_ID))
    .all();
}

export async function repostSticky(channel: TextChannel, content: string): Promise<Message> {
  const row = getSticky(channel.id);
  if (row?.currentMessageId) {
    try {
      const old = await channel.messages.fetch(row.currentMessageId);
      await old.delete();
    } catch {
      /* message already gone */
    }
  }
  const message = await channel.send({ embeds: [buildStickyEmbed(content)] });
  updateCurrentMessageId(channel.id, message.id);
  return message;
}

export function scheduleStickyRepost(message: Message): void {
  if (message.author.bot) return;
  if (!message.inGuild()) return;

  const row = getSticky(message.channelId);
  if (!row) return;

  const existing = debounceTimers.get(message.channelId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    debounceTimers.delete(message.channelId);
    repostSticky(message.channel as TextChannel, row.content).catch((err) =>
      logger.warn({ err, channelId: message.channelId }, 'sticky repost failed'),
    );
  }, REPOST_DEBOUNCE_MS);

  debounceTimers.set(message.channelId, timer);
}
