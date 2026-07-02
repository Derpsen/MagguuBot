import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { config } from '../../config.js';
import { isSessionRevoked } from './revocations.js';

// `__Host-` prefix forces Secure + Path=/ + no Domain — a sibling subdomain
// can't overwrite the cookie even if it's compromised.
const COOKIE_NAME = '__Host-magguu_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface Session {
  userId: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
  issuedAt: number;
}

const sessionSchema = z.object({
  userId: z.string().regex(/^\d{17,20}$/),
  username: z.string().min(1).max(100),
  globalName: z.string().max(100).nullable(),
  avatarUrl: z.string().url().max(500).nullable(),
  issuedAt: z.number().int().positive(),
}).strict();

function secret(): string {
  if (!config.SESSION_SECRET) {
    throw new Error('SESSION_SECRET not configured');
  }
  return config.SESSION_SECRET;
}

export function signSession(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(value: string): Session | null {
  if (!config.SESSION_SECRET || value.length > 8_192) return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts as [string, string];
  const expected = createHmac('sha256', config.SESSION_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = sessionSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    if (!parsed.success) return null;
    const session = parsed.data;
    const now = Date.now();
    if (session.issuedAt > now + MAX_CLOCK_SKEW_MS) return null;
    if (now - session.issuedAt > COOKIE_MAX_AGE * 1000) return null;
    if (isSessionRevoked(session.userId, session.issuedAt)) return null;
    return session;
  } catch {
    return null;
  }
}

export function setSessionCookie(c: Context, session: Session): void {
  const value = signSession(session);
  setCookie(c, COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: true,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

export function readSession(c: Context): Session | null {
  const raw = getCookie(c, COOKIE_NAME);
  if (!raw) return null;
  return verifySession(raw);
}

export function clearSessionCookie(c: Context): void {
  // __Host- prefix requires secure on writes, including deletes.
  deleteCookie(c, COOKIE_NAME, { path: '/', secure: true });
}
