import { serve } from '@hono/node-server';
import { config } from './config.js';
import './db/client.js';
import { startDiscord } from './discord/client.js';
import { startScheduler, stopScheduler } from './discord/scheduler.js';
import { buildApp } from './server/app.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  logger.info({ env: config.NODE_ENV }, 'magguu-bot starting');

  // Catch-all for promise rejections / sync throws inside timer callbacks and
  // event handlers that aren't wrapped in try/catch. Without these, Node 20+
  // crashes silently to stderr and the supervisor sees no Pino log entry.
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception — exiting');
    process.exit(1);
  });

  await startDiscord();
  startScheduler();

  const app = buildApp();
  serve({ fetch: app.fetch, hostname: config.HTTP_HOST, port: config.HTTP_PORT }, (info) => {
    logger.info({ host: info.address, port: info.port }, 'http server listening');
  });

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

function shutdown(): void {
  logger.info('shutting down');
  stopScheduler();
  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal startup error');
  process.exit(1);
});
