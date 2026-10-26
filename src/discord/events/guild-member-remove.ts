import { EmbedBuilder } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { memberHistory } from '../../db/schema.js';
import { Colors } from '../../embeds/colors.js';
import { logger } from '../../utils/logger.js';
import { getChannel } from '../channel-store.js';
import { requestWelcomeCounterRefresh } from '../welcome-counter.js';
import { getRaidReminders } from '../raid-reminders.js';
import { forgetRioLink } from '../rio-roles.js';
import type { BotEvent } from './types.js';

export const guildMemberRemoveEvent: BotEvent<'guildMemberRemove'> = {
  name: 'guildMemberRemove',
  async execute(member) {
    try {
      db.update(memberHistory)
        .set({ lastLeftAt: new Date() })
        .where(and(eq(memberHistory.guildId, member.guild.id), eq(memberHistory.userId, member.id)))
        .run();
    } catch (err) {
      logger.warn({ err, userId: member.id }, 'member_history left-update failed');
    }

    requestWelcomeCounterRefresh();

    try {
      const removed = getRaidReminders().removeAllForLeftUser(member.guild.id, member.id);
      if (removed > 0) logger.info({ userId: member.id, removed }, 'deleted raid reminders of the member who left');
    } catch (err) {
      logger.warn({ err, userId: member.id }, 'raid reminder cleanup on leave failed');
    }

    try {
      if (forgetRioLink(member.guild.id, member.id)) logger.info({ userId: member.id }, 'deleted the Raider.IO link of the member who left');
    } catch (err) {
      logger.warn({ err, userId: member.id }, 'Raider.IO link cleanup on leave failed');
    }

    try {
      const auditChannelId = getChannel('auditLog');
      if (!auditChannelId) return;
      const channel = await member.guild.channels.fetch(auditChannelId).catch(() => null);
      if (!channel || !channel.isSendable()) return;

      const joinedAt = member.joinedTimestamp
        ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
        : '_unknown_';

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.muted)
            .setAuthor({ name: 'Member left', iconURL: member.user?.displayAvatarURL() })
            .setDescription(`**${member.user?.displayName ?? 'unknown'}** (\`${member.id}\`)`)
            .addFields({ name: 'Joined', value: joinedAt, inline: true })
            .setTimestamp(new Date()),
        ],
      });
    } catch (err) {
      logger.error({ err, userId: member.id }, 'guildMemberRemove handler failed');
    }
  },
};
