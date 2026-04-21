import { PermissionFlagsBits, type Message } from 'discord.js';
import { config } from '../config.js';
import { getSetting } from '../settings.js';
import { logger } from '../utils/logger.js';
import { postModLog } from './mod-log.js';

const MODERATION_ENDPOINT = 'https://api.openai.com/v1/moderations';
const MIN_LENGTH = 8;

interface ModerationResult {
  flagged: boolean;
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
}

interface ModerationResponse {
  results: ModerationResult[];
}

export async function runAiModeration(message: Message): Promise<boolean> {
  if (!config.OPENAI_API_KEY) return false;
  if (!getSetting('aiModerationEnabled')) return false;
  if (!message.inGuild() || !message.member) return false;
  if (message.author.bot) return false;

  const perms = message.member.permissions;
  if (perms.has(PermissionFlagsBits.ManageMessages) || perms.has(PermissionFlagsBits.Administrator)) {
    return false;
  }

  const content = message.content.trim();
  if (content.length < MIN_LENGTH) return false;

  try {
    const res = await fetch(MODERATION_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: content }),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, 'ai-moderation API returned non-ok');
      return false;
    }

    const body = (await res.json()) as ModerationResponse;
    const result = body.results[0];
    if (!result?.flagged) return false;

    const threshold = getSetting('aiModerationThreshold');
    const topCategories = Object.entries(result.category_scores)
      .filter(([_, score]) => score >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    if (topCategories.length === 0) return false;

    const categoryLabel = topCategories.map(([c]) => c).join(', ');

    try {
      await message.delete();
    } catch (err) {
      logger.warn({ err, msgId: message.id }, 'ai-moderation delete failed');
      return false;
    }

    if (message.guild && message.client.user) {
      await postModLog({
        guild: message.guild,
        action: 'automod',
        moderator: message.client.user,
        target: message.author,
        reason: `AI-Moderation: ${categoryLabel}`,
        extra: [
          { name: 'Kind', value: 'ai-moderation', inline: true },
          { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
          {
            name: 'Scores',
            value:
              '```\n' +
              topCategories.map(([c, s]) => `${c}: ${(s * 100).toFixed(1)}%`).join('\n') +
              '\n```',
          },
          { name: 'Content', value: `\`\`\`${content.slice(0, 500)}\`\`\`` },
        ],
      });
    }

    logger.info(
      { userId: message.author.id, categories: categoryLabel },
      'ai-moderation triggered',
    );
    return true;
  } catch (err) {
    logger.warn({ err }, 'ai-moderation request errored');
    return false;
  }
}
