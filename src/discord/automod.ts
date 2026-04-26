import { PermissionFlagsBits, type Message } from 'discord.js';
import { getSetting } from '../settings.js';
import { logger } from '../utils/logger.js';
import { postModLog } from './mod-log.js';

const INVITE_PATTERN =
  /(?:https?:\/\/)?(?:www\.)?(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg)\/[A-Za-z0-9-]+/i;

const URL_PATTERN = /\bhttps?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})[^\s]*/gi;

const INTERNAL_DOMAINS = new Set([
  'discord.com',
  'discordapp.com',
  'discord.gg',
  'discord.media',
  'cdn.discordapp.com',
]);

export async function runAutomod(message: Message): Promise<boolean> {
  if (!message.inGuild()) return false;
  if (!message.member) return false;
  if (message.author.bot) return false;

  const perms = message.member.permissions;
  if (perms.has(PermissionFlagsBits.ManageMessages) || perms.has(PermissionFlagsBits.Administrator)) {
    return false;
  }

  const content = message.content;

  if (getSetting('automodInviteFilter') && INVITE_PATTERN.test(content)) {
    return await deleteAndLog(message, 'Discord-Invite-Link', 'invite');
  }

  if (getSetting('automodMentionSpam')) {
    const mentionCount =
      message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 5 : 0);
    if (mentionCount >= getSetting('automodMentionThreshold')) {
      return await deleteAndLog(
        message,
        `Mention-Spam (${mentionCount} Mentions in einer Nachricht)`,
        'mention-spam',
      );
    }
  }

  if (getSetting('automodCapsFilter')) {
    const minLen = getSetting('automodCapsMinLen');
    const threshold = getSetting('automodCapsThreshold');
    const letters = content.replace(/[^A-Za-zÄÖÜäöüß]/g, '');
    if (letters.length >= minLen) {
      const upper = letters.replace(/[^A-ZÄÖÜ]/g, '').length;
      const ratio = Math.round((upper / letters.length) * 100);
      if (ratio >= threshold) {
        return await deleteAndLog(message, `Caps-Spam (${ratio}% GROSSBUCHSTABEN)`, 'caps');
      }
    }
  }

  if (getSetting('automodExternalLinkFilter')) {
    const urls = Array.from(content.matchAll(URL_PATTERN));
    const externals = urls.filter((m) => {
      const host = (m[1] ?? '').toLowerCase();
      return !INTERNAL_DOMAINS.has(host);
    });
    if (externals.length > 0) {
      return await deleteAndLog(
        message,
        `Externer Link: ${externals.map((m) => m[1]).join(', ').slice(0, 200)}`,
        'external-link',
      );
    }
  }

  const blocked = parseBlockedPhrases(getSetting('automodBlockedPhrases'));
  if (blocked.length > 0) {
    const lower = content.toLowerCase();
    const hit = blocked.find((p) => lower.includes(p));
    if (hit) {
      return await deleteAndLog(message, `Verbotene Phrase: "${hit}"`, 'blocked-phrase');
    }
  }

  return false;
}

function parseBlockedPhrases(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 2);
}

async function deleteAndLog(message: Message, reason: string, kind: string): Promise<boolean> {
  try {
    await message.delete();
  } catch (err) {
    logger.warn({ err, msgId: message.id, kind }, 'automod delete failed — missing perms?');
    return false;
  }

  try {
    const ch = message.channel;
    if ('send' in ch) {
      const warning = await ch.send({
        content: `${message.author.toString()} — ${reason}. (Auto-Moderation)`,
      });
      setTimeout(() => {
        warning.delete().catch(() => {});
      }, 6000);
    }
  } catch {
    /* ignore */
  }

  if (!message.guild) return true;
  const botUser = message.client.user;
  if (botUser) {
    await postModLog({
      guild: message.guild,
      action: 'automod',
      moderator: botUser,
      target: message.author,
      reason,
      extra: [
        { name: 'Kind', value: kind, inline: true },
        { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
        { name: 'Content', value: `\`\`\`${message.content.slice(0, 500)}\`\`\`` },
      ],
    });
  }

  logger.info({ userId: message.author.id, channel: message.channelId, kind }, 'automod triggered');
  return true;
}
