import pino from 'pino';
import { config } from '../config.js';
import { errSerializer } from './scrub.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined,
  base: { name: 'magguu-bot' },
  // Every logged `err` is scrubbed (apikey/token query values, URL credentials, registered secrets).
  serializers: { err: errSerializer },
});
