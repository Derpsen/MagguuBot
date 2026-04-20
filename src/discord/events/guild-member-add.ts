import { EmbedBuilder, type GuildMember, type TextChannel } from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import { getSetting } from '../../settings.js';
import { logger } from '../../utils/logger.js';
import { getChannel } from '../channel-store.js';
import type { BotEvent } from './types.js';

async function applyAutoRole(member: GuildMember): Promise<void> {
  if (member.user.bot) return;
  const roleId = getSetting('autoRoleId');
  if (!roleId) return;
  const role = member.guild.roles.cache.get(roleId);
  if (!role) {
    logger.warn({ roleId }, 'auto-role configured but role not found');
    return;
  }
  await member.roles.add(role, 'auto-role on join');
  logger.info({ userId: member.id, roleId }, 'auto-role applied');
}

export const guildMemberAddEvent: BotEvent<'guildMemberAdd'> = {
  name: 'guildMemberAdd',
  async execute(member) {
    try {
      await applyAutoRole(member);
    } catch (err) {
      logger.error({ err, userId: member.id }, 'auto-role failed');
    }

    try {
      const welcomeChannelId = getChannel('welcome');
      if (welcomeChannelId) {
        const channel = await member.guild.channels.fetch(welcomeChannelId).catch(() => null);
        if (channel && channel.isSendable()) {
          await (channel as TextChannel).send({
            content: `👋 ${member.toString()}`,
            embeds: [buildWelcomeEmbed(member.user.username, member.guild.memberCount)],
          });
        }
      }

      const auditChannelId = getChannel('auditLog');
      if (auditChannelId) {
        const channel = await member.guild.channels.fetch(auditChannelId).catch(() => null);
        if (channel && channel.isSendable()) {
          await (channel as TextChannel).send({
            embeds: [
              new EmbedBuilder()
                .setColor(Colors.success)
                .setAuthor({ name: 'Member joined', iconURL: member.user.displayAvatarURL() })
                .setDescription(`${member.toString()} — **${member.user.tag}** (\`${member.id}\`)`)
                .addFields(
                  { name: 'Account created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                  { name: 'Member #', value: `${member.guild.memberCount}`, inline: true },
                )
                .setTimestamp(new Date()),
            ],
          });
        }
      }
    } catch (err) {
      logger.error({ err, userId: member.id }, 'guildMemberAdd handler failed');
    }
  },
};

function buildWelcomeEmbed(username: string, memberCount: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setTitle(`Willkommen, ${username}! 🎉`)
    .setDescription(
      [
        'Schön dass du da bist.',
        '',
        '**📜 Les die Regeln** in <#rules-placeholder>',
        '**🎭 Hol dir Rollen** in <#roles-placeholder>',
        '**📝 Request Filme / Serien** in <#requests-placeholder>',
      ].join('\n'),
    )
    .setFooter({ text: `Member #${memberCount}  ·  MagguuBot` })
    .setTimestamp(new Date());
}
