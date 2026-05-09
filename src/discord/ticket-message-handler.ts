import {
  PermissionFlagsBits,
  type Message,
  type TextChannel,
} from 'discord.js';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tickets } from '../db/schema.js';
import { logger } from '../utils/logger.js';

export async function handleTicketMessage(message: Message): Promise<void> {
  if (!message.guild || !message.member || message.author.bot) return;
  if (message.channel.type !== 0) return;

  const ticket = db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.guildId, message.guild.id),
        eq(tickets.channelId, message.channelId),
        isNull(tickets.closedAt),
      ),
    )
    .get();
  if (!ticket) return;

  db.update(tickets)
    .set({ lastActivityAt: new Date() })
    .where(eq(tickets.channelId, message.channelId))
    .run();

  const isMod = message.member.permissions.has(PermissionFlagsBits.ManageMessages);
  if (!isMod) return;

  const text = message.content.trim();
  const addMatch = text.match(/^\+\s*<@!?(\d+)>/);
  const removeMatch = text.match(/^-\s*<@!?(\d+)>/);

  const channel = message.channel as TextChannel;

  if (addMatch && addMatch[1]) {
    const userId = addMatch[1];
    try {
      await channel.permissionOverwrites.edit(userId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true,
      });
      await message.reply(`✅ <@${userId}> wurde zum Ticket hinzugefügt.`);
    } catch (err) {
      logger.warn({ err, userId }, 'ticket add user failed');
      await message.reply('Konnte User nicht hinzufügen.');
    }
    return;
  }

  if (removeMatch && removeMatch[1]) {
    const userId = removeMatch[1];
    if (userId === ticket.openerId) {
      await message.reply('Den Ticket-Eröffner kannst du nicht entfernen.');
      return;
    }
    try {
      await channel.permissionOverwrites.delete(userId, 'removed from ticket');
      await message.reply(`✅ <@${userId}> wurde entfernt.`);
    } catch (err) {
      logger.warn({ err, userId }, 'ticket remove user failed');
      await message.reply('Konnte User nicht entfernen.');
    }
  }
}
