import {
  ChannelType,
  EmbedBuilder,
  type Message,
  type MessageReaction,
  type PartialMessage,
  type PartialMessageReaction,
  type TextChannel,
} from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { starboardPosts } from '../db/schema.js';
import { Colors, truncate } from '../embeds/colors.js';
import { getSetting } from '../settings.js';
import { logger } from '../utils/logger.js';
import { getChannel } from './channel-store.js';
import { getClient } from './client.js';

function starEmojiFrom(reaction: MessageReaction | PartialMessageReaction): string | null {
  const { name, id } = reaction.emoji;
  if (id) return id;
  return name ?? null;
}

function matchesStar(reaction: MessageReaction | PartialMessageReaction): boolean {
  const emoji = starEmojiFrom(reaction);
  return emoji === getSetting('starboardEmoji');
}

async function countStars(message: Message | PartialMessage): Promise<number> {
  const starReaction = message.reactions?.cache.find((r) => matchesStar(r));
  if (!starReaction) return 0;
  const fetched = await starReaction.users.fetch().catch(() => null);
  if (!fetched) return starReaction.count ?? 0;
  return fetched.filter((u) => !u.bot && u.id !== message.author?.id).size;
}

export async function handleStarboardReactionChange(
  reaction: MessageReaction | PartialMessageReaction,
): Promise<void> {
  if (!matchesStar(reaction)) return;

  const starboardChannelId = getChannel('starboard');
  if (!starboardChannelId) return;

  const message = reaction.message.partial
    ? await reaction.message.fetch().catch(() => null)
    : reaction.message;
  if (!message || !message.guild || !message.author) return;
  if (message.author.bot) return;
  if (message.channelId === starboardChannelId) return;

  const count = await countStars(message);
  const guildId = message.guildId;
  if (!guildId) return;

  const existing = db
    .select()
    .from(starboardPosts)
    .where(
      and(
        eq(starboardPosts.guildId, guildId),
        eq(starboardPosts.originalMessageId, message.id),
      ),
    )
    .get();

  const starboard = (await getClient().channels.fetch(starboardChannelId).catch(() => null)) as
    | TextChannel
    | null;
  if (!starboard || starboard.type !== ChannelType.GuildText) return;

  if (!existing) {
    if (count < getSetting('starboardThreshold')) return;
    const embed = buildStarEmbed(message as Message, count);
    const posted = await starboard.send({ embeds: [embed] });
    db.insert(starboardPosts)
      .values({
        guildId,
        originalMessageId: message.id,
        originalChannelId: message.channelId,
        starboardMessageId: posted.id,
        starCount: count,
      })
      .run();
    logger.info({ msg: message.id, count }, 'starboard posted');
    return;
  }

  if (count === 0) {
    const existingMsg = await starboard.messages.fetch(existing.starboardMessageId).catch(() => null);
    await existingMsg?.delete().catch(() => {});
    db.delete(starboardPosts)
      .where(
        and(
          eq(starboardPosts.guildId, guildId),
          eq(starboardPosts.originalMessageId, message.id),
        ),
      )
      .run();
    return;
  }

  const existingMsg = await starboard.messages.fetch(existing.starboardMessageId).catch(() => null);
  if (!existingMsg) {
    db.delete(starboardPosts)
      .where(
        and(
          eq(starboardPosts.guildId, guildId),
          eq(starboardPosts.originalMessageId, message.id),
        ),
      )
      .run();
    return;
  }
  await existingMsg.edit({ embeds: [buildStarEmbed(message as Message, count)] });
  db.update(starboardPosts)
    .set({ starCount: count })
    .where(
      and(
        eq(starboardPosts.guildId, guildId),
        eq(starboardPosts.originalMessageId, message.id),
      ),
    )
    .run();
}

function buildStarEmbed(message: Message, count: number): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(Colors.warn)
    .setAuthor({
      name: message.author.username,
      iconURL: message.author.displayAvatarURL(),
    })
    .setDescription(truncate(message.content || '_(Anhang / Embed)_', 4000))
    .addFields({
      name: 'Source',
      value: `[Zum Original](${message.url}) · <#${message.channelId}>`,
    })
    .setFooter({ text: `${getSetting('starboardEmoji')} ${count} · ${message.id}` })
    .setTimestamp(message.createdAt);

  const imageAttachment = message.attachments.find((a) =>
    a.contentType?.startsWith('image/'),
  );
  if (imageAttachment) embed.setImage(imageAttachment.url);

  return embed;
}
