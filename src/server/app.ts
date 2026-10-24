import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { adminRouter } from './admin/index.js';
import { clientIp } from './client-ip.js';
import { constantTimeEquals, createWebhookGuard, RATE_WINDOW_MS } from './webhook-guard.js';
import { canonicalDashboardUrl, isCanonicalDashboardRequest } from './auth/canonical-dashboard.js';
import { authRouter } from './auth/oauth.js';
import { githubWebhook } from './webhooks/github.js';
import { prowlarrWebhook } from './webhooks/prowlarr.js';
import { radarrWebhook } from './webhooks/radarr.js';
import { sabnzbdWebhook } from './webhooks/sabnzbd.js';
import { seerrWebhook } from './webhooks/seerr.js';
import { sonarrWebhook } from './webhooks/sonarr.js';
import { buildStatusSnapshot, currentBuildInfo, currentFaqStatus, currentUnseenStatus, lastWebhookBySource } from './status-snapshot.js';
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

const WEBHOOK_BODY_LIMIT = 1 * 1024 * 1024;
const ADMIN_BODY_LIMIT = 256 * 1024;

export function buildApp(): Hono {
  const app = new Hono();

  // Reject any HTTP method that we never serve. Discord/upstream services only
  // ever POST or GET; PUT/DELETE/PATCH are dashboard-only and routed below.
  app.use('*', secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https://cdn.discordapp.com', 'https://image.tmdb.org'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'", 'https://discord.com'],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
    },
    referrerPolicy: 'no-referrer',
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
    crossOriginOpenerPolicy: 'same-origin',
    crossOriginResourcePolicy: 'same-origin',
  }));

  app.get('/healthz', (c) => {
    let dbOk = false;
    try {
      db.run(sql`SELECT 1`);
      dbOk = true;
    } catch (err) {
      logger.warn({ err }, 'healthz db check failed');
    }
    return c.json({ ok: dbOk, db: dbOk ? 'ok' : 'fail' }, dbOk ? 200 : 503);
  });

  // Read-only status JSON for Home Assistant. Off unless STATUS_API_TOKEN is set, because the
  // dashboard host is public and build/webhook timing is not for anonymous callers.
  app.get('/api/status', (c) => {
    const expected = config.STATUS_API_TOKEN;
    if (!expected) return c.json({ ok: false, error: 'not found' }, 404);
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || !constantTimeEquals(token, expected)) return c.json({ ok: false, error: 'unauthorized' }, 401);
    c.header('cache-control', 'no-store');
    return c.json(buildStatusSnapshot({
      uptimeSeconds: process.uptime(),
      build: currentBuildInfo(),
      lastWebhookAt: lastWebhookBySource(),
      staleHours: config.STATUS_STALE_HOURS,
      now: new Date(),
      faq: currentFaqStatus(),
      unseen: currentUnseenStatus(),
    }));
  });

  // Webhook rate limiting is split (see src/server/webhook-guard.ts): a loose
  // per-IP flood limit before auth that only counts unauthenticated requests,
  // and a per-webhook limit after successful auth.
  const webhookGuard = createWebhookGuard({ secret: config.WEBHOOK_SECRET, clientIp, logger });
  setInterval(() => webhookGuard.sweep(), RATE_WINDOW_MS).unref();
  app.use('/webhook/*', webhookGuard.preAuth);
  app.use('/webhook/*', bodyLimit({
    maxSize: WEBHOOK_BODY_LIMIT,
    onError: (c) => {
      logger.warn({ path: c.req.path, ip: clientIp(c) }, 'webhook body too large');
      return c.json({ ok: false, error: 'payload too large' }, 413);
    },
  }));

  app.use('/webhook/*', webhookGuard.sharedSecretAuth);

  app.route('/webhook/sonarr', sonarrWebhook);
  app.route('/webhook/radarr', radarrWebhook);
  app.route('/webhook/seerr', seerrWebhook);
  app.route('/webhook/tautulli', tautulliWebhook);
  app.route('/webhook/sabnzbd', sabnzbdWebhook);
  app.route('/webhook/github', githubWebhook);
  app.route('/webhook/prowlarr', prowlarrWebhook);

  app.use('/auth/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.use('/api/admin/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.use('/api/admin/*', bodyLimit({
    maxSize: ADMIN_BODY_LIMIT,
    onError: (c) => c.json({ ok: false, error: 'payload too large' }, 413),
  }));
  // SameSite=Lax protects cross-site subrequests; state-changing methods also
  // require the dashboard's own Origin/Referer as defence-in-depth.
  app.use('/api/admin/*', async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      await next();
      return;
    }
    if (!isSameOrigin(c)) {
      logger.warn(
        { path: c.req.path, origin: c.req.header('origin'), referer: c.req.header('referer') },
        'admin: cross-origin POST blocked',
      );
      return c.json({ ok: false, error: 'cross-origin request blocked' }, 403);
    }
    await next();
  });

  app.route('/auth', authRouter);
  app.route('/api/admin', adminRouter);

  app.get('*', (c) => {
    if (/^\/(?:api|auth|webhook)(?:\/|$)/.test(c.req.path)) {
      return c.json({ ok: false, error: 'not found' }, 404);
    }
    if (
      config.DASHBOARD_BASE_URL
      && !isCanonicalDashboardRequest(config.DASHBOARD_BASE_URL, {
        requestHost: c.req.header('host'),
        requestUrl: c.req.url,
        forwardedHost: c.req.header('x-forwarded-host'),
        forwardedProto: c.req.header('x-forwarded-proto'),
      })
    ) {
      return c.redirect(canonicalDashboardUrl(config.DASHBOARD_BASE_URL, c.req.url));
    }
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
  const candidate = cleaned ? resolve(FRONTEND_DIR, cleaned) : '';

  if (candidate && isInsideFrontendDir(candidate) && existsSync(candidate)) {
    try {
      if (statSync(candidate).isFile()) return fileResponse(candidate);
    } catch {
      /* fall through */
    }
  }

  if (extname(pathname)) return new Response('not found', { status: 404 });

  const indexHtml = join(FRONTEND_DIR, 'index.html');
  if (existsSync(indexHtml)) return fileResponse(indexHtml);
  return new Response('not found', { status: 404 });
}

function isInsideFrontendDir(candidate: string): boolean {
  const rel = relative(FRONTEND_DIR, candidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function fileResponse(filePath: string): Response {
  const body = readFileSync(filePath);
  const extension = extname(filePath).toLowerCase();
  const mime = MIME_TYPES[extension] ?? 'application/octet-stream';
  const cacheControl = extension === '.html'
    ? 'no-cache'
    : filePath.includes(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600';
  return new Response(body, { headers: { 'Content-Type': mime, 'Cache-Control': cacheControl } });
}

function isSameOrigin(c: import('hono').Context): boolean {
  if (!config.DASHBOARD_BASE_URL) {
    // Dashboard-disabled deployment can't be browsed → CSRF doesn't apply.
    // The middleware is still mounted because admin routes also reject 401
    // via `requireAdmin`; this just prevents weird header-less calls from
    // succeeding when DASHBOARD_BASE_URL is unset.
    return true;
  }
  const expected = new URL(config.DASHBOARD_BASE_URL).origin;
  const origin = c.req.header('origin');
  if (origin) return origin === expected;
  const referer = c.req.header('referer');
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }
  return false;
}
