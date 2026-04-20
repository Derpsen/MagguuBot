import { EmbedBuilder, type TextChannel } from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import { logger } from '../../utils/logger.js';
import { getChannel } from '../channel-store.js';
import type { BotEvent } from './types.js';

export const guildMemberUpdateEvent: BotEvent<'guildMemberUpdate'> = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember) {
    try {
      const auditChannelId = getChannel('auditLog');
      if (!auditChannelId) return;

      const addedRoles = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
      const removedRoles = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));

      if (addedRoles.size === 0 && removedRoles.size === 0) return;

      const channel = await newMember.guild.channels.fetch(auditChannelId).catch(() => null);
      if (!channel || !channel.isSendable()) return;

      const lines: string[] = [];
      if (addedRoles.size > 0) {
        lines.push(`**➕ Added:** ${addedRoles.map((r) => r.toString()).join(', ')}`);
      }
      if (removedRoles.size > 0) {
        lines.push(`**➖ Removed:** ${removedRoles.map((r) => r.toString()).join(', ')}`);
      }

      await (channel as TextChannel).send({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.info)
            .setAuthor({ name: 'Roles changed', iconURL: newMember.user.displayAvatarURL() })
            .setDescription(`${newMember.toString()} — **${newMember.user.tag}**\n\n${lines.join('\n')}`)
            .setTimestamp(new Date()),
        ],
      });
    } catch (err) {
      logger.error({ err, userId: newMember.id }, 'guildMemberUpdate handler failed');
    }
  },
};
