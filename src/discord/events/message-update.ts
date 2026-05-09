import { EmbedBuilder, type TextChannel } from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import { logger } from '../../utils/logger.js';
import { getChannel } from '../channel-store.js';
import { recordEdited } from '../snipe.js';
import type { BotEvent } from './types.js';

const TICKET_CHANNEL_PREFIX = 'ticket-';

export const messageUpdateEvent: BotEvent<'messageUpdate'> = {
  name: 'messageUpdate',
  async execute(oldMessage, newMessage) {
    if (!newMessage.guild) return;
    if (newMessage.partial || oldMessage.partial) return;
    if (newMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return;

    try {
      recordEdited(newMessage.channelId, {
        authorId: newMessage.author?.id ?? 'unknown',
        authorTag: newMessage.author?.username ?? 'unknown',
        authorAvatarUrl: newMessage.author?.displayAvatarURL() ?? '',
        content: oldMessage.content ?? '',
        newContent: newMessage.content ?? '',
        attachments: [],
        deletedAt: Date.now(),
        editedAt: Date.now(),
      });
    } catch (err) {
      logger.debug({ err }, 'edit snipe record failed');
    }

    try {
      const channelName = 'name' in newMessage.channel ? newMessage.channel.name : '';
      if (channelName?.startsWith(TICKET_CHANNEL_PREFIX)) return;

      const auditChannelId = getChannel('auditLog');
      if (!auditChannelId) return;
      const auditChannel = await newMessage.guild.channels.fetch(auditChannelId).catch(() => null);
      if (!auditChannel || !auditChannel.isSendable()) return;

      const embed = new EmbedBuilder()
        .setColor(Colors.warn)
        .setAuthor({
          name: `Message edited · ${newMessage.author?.username ?? 'unknown'}`,
          iconURL: newMessage.author?.displayAvatarURL(),
        })
        .setDescription(`[Jump to message](${newMessage.url})`)
        .addFields(
          {
            name: 'Vorher',
            value: oldMessage.content?.slice(0, 1024) || '_(leer)_',
          },
          {
            name: 'Nachher',
            value: newMessage.content?.slice(0, 1024) || '_(leer)_',
          },
          { name: 'Channel', value: `<#${newMessage.channelId}>`, inline: true },
        )
        .setTimestamp(new Date());
      await (auditChannel as TextChannel).send({ embeds: [embed] });
    } catch (err) {
      logger.error({ err }, 'message update logging failed');
    }
  },
};
