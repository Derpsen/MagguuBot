import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type Role,
  type TextChannel,
  type User,
} from 'discord.js';

export const TICKET_CATEGORY_NAME = '🎫 TICKETS';
const MODERATOR_ROLE_NAMES = new Set(['Admin', 'Moderator']);

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
  const category = await ensureTicketCategory(guild);
  const moderatorRoles = [...guild.roles.cache.values()].filter((role) =>
    MODERATOR_ROLE_NAMES.has(role.name),
  );
  const channel = await guild.channels.create({
    name: options.name.slice(0, 90),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: options.topic,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: opener.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      ...moderatorRoles.map((role) => ({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
        ],
      })),
    ],
  });

  if (botUserId) {
    await channel.permissionOverwrites.create(botUserId, {
      ViewChannel: true,
      SendMessages: true,
      EmbedLinks: true,
      ReadMessageHistory: true,
      ManageMessages: true,
      ManageChannels: true,
    });
  }

  return { channel, moderatorRoles };
}

async function ensureTicketCategory(guild: Guild): Promise<import('discord.js').CategoryChannel> {
  const existing = guild.channels.cache.find(
    (channel) =>
      channel.name === TICKET_CATEGORY_NAME && channel.type === ChannelType.GuildCategory,
  );
  if (existing?.type === ChannelType.GuildCategory) return existing;

  return guild.channels.create({
    name: TICKET_CATEGORY_NAME,
    type: ChannelType.GuildCategory,
  });
}
