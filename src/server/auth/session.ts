import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { config } from '../../config.js';

const COOKIE_NAME = 'magguu_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export interface Session {
  userId: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
  issuedAt: number;
}

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
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts as [string, string];
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    if (Date.now() - session.issuedAt > COOKIE_MAX_AGE * 1000) return null;
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
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}
