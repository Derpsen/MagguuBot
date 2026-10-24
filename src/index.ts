import { serve, type ServerType } from '@hono/node-server';
import { config } from './config.js';
import { sqliteHandle } from './db/client.js';
import { getClient, startDiscord } from './discord/client.js';
import { flushPlexCardOnShutdown } from './discord/plex-card.js';
import { startScheduler, stopScheduler } from './discord/scheduler.js';
import { buildApp } from './server/app.js';
import { flushFeedBursts } from './server/feed-bursts.js';
import { logger } from './utils/logger.js';

let server: ServerType | null = null;
let shuttingDown = false;

async function main(): Promise<void> {
  logger.info({ env: config.NODE_ENV }, 'magguu-bot starting');

  // Catch-all for promise rejections / sync throws inside timer callbacks and
  // event handlers that aren't wrapped in try/catch. Without these, Node 20+
  // crashes silently to stderr and the supervisor sees no Pino log entry.
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception — exiting');
    process.exit(1);
  });

  await startDiscord();
  startScheduler();

  const app = buildApp();
  server = serve({ fetch: app.fetch, hostname: config.HTTP_HOST, port: config.HTTP_PORT }, (info) => {
    logger.info({ host: info.address, port: info.port }, 'http server listening');
  });

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info('shutting down');
  stopScheduler();
  await closeHttpServer();
  // Held burst cards (deletes/imports) are posted as summaries before Discord goes away.
  await Promise.race([
    Promise.all([flushFeedBursts(), flushPlexCardOnShutdown()]),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  try {
    getClient().destroy();
  } catch {
    /* discord may not have finished startup */
  }
  sqliteHandle.close();
  process.exit(0);
}

function closeHttpServer(): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server?.close((err) => {
      if (err) logger.warn({ err }, 'http server close failed');
      resolve();
    });
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal startup error');
  process.exit(1);
});
