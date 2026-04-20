import { serve } from '@hono/node-server';
import { config } from './config.js';
import './db/client.js';
import { startDiscord } from './discord/client.js';
import { buildApp } from './server/app.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  logger.info({ env: config.NODE_ENV }, 'magguu-bot starting');

  await startDiscord();

  const app = buildApp();
  serve({ fetch: app.fetch, hostname: config.HTTP_HOST, port: config.HTTP_PORT }, (info) => {
    logger.info({ host: info.address, port: info.port }, 'http server listening');
  });

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

function shutdown(): void {
  logger.info('shutting down');
  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal startup error');
  process.exit(1);
});
