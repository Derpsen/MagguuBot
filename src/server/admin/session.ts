import type { Context } from 'hono';
import { z } from 'zod';
import { recordAdminAudit } from '../auth/audit.js';
import { getSession } from '../auth/middleware.js';
import { revokeUserSessions } from '../auth/revocations.js';
import { clearSessionCookie } from '../auth/session.js';

export const getMe = (c: Context<any, '/me'>) => {
  const session = getSession(c);
  return c.json({
    id: session.userId,
    username: session.username,
    globalName: session.globalName,
    avatarUrl: session.avatarUrl,
  });
};

export const postLogout = (c: Context<any, '/logout'>) => {
  recordAdminAudit(c, { action: 'session.logout' });
  clearSessionCookie(c);
  return c.json({ ok: true });
};

const revokeSchema = z.object({ userId: z.string().regex(/^\d{17,20}$/) });

export const postSessionsRevoke = async (c: Context<any, '/sessions/revoke'>) => {
  const parsed = revokeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'invalid body' }, 400);
  revokeUserSessions(parsed.data.userId);
  recordAdminAudit(c, { action: 'session.revoke', target: parsed.data.userId });
  return c.json({ ok: true });
};
