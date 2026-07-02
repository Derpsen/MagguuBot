import type { Context } from 'hono';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { adminAuditLog } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import { getSession } from './middleware.js';

interface AuditArgs {
  action: string;
  target?: string;
  detail?: unknown;
}

export function recordAdminAudit(c: Context, args: AuditArgs): void {
  try {
    const session = getSession(c);
    db.insert(adminAuditLog)
      .values({
        userId: session.userId,
        action: args.action,
        target: args.target ?? null,
        detail: args.detail === undefined ? null : safeStringify(args.detail),
        ip: clientIp(c),
      })
      .run();
  } catch (err) {
    logger.warn({ err, action: args.action }, 'admin audit log insert failed');
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v).slice(0, 2000);
  } catch {
    return '[unstringifiable]';
  }
}

function clientIp(c: Context): string | null {
  if (config.TRUST_PROXY) {
    const cf = c.req.header('cf-connecting-ip');
    if (cf) return cf;
    const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (fwd) return fwd;
    const real = c.req.header('x-real-ip');
    if (real) return real;
  }
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? null;
}
