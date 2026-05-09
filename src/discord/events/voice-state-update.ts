import { handleJtcVoiceUpdate } from '../jtc.js';
import { logger } from '../../utils/logger.js';
import type { BotEvent } from './types.js';

export const voiceStateUpdateEvent: BotEvent<'voiceStateUpdate'> = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    try {
      await handleJtcVoiceUpdate(oldState, newState);
    } catch (err) {
      logger.error({ err, userId: newState.id }, 'jtc handler failed');
    }
  },
};
