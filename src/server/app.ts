import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { adminRouter } from './admin/index.js';
import { authRouter } from './auth/oauth.js';
import { githubWebhook } from './webhooks/github.js';
import { maintainerrWebhook } from './webhooks/maintainerr.js';
import { radarrWebhook } from './webhooks/radarr.js';
import { sabnzbdWebhook } from './webhooks/sabnzbd.js';
import { seerrWebhook } from './webhooks/seerr.js';
import { sonarrWebhook } from './webhooks/sonarr.js';
import { tautulliWebhook } from './webhooks/tautulli.js';

const FRONTEND_DIR = resolve(process.cwd(), 'dist-frontend');
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export function buildApp(): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true, uptime: process.uptime() }));

  app.use('/webhook/*', async (c, next) => {
    if (
      c.req.path.startsWith('/webhook/github') ||
      c.req.path.startsWith('/webhook/maintainerr') ||
      c.req.path.startsWith('/webhook/tautulli')
    ) {
      await next();
      return;
    }
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
  app.route('/webhook/github', githubWebhook);
  app.route('/webhook/maintainerr', maintainerrWebhook);

  app.route('/auth', authRouter);
  app.route('/api/admin', adminRouter);

  app.get('*', (c) => {
    if (!existsSync(FRONTEND_DIR)) {
      return c.json({ ok: false, error: 'not found' }, 404);
    }
    return serveStatic(c.req.path);
  });

  app.notFound((c) => c.json({ ok: false, error: 'not found' }, 404));
  app.onError((err, c) => {
    logger.error({ err }, 'unhandled error');
    return c.json({ ok: false, error: 'internal server error' }, 500);
  });

  return app;
}

function serveStatic(pathname: string): Response {
  const cleaned = pathname.replace(/^\/+/, '');
  const candidate = cleaned ? join(FRONTEND_DIR, cleaned) : '';

  if (candidate && candidate.startsWith(FRONTEND_DIR) && existsSync(candidate)) {
    try {
      if (statSync(candidate).isFile()) return fileResponse(candidate);
    } catch {
      /* fall through */
    }
  }

  const indexHtml = join(FRONTEND_DIR, 'index.html');
  if (existsSync(indexHtml)) return fileResponse(indexHtml);
  return new Response('not found', { status: 404 });
}

function fileResponse(filePath: string): Response {
  const body = readFileSync(filePath);
  const mime = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  return new Response(body, { headers: { 'Content-Type': mime } });
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
