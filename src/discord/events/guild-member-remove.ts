import { EmbedBuilder, type TextChannel } from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import { logger } from '../../utils/logger.js';
import { getChannel } from '../channel-store.js';
import type { BotEvent } from './types.js';

export const guildMemberRemoveEvent: BotEvent<'guildMemberRemove'> = {
  name: 'guildMemberRemove',
  async execute(member) {
    try {
      const auditChannelId = getChannel('auditLog');
      if (!auditChannelId) return;
      const channel = await member.guild.channels.fetch(auditChannelId).catch(() => null);
      if (!channel || !channel.isSendable()) return;

      const joinedAt = member.joinedTimestamp
        ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
        : '_unknown_';

      await (channel as TextChannel).send({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.muted)
            .setAuthor({ name: 'Member left', iconURL: member.user?.displayAvatarURL() })
            .setDescription(`**${member.user?.tag ?? 'unknown'}** (\`${member.id}\`)`)
            .addFields({ name: 'Joined', value: joinedAt, inline: true })
            .setTimestamp(new Date()),
        ],
      });
    } catch (err) {
      logger.error({ err, userId: member.id }, 'guildMemberRemove handler failed');
    }
  },
};
