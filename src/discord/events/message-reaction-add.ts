import { handleStarboardReactionChange } from '../starboard.js';
import { logger } from '../../utils/logger.js';
import type { BotEvent } from './types.js';

export const messageReactionAddEvent: BotEvent<'messageReactionAdd'> = {
  name: 'messageReactionAdd',
  async execute(reaction, user) {
    if (user.bot) return;
    try {
      await handleStarboardReactionChange(reaction);
    } catch (err) {
      logger.error({ err }, 'starboard reaction add failed');
    }
  },
};
