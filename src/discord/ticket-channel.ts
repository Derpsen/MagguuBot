import { ChannelType, type Guild, type Role, type TextChannel, type User } from 'discord.js';
import {
  TICKET_MODERATOR_ROLE_NAMES,
  ticketCategoryOverwrites,
  ticketChannelOverwrites,
} from '../utils/ticket-perms.js';
import { TICKET_CATEGORY_NAME } from './server-layout.js';

export { TICKET_CATEGORY_NAME };

interface CreatePrivateTicketChannelOptions {
  guild: Guild;
  opener: User;
  botUserId?: string;
  name: string;
  topic: string;
}

export interface CreatedPrivateTicketChannel {
  channel: TextChannel;
  moderatorRoles: Role[];
}

export function ticketTopicSlug(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'support';
}

export async function createPrivateTicketChannel(
  options: CreatePrivateTicketChannelOptions,
): Promise<CreatedPrivateTicketChannel> {
  const { guild, opener, botUserId } = options;
  const moderatorRoles = [...guild.roles.cache.values()].filter((role) =>
    TICKET_MODERATOR_ROLE_NAMES.has(role.name),
  );
  const category = await ensureTicketCategory(guild, moderatorRoles, botUserId);
  const channel = await guild.channels.create({
    name: options.name.slice(0, 90),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: options.topic,
    permissionOverwrites: ticketChannelOverwrites({
      everyoneId: guild.roles.everyone.id,
      openerId: opener.id,
      moderatorRoleIds: moderatorRoles.map((r) => r.id),
      botUserId,
    }),
  });

  return { channel, moderatorRoles };
}

/** Find 🎫 TICKETS by name; create it (hidden from everyone) if missing. */
async function ensureTicketCategory(
  guild: Guild,
  moderatorRoles: Role[],
  botUserId?: string,
): Promise<import('discord.js').CategoryChannel> {
  const existing = guild.channels.cache.find(
    (channel) =>
      channel.name === TICKET_CATEGORY_NAME && channel.type === ChannelType.GuildCategory,
  );
  if (existing?.type === ChannelType.GuildCategory) return existing;

  return guild.channels.create({
    name: TICKET_CATEGORY_NAME,
    type: ChannelType.GuildCategory,
    permissionOverwrites: ticketCategoryOverwrites({
      everyoneId: guild.roles.everyone.id,
      moderatorRoleIds: moderatorRoles.map((r) => r.id),
      botUserId,
    }),
  });
}
