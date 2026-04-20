import type { Context, Next } from 'hono';
import { config } from '../../config.js';
import { readSession, type Session } from './session.js';

export function isAdmin(userId: string): boolean {
  if (!config.ADMIN_USER_IDS) return false;
  const allowlist = config.ADMIN_USER_IDS.split(',').map((s) => s.trim()).filter(Boolean);
  return allowlist.includes(userId);
}

export async function requireAdmin(c: Context, next: Next): Promise<Response | void> {
  const session = readSession(c);
  if (!session || !isAdmin(session.userId)) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }
  c.set('session', session);
  await next();
}

export function getSession(c: Context): Session {
  const session = c.get('session') as Session | undefined;
  if (!session) throw new Error('session not set — requireAdmin middleware missing?');
  return session;
}
