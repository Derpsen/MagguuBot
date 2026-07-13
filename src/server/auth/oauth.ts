import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { sanitizePayload } from '../webhook-payload-redactor.js';
import {
  canonicalDashboardPath,
  canonicalDashboardUrl,
  isCanonicalDashboardRequest,
} from './canonical-dashboard.js';
import { isAdmin } from './middleware.js';
import { setSessionCookie } from './session.js';

const STATE_COOKIE = '__Host-magguu_oauth_state';
const NEXT_COOKIE = '__Host-magguu_oauth_next';
const DISCORD_API_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), DISCORD_API_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const discordUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  global_name: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
});
const discordTokenSchema = z.object({ access_token: z.string().min(1) });

function redirectUri(): string {
  if (config.DASHBOARD_BASE_URL) {
    return `${config.DASHBOARD_BASE_URL.replace(/\/$/, '')}/auth/callback`;
  }
  return '';
}

function safeNextPath(rawNext: string | undefined): string {
  const next = rawNext ?? '/';
  // Only allow same-app paths — never an absolute URL or scheme-relative path
  // that could turn an OAuth endpoint into an open redirect.
  return /^\/(?!\/)[A-Za-z0-9_\-\/?&=.%#]*$/.test(next) ? next : '/';
}

function loginErrorUrl(error: string, next = '/'): string {
  const url = new URL(canonicalDashboardPath(config.DASHBOARD_BASE_URL!, '/login'));
  url.searchParams.set('authError', error);
  url.searchParams.set('next', safeNextPath(next));
  return url.toString();
}

function isCanonicalRequest(c: import('hono').Context): boolean {
  return isCanonicalDashboardRequest(config.DASHBOARD_BASE_URL!, {
    requestHost: c.req.header('host'),
    requestUrl: c.req.url,
    forwardedHost: c.req.header('x-forwarded-host'),
    forwardedProto: c.req.header('x-forwarded-proto'),
  });
}

export const authRouter = new Hono();

authRouter.get('/login', (c) => {
  if (!config.DISCORD_CLIENT_SECRET || !config.SESSION_SECRET || !config.DASHBOARD_BASE_URL) {
    return c.text('Dashboard is not configured. Set DISCORD_CLIENT_SECRET, SESSION_SECRET, DASHBOARD_BASE_URL.', 503);
  }

  const next = safeNextPath(c.req.query('next'));
  const startUrl = new URL(canonicalDashboardPath(config.DASHBOARD_BASE_URL, '/auth/start'));
  startUrl.searchParams.set('next', next);
  return c.redirect(startUrl.toString());
});

authRouter.get('/start', (c) => {
  if (!config.DISCORD_CLIENT_SECRET || !config.SESSION_SECRET || !config.DASHBOARD_BASE_URL) {
    return c.text('Dashboard is not configured. Set DISCORD_CLIENT_SECRET, SESSION_SECRET, DASHBOARD_BASE_URL.', 503);
  }

  const next = safeNextPath(c.req.query('next'));
  if (!isCanonicalRequest(c)) {
    const startUrl = new URL(canonicalDashboardPath(config.DASHBOARD_BASE_URL, '/auth/start'));
    startUrl.searchParams.set('next', next);
    return c.redirect(startUrl.toString());
  }

  const state = randomBytes(16).toString('hex');

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

  return c.redirect(authUrl.toString());
});

authRouter.get('/callback', async (c) => {
  if (!config.DISCORD_CLIENT_SECRET || !config.SESSION_SECRET || !config.DASHBOARD_BASE_URL) {
    return c.text('Dashboard is not configured.', 503);
  }

  if (!isCanonicalRequest(c)) {
    return c.redirect(canonicalDashboardUrl(config.DASHBOARD_BASE_URL, c.req.url));
  }

  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');
  const errorDesc = c.req.query('error_description');
  const storedState = getCookie(c, STATE_COOKIE);
  const next = safeNextPath(getCookie(c, NEXT_COOKIE));

  if (error) {
    // Discord returns `state` on error responses too. Require it before
    // consuming cookies; otherwise an unrelated request could cancel another
    // tab's in-flight login.
    if (!storedState) {
      logger.warn('oauth callback: provider error without state cookie');
      return c.redirect(loginErrorUrl('state_missing', next));
    }
    if (state !== storedState) {
      logger.warn({ stateOk: false }, 'oauth callback: provider error state mismatch');
      return c.redirect(loginErrorUrl('state_mismatch', next));
    }

    deleteCookie(c, STATE_COOKIE, { path: '/', secure: true });
    deleteCookie(c, NEXT_COOKIE, { path: '/', secure: true });
    logger.warn(
      { providerError: error.slice(0, 64), hasDescription: Boolean(errorDesc) },
      'oauth callback: discord returned error',
    );
    return c.redirect(loginErrorUrl(error === 'access_denied' ? 'access_denied' : 'provider_error', next));
  }

  if (!code) {
    logger.warn('oauth callback: missing code param');
    return c.redirect(loginErrorUrl('code_missing', next));
  }

  if (!storedState) {
    logger.warn(
      { requestHost: c.req.header('host'), hasCookieHeader: Boolean(c.req.header('cookie')) },
      'oauth callback: state cookie missing',
    );
    return c.redirect(loginErrorUrl('state_missing', next));
  }

  if (state !== storedState) {
    logger.warn({ stateOk: false }, 'oauth callback: state mismatch');
    return c.redirect(loginErrorUrl('state_mismatch', next));
  }

  // A matching state makes the OAuth attempt single-use. Errors before this
  // point deliberately leave the cookies untouched so another in-flight tab
  // is not destroyed by a malformed callback.
  deleteCookie(c, STATE_COOKIE, { path: '/', secure: true });
  deleteCookie(c, NEXT_COOKIE, { path: '/', secure: true });

  let tokenRes: Response;
  try {
    tokenRes = await fetchWithTimeout('https://discord.com/api/oauth2/token', {
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
  } catch (err) {
    logger.error({ err }, 'oauth token exchange unavailable');
    return c.redirect(loginErrorUrl('provider_unavailable', next));
  }

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    logger.error({ status: tokenRes.status, body: redactOAuthErrorBody(body) }, 'oauth token exchange failed');
    return c.redirect(loginErrorUrl('token_exchange', next));
  }

  let tokenPayload: unknown;
  try {
    tokenPayload = await tokenRes.json();
  } catch (err) {
    logger.error({ err }, 'oauth token payload invalid');
    return c.redirect(loginErrorUrl('token_exchange', next));
  }
  const token = discordTokenSchema.safeParse(tokenPayload);
  if (!token.success) {
    logger.error('oauth token payload missing access token');
    return c.redirect(loginErrorUrl('token_exchange', next));
  }

  let userRes: Response;
  try {
    userRes = await fetchWithTimeout('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token.data.access_token}` },
    });
  } catch (err) {
    logger.error({ err }, 'oauth user fetch unavailable');
    return c.redirect(loginErrorUrl('provider_unavailable', next));
  }
  if (!userRes.ok) {
    logger.error({ status: userRes.status }, 'oauth user fetch failed');
    return c.redirect(loginErrorUrl('profile_fetch', next));
  }

  let userPayload: unknown;
  try {
    userPayload = await userRes.json();
  } catch (err) {
    logger.error({ err }, 'oauth user payload is not JSON');
    return c.redirect(loginErrorUrl('profile_invalid', next));
  }
  const parsed = discordUserSchema.safeParse(userPayload);
  if (!parsed.success) {
    logger.error({ err: parsed.error }, 'oauth user payload invalid');
    return c.redirect(loginErrorUrl('profile_invalid', next));
  }
  const user = parsed.data;

  if (!isAdmin(user.id)) {
    logger.warn({ userId: user.id, username: user.username }, 'oauth login rejected — not admin');
    return c.redirect(loginErrorUrl('not_allowed', next));
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

function redactOAuthErrorBody(raw: string): string {
  const trimmed = raw.slice(0, 2_000);
  try {
    return JSON.stringify(sanitizePayload(JSON.parse(trimmed))).slice(0, 1_000);
  } catch {
    return trimmed
      .replace(/(access_token|refresh_token|client_secret|token|secret)=([^&\s]+)/gi, '$1=[redacted]')
      .slice(0, 1_000);
  }
}
