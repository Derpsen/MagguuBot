import { AttachmentBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { runAiModeration } from '../ai-automod.js';
import { runAutomod } from '../automod.js';
import { runAutoresponder } from '../autoresponder.js';
import { renderLevelUpCard } from '../cards/level-up-card.js';
import { scheduleStickyRepost } from '../sticky.js';
import { grantXp } from '../xp.js';
import type { BotEvent } from './types.js';

export const messageCreateEvent: BotEvent<'messageCreate'> = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot) return;
    if (!message.inGuild()) return;
    if (!message.member) return;

    try {
      const deleted = await runAutomod(message);
      if (deleted) return;
    } catch (err) {
      logger.error({ err, userId: message.author.id }, 'automod failed');
    }

    try {
      const deleted = await runAiModeration(message);
      if (deleted) return;
    } catch (err) {
      logger.error({ err, userId: message.author.id }, 'ai-moderation failed');
    }

    try {
      await runAutoresponder(message);
    } catch (err) {
      logger.error({ err }, 'autoresponder failed');
    }

    try {
      const result = await grantXp(message.member);
      if (result.leveledUp && message.channel.isSendable()) {
        try {
          const buffer = await renderLevelUpCard({
            username: message.author.globalName ?? message.author.username,
            avatarUrl: message.author.displayAvatarURL({ extension: 'png', size: 200 }),
            oldLevel: result.oldLevel,
            newLevel: result.newLevel,
          });
          const file = new AttachmentBuilder(buffer, { name: 'level-up.png' });
          await message.channel.send({ content: `${message.author.toString()}`, files: [file] });
        } catch (err) {
          logger.warn({ err, userId: message.author.id }, 'level-up card post failed');
        }
      }
    } catch (err) {
      logger.error({ err, userId: message.author.id }, 'grantXp failed');
    }

    try {
      scheduleStickyRepost(message);
    } catch (err) {
      logger.error({ err, channelId: message.channelId }, 'sticky schedule failed');
    }
  },
};
