import { PermissionFlagsBits, type Message } from 'discord.js';
import { getSetting } from '../settings.js';
import { logger } from '../utils/logger.js';
import { postModLog } from './mod-log.js';

const INVITE_PATTERN =
  /(?:https?:\/\/)?(?:www\.)?(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg)\/[A-Za-z0-9-]+/i;

export async function runAutomod(message: Message): Promise<boolean> {
  if (!getSetting('automodInviteFilter')) return false;
  if (!message.inGuild()) return false;
  if (!message.member) return false;
  if (message.author.bot) return false;

  const perms = message.member.permissions;
  if (perms.has(PermissionFlagsBits.ManageMessages) || perms.has(PermissionFlagsBits.Administrator)) {
    return false;
  }

  if (!INVITE_PATTERN.test(message.content)) return false;

  try {
    await message.delete();
  } catch (err) {
    logger.warn({ err, msgId: message.id }, 'automod delete failed — missing perms?');
    return false;
  }

  try {
    const warning = await message.channel.send({
      content: `${message.author.toString()} — Discord-Invites sind hier nicht erlaubt. (Auto-Moderation)`,
    });
    setTimeout(() => {
      warning.delete().catch(() => {});
    }, 6000);
  } catch (err) {
    logger.warn({ err }, 'automod warn send failed');
  }

  const botUser = message.client.user;
  if (botUser) {
    await postModLog({
      guild: message.guild,
      action: 'automod',
      moderator: botUser,
      target: message.author,
      reason: 'Discord-Invite-Link',
      extra: [
        { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
        { name: 'Content', value: `\`\`\`${message.content.slice(0, 500)}\`\`\`` },
      ],
    });
  }

  logger.info({ userId: message.author.id, channel: message.channelId }, 'automod deleted invite');
  return true;
}
