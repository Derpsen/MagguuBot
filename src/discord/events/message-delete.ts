import { EmbedBuilder, type TextChannel } from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import { logger } from '../../utils/logger.js';
import { getChannel } from '../channel-store.js';
import { recordDeleted } from '../snipe.js';
import type { BotEvent } from './types.js';

const TICKET_CHANNEL_PREFIX = 'ticket-';

export const messageDeleteEvent: BotEvent<'messageDelete'> = {
  name: 'messageDelete',
  async execute(message) {
    if (!message.guild) return;
    if (message.partial) return;
    if (message.author?.bot) return;
    if (!message.content && message.attachments.size === 0) return;

    try {
      recordDeleted(message.channelId, {
        authorId: message.author?.id ?? 'unknown',
        authorTag: message.author?.username ?? 'unknown',
        authorAvatarUrl: message.author?.displayAvatarURL() ?? '',
        content: message.content ?? '',
        attachments: Array.from(message.attachments.values()).map((a) => a.url),
        deletedAt: Date.now(),
      });
    } catch (err) {
      logger.debug({ err }, 'snipe record failed');
    }

    try {
      const channelName = 'name' in message.channel ? message.channel.name : '';
      if (channelName?.startsWith(TICKET_CHANNEL_PREFIX)) return;

      const auditChannelId = getChannel('auditLog');
      if (!auditChannelId) return;
      const auditChannel = await message.guild.channels.fetch(auditChannelId).catch(() => null);
      if (!auditChannel || !auditChannel.isSendable()) return;

      const embed = new EmbedBuilder()
        .setColor(Colors.danger)
        .setAuthor({
          name: `Message deleted · ${message.author?.username ?? 'unknown'}`,
          iconURL: message.author?.displayAvatarURL(),
        })
        .setDescription(message.content?.slice(0, 1900) || '_(kein Text)_')
        .addFields(
          { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
          { name: 'Author', value: message.author ? `<@${message.author.id}>` : 'unknown', inline: true },
        )
        .setTimestamp(new Date());
      if (message.attachments.size > 0) {
        embed.addFields({
          name: 'Attachments',
          value: Array.from(message.attachments.values())
            .map((a) => a.name ?? a.url)
            .join(', ')
            .slice(0, 1024),
        });
      }
      await (auditChannel as TextChannel).send({ embeds: [embed] });
    } catch (err) {
      logger.error({ err }, 'message delete logging failed');
    }
  },
};
