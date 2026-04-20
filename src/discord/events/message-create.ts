import { logger } from '../../utils/logger.js';
import { grantXp } from '../xp.js';
import type { BotEvent } from './types.js';

export const messageCreateEvent: BotEvent<'messageCreate'> = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot) return;
    if (!message.inGuild()) return;
    if (!message.member) return;

    try {
      await grantXp(message.member);
    } catch (err) {
      logger.error({ err, userId: message.author.id }, 'grantXp failed');
    }
  },
};
