import { EmbedBuilder } from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import { logger } from '../../utils/logger.js';
import { getChannel } from '../channel-store.js';
import type { BotEvent } from './types.js';

export const guildMemberUpdateEvent: BotEvent<'guildMemberUpdate'> = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember) {
    try {
      const wasBoosting = oldMember.premiumSinceTimestamp !== null;
      const isBoosting = newMember.premiumSinceTimestamp !== null;
      if (!wasBoosting && isBoosting) {
        await postBoostNotification(newMember);
      }
    } catch (err) {
      logger.error({ err, userId: newMember.id }, 'boost notify failed');
    }

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

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.info)
            .setAuthor({ name: 'Roles changed', iconURL: newMember.user.displayAvatarURL() })
            .setDescription(
              `${newMember.toString()} — **${newMember.user.displayName}**\n\n${lines.join('\n')}`,
            )
            .setTimestamp(new Date()),
        ],
      });
    } catch (err) {
      logger.error({ err, userId: newMember.id }, 'guildMemberUpdate handler failed');
    }
  },
};

async function postBoostNotification(
  member: import('discord.js').GuildMember,
): Promise<void> {
  const guild = member.guild;
  const channelId = getChannel('welcome') ?? getChannel('auditLog');
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isSendable()) return;

  const tier = guild.premiumTier ?? 0;
  const total = guild.premiumSubscriptionCount ?? 0;

  const embed = new EmbedBuilder()
    .setColor(0xff73fa)
    .setAuthor({ name: 'Server boosted! 🚀', iconURL: member.user.displayAvatarURL() })
    .setTitle(`💜 Danke ${member.user.displayName}!`)
    .setDescription(
      [
        `${member.toString()} hat **${guild.name}** geboostet!`,
        '',
        `🚀 **Boost-Level:** ${tier}`,
        `💎 **Boosts gesamt:** ${total}`,
        '',
        '_Mehr Boosts schalten höhere Audio-Qualität, mehr Emojis und größere Upload-Limits frei._',
      ].join('\n'),
    )
    .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
    .setTimestamp(new Date());

  await channel.send({
    content: `🎉 ${member.toString()}`,
    embeds: [embed],
    allowedMentions: { users: [member.id] },
  });
}
