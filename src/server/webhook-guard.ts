import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';

/**
 * Two-stage webhook rate limiting.
 *
 * 1. Pre-auth flood limit, per client IP (before body parsing and auth):
 *    PREAUTH_MAX unauthenticated requests per IP per window. Requests that
 *    authenticate successfully are refunded, so they never use this budget,
 *    and a request carrying the valid shared secret passes even when its IP
 *    bucket is exhausted. An unauthenticated flood therefore only throttles
 *    unauthenticated traffic and cannot starve real webhooks (also when many
 *    clients share one IP, e.g. without TRUSTED_PROXIES behind cloudflared).
 *    GitHub (HMAC over the body) cannot be prechecked; a GitHub delivery is
 *    only blocked if its own source IP is flooding unauthenticated requests.
 * 2. Per-webhook limit after successful auth: WEBHOOK_MAX requests per
 *    webhook identity (route source + short SHA-256 of the credential) per
 *    window. The raw token is never logged or stored.
 */
export const RATE_WINDOW_MS = 60_000;
export const PREAUTH_MAX = 300;
export const WEBHOOK_MAX = 600;
/** Bound the bucket maps so cycling source IPs cannot grow memory without limit. */
export const RATE_BUCKETS_MAX = 10_000;

export class FixedWindowLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    readonly max: number,
    readonly windowMs: number,
    private readonly maxKeys = RATE_BUCKETS_MAX,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one hit; returns false when the key is over its limit for this window. */
  hit(key: string): boolean {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count <= this.max;
  }

  /** Gives one hit back (used when a request turned out to be authenticated). */
  refund(key: string): void {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.count > 0) bucket.count -= 1;
  }

  sweep(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }

  get size(): number {
    return this.buckets.size;
  }
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** First path segment after /webhook/ (sonarr, radarr, github, …). */
export function webhookSource(path: string): string {
  return /^\/webhook\/([^/?#]+)/.exec(path)?.[1]?.toLowerCase() ?? 'unknown';
}

/** Route source + short hash of the credential; safe to log, never the raw token. */
export function webhookIdentity(source: string, credential: string): string {
  return `${source}:${createHash('sha256').update(credential).digest('hex').slice(0, 12)}`;
}

/** Shared-secret credential as sent by the caller (Prowlarr: ?token= or Bearer; others: X-Magguu-Token). */
export function presentedSecret(c: Context): string | undefined {
  if (c.req.path.startsWith('/webhook/prowlarr')) {
    const queryToken = c.req.query('token');
    const headerToken = c.req.header('authorization')?.replace(/^Bearer\s+/i, '').trim();
    return queryToken || headerToken || undefined;
  }
  return c.req.header('x-magguu-token') || undefined;
}

export interface WebhookLogger {
  warn(obj: object, msg: string): void;
}

export interface WebhookGuardOptions {
  secret: string;
  clientIp: (c: Context) => string | null;
  logger: WebhookLogger;
  preAuthMax?: number;
  webhookMax?: number;
  windowMs?: number;
  now?: () => number;
}

export interface WebhookGuard {
  preAuth: MiddlewareHandler;
  sharedSecretAuth: MiddlewareHandler;
  /** Call right after a route verified its own credential (GitHub HMAC). Returns a 429 response when over limit. */
  authorized(c: Context, identity: string): Response | null;
  sweep(): void;
}

declare module 'hono' {
  interface ContextVariableMap {
    webhookGuard: WebhookGuard;
    webhookAuthenticated: boolean;
  }
}

export function createWebhookGuard(options: WebhookGuardOptions): WebhookGuard {
  const windowMs = options.windowMs ?? RATE_WINDOW_MS;
  const preAuthLimiter = new FixedWindowLimiter(options.preAuthMax ?? PREAUTH_MAX, windowMs, RATE_BUCKETS_MAX, options.now);
  const webhookLimiter = new FixedWindowLimiter(options.webhookMax ?? WEBHOOK_MAX, windowMs, RATE_BUCKETS_MAX, options.now);
  const { logger } = options;

  const guard: WebhookGuard = {
    preAuth: async (c, next) => {
      c.set('webhookGuard', guard);
      const ip = options.clientIp(c) ?? 'unknown';
      if (!preAuthLimiter.hit(ip)) {
        const secret = presentedSecret(c);
        const validSecret = !!secret && !c.req.path.startsWith('/webhook/github')
          && constantTimeEquals(secret, options.secret);
        if (!validSecret) {
          // Undo the hit so the bucket count stays bounded at max + 1.
          preAuthLimiter.refund(ip);
          logger.warn({ ip, path: c.req.path }, 'webhook pre-auth flood limit exceeded');
          return c.json({ ok: false, error: 'rate limit exceeded' }, 429);
        }
        preAuthLimiter.refund(ip);
        await next();
        return;
      }
      await next();
      if (c.get('webhookAuthenticated')) preAuthLimiter.refund(ip);
    },

    sharedSecretAuth: async (c, next) => {
      if (c.req.path.startsWith('/webhook/github')) {
        // GitHub authenticates with an HMAC over the body inside its route,
        // which then calls guard.authorized().
        await next();
        return;
      }
      const token = presentedSecret(c);
      if (!token) {
        logger.warn({ path: c.req.path, ip: options.clientIp(c) }, 'webhook missing auth token');
        return c.json({ ok: false, error: 'unauthorized' }, 401);
      }
      if (!constantTimeEquals(token, options.secret)) {
        logger.warn({ path: c.req.path, ip: options.clientIp(c) }, 'webhook bad token');
        return c.json({ ok: false, error: 'unauthorized' }, 401);
      }
      const limited = guard.authorized(c, webhookIdentity(webhookSource(c.req.path), token));
      if (limited) return limited;
      await next();
    },

    authorized: (c, identity) => {
      c.set('webhookAuthenticated', true);
      if (!webhookLimiter.hit(identity)) {
        webhookLimiter.refund(identity);
        logger.warn({ identity, path: c.req.path }, 'webhook per-source rate limit exceeded');
        return c.json({ ok: false, error: 'rate limit exceeded' }, 429);
      }
      return null;
    },

    sweep: () => {
      preAuthLimiter.sweep();
      webhookLimiter.sweep();
    },
  };
  return guard;
}
