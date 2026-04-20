import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { radarrWebhook } from './webhooks/radarr.js';
import { sabnzbdWebhook } from './webhooks/sabnzbd.js';
import { seerrWebhook } from './webhooks/seerr.js';
import { sonarrWebhook } from './webhooks/sonarr.js';
import { tautulliWebhook } from './webhooks/tautulli.js';

export function buildApp(): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true, uptime: process.uptime() }));

  app.use('/webhook/*', async (c, next) => {
    const token = c.req.header('x-magguu-token');
    if (!token || !constantTimeEquals(token, config.WEBHOOK_SECRET)) {
      logger.warn({ path: c.req.path, ip: c.req.header('x-forwarded-for') }, 'webhook auth failed');
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }
    await next();
  });

  app.route('/webhook/sonarr', sonarrWebhook);
  app.route('/webhook/radarr', radarrWebhook);
  app.route('/webhook/seerr', seerrWebhook);
  app.route('/webhook/tautulli', tautulliWebhook);
  app.route('/webhook/sabnzbd', sabnzbdWebhook);

  app.notFound((c) => c.json({ ok: false, error: 'not found' }, 404));
  app.onError((err, c) => {
    logger.error({ err }, 'unhandled error');
    return c.json({ ok: false, error: 'internal server error' }, 500);
  });

  return app;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
