import { logger } from '../../utils/logger.js';
import { runAutomod } from '../automod.js';
import { runAutoresponder } from '../autoresponder.js';
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
      await runAutoresponder(message);
    } catch (err) {
      logger.error({ err }, 'autoresponder failed');
    }

    try {
      await grantXp(message.member);
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
