import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { isAdmin } from './middleware.js';
import { clearSessionCookie, setSessionCookie } from './session.js';

const STATE_COOKIE = 'magguu_oauth_state';
const NEXT_COOKIE = 'magguu_oauth_next';

const discordUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  global_name: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
});

function redirectUri(): string {
  if (config.DASHBOARD_BASE_URL) {
    return `${config.DASHBOARD_BASE_URL.replace(/\/$/, '')}/auth/callback`;
  }
  return '';
}

export const authRouter = new Hono();

authRouter.get('/login', (c) => {
  if (!config.DISCORD_CLIENT_SECRET || !config.SESSION_SECRET || !config.DASHBOARD_BASE_URL) {
    return c.text('Dashboard is not configured. Set DISCORD_CLIENT_SECRET, SESSION_SECRET, DASHBOARD_BASE_URL.', 503);
  }

  const state = randomBytes(16).toString('hex');
  const next = c.req.query('next') ?? '/';

  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: true,
    path: '/',
    maxAge: 600,
  });
  setCookie(c, NEXT_COOKIE, next, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: true,
    path: '/',
    maxAge: 600,
  });

  const authUrl = new URL('https://discord.com/api/oauth2/authorize');
  authUrl.searchParams.set('client_id', config.DISCORD_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri());
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'identify');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('prompt', 'none');

  return c.redirect(authUrl.toString());
});

authRouter.get('/callback', async (c) => {
  if (!config.DISCORD_CLIENT_SECRET || !config.SESSION_SECRET || !config.DASHBOARD_BASE_URL) {
    return c.text('Dashboard is not configured.', 503);
  }

  const code = c.req.query('code');
  const state = c.req.query('state');
  const storedState = getCookie(c, STATE_COOKIE);
  const next = getCookie(c, NEXT_COOKIE) ?? '/';

  deleteCookie(c, STATE_COOKIE, { path: '/' });
  deleteCookie(c, NEXT_COOKIE, { path: '/' });

  if (!code || !state || !storedState || state !== storedState) {
    logger.warn({ hasCode: !!code, stateOk: state === storedState }, 'oauth callback: bad state');
    return c.text('OAuth state mismatch.', 400);
  }

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.DISCORD_CLIENT_ID,
      client_secret: config.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    logger.error({ status: tokenRes.status, body }, 'oauth token exchange failed');
    return c.text('Token exchange failed.', 502);
  }

  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) return c.text('No access token.', 502);

  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!userRes.ok) {
    logger.error({ status: userRes.status }, 'oauth user fetch failed');
    return c.text('User fetch failed.', 502);
  }

  const parsed = discordUserSchema.safeParse(await userRes.json());
  if (!parsed.success) {
    logger.error({ err: parsed.error }, 'oauth user payload invalid');
    return c.text('Bad user payload.', 502);
  }
  const user = parsed.data;

  if (!isAdmin(user.id)) {
    logger.warn({ userId: user.id, username: user.username }, 'oauth login rejected — not admin');
    return c.text(
      `Hi ${user.username} — dein Account (${user.id}) ist nicht auf der Admin-Allowlist. Frag einen Admin, deine ID zu ADMIN_USER_IDS hinzuzufügen.`,
      403,
    );
  }

  setSessionCookie(c, {
    userId: user.id,
    username: user.username,
    globalName: user.global_name ?? null,
    avatarUrl: user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
      : null,
    issuedAt: Date.now(),
  });

  logger.info({ userId: user.id, username: user.username }, 'oauth login ok');
  return c.redirect(next);
});

authRouter.get('/logout', (c) => {
  clearSessionCookie(c);
  return c.redirect('/login');
});
