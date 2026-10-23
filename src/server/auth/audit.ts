import type { Context } from 'hono';
import { db } from '../../db/client.js';
import { adminAuditLog } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import { clientIp } from '../client-ip.js';
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
