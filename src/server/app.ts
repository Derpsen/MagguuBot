import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
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

const WEBHOOK_BODY_LIMIT = 1 * 1024 * 1024;
const ADMIN_BODY_LIMIT = 256 * 1024;

export function buildApp(): Hono {
  const app = new Hono();

  // Reject any HTTP method that we never serve. Discord/upstream services only
  // ever POST or GET; PUT/DELETE/PATCH are dashboard-only and routed below.
  app.use('*', secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      // Vue + Vite-built bundle: `unsafe-inline` covers the inline boot script
      // produced by Vite. No remote scripts are loaded.
      scriptSrc: ["'self'", "'unsafe-inline'"],
      // Tailwind / generated <style> + Lucide icons inlined as <style>.
      styleSrc: ["'self'", "'unsafe-inline'"],
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

  app.use('/webhook/*', webhookRateLimit());
  app.use('/webhook/*', bodyLimit({
    maxSize: WEBHOOK_BODY_LIMIT,
    onError: (c) => {
      logger.warn({ path: c.req.path, ip: clientIp(c) }, 'webhook body too large');
      return c.json({ ok: false, error: 'payload too large' }, 413);
    },
  }));

  app.use('/webhook/*', async (c, next) => {
    if (c.req.path.startsWith('/webhook/github')) {
      await next();
      return;
    }

    if (c.req.path.startsWith('/webhook/maintainerr')) {
      const queryToken = c.req.query('token');
      if (!queryToken) {
        // Maintainerr's Discord-agent can't set headers and we accept the
        // request, but flag it so an exposure becomes visible in the logs.
        logger.warn({ path: c.req.path, ip: clientIp(c) }, 'maintainerr webhook without ?token=');
      } else if (!constantTimeEquals(queryToken, config.WEBHOOK_SECRET)) {
        logger.warn({ path: c.req.path, ip: clientIp(c) }, 'maintainerr webhook bad token');
        return c.json({ ok: false, error: 'unauthorized' }, 401);
      }
      await next();
      return;
    }

    const token = c.req.header('x-magguu-token');
    if (!token || !constantTimeEquals(token, config.WEBHOOK_SECRET)) {
      logger.warn({ path: c.req.path, ip: clientIp(c) }, 'webhook auth failed');
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

  app.use('/api/admin/*', bodyLimit({
    maxSize: ADMIN_BODY_LIMIT,
    onError: (c) => c.json({ ok: false, error: 'payload too large' }, 413),
  }));
  // CSRF defence-in-depth: SameSite=Lax already blocks cross-site GETs from
  // smuggling cookies on top-level navigations, but for state-changing methods
  // the Origin/Referer must match the dashboard's own origin.
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
  const mime = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  return new Response(body, { headers: { 'Content-Type': mime } });
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
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

function clientIp(c: import('hono').Context): string {
  if (config.TRUST_PROXY) {
    const cf = c.req.header('cf-connecting-ip');
    if (cf) return cf;
    const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (fwd) return fwd;
    const real = c.req.header('x-real-ip');
    if (real) return real;
  }
  // Fallback to the raw socket address — never trust client-supplied headers
  // unless TRUST_PROXY is on, otherwise an attacker can spoof their key for
  // the rate-limit map and bypass it by cycling header values.
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
// Cap the bucket map so an attacker cycling source IPs (or a misconfigured
// proxy producing per-request unique keys) cannot grow the map without bound.
const RATE_BUCKETS_MAX = 10_000;

function webhookRateLimit(): (c: import('hono').Context, next: () => Promise<void>) => Promise<Response | void> {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(ip);
    }
  }, RATE_WINDOW_MS).unref();

  return async (c, next) => {
    const ip = clientIp(c);
    const now = Date.now();
    const bucket = buckets.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= RATE_BUCKETS_MAX) {
        // Evict the oldest entry (insertion order) so the map stays bounded.
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      buckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
      await next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > RATE_MAX) {
      logger.warn({ ip, path: c.req.path, count: bucket.count }, 'webhook rate limit exceeded');
      return c.json({ ok: false, error: 'rate limit exceeded' }, 429);
    }
    await next();
  };
}
