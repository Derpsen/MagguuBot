import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

// Real GET /api/admin/stats through buildApp (app.request, no socket).
// Admin access is a signed session cookie for an allowlisted user — the same
// requireAdmin path as production (tests/admin-routes.test.ts only pins the
// route inventory in source, it does not issue requests).
const dir = mkdtempSync(join(tmpdir(), 'magguu-admin-stats-'));

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ADMIN_ID = '1498095100000000001';
const BUILD_SHA = 'abcdef1234567deadbeef';
const BUILD_DATE = '2026-11-11T20:06:01Z';
Object.assign(process.env, {
  DISCORD_TOKEN: 'test-token-not-used',
  DISCORD_CLIENT_ID: '1498095100000000001',
  DISCORD_GUILD_ID: '1400000000000000099',
  WEBHOOK_SECRET: 'test-secret-0123456789abcdef',
  STATUS_API_TOKEN: 'status-token-0123456789abcdef',
  SESSION_SECRET: 'test-session-secret-0123456789',
  ADMIN_USER_IDS: ADMIN_ID,
  DATABASE_PATH: join(dir, 'bot.db'),
  MAGGUU_BUILD_SHA: BUILD_SHA,
  MAGGUU_BUILD_DATE: BUILD_DATE,
});

const { buildApp } = await import('../src/server/app.ts');
const { signSession } = await import('../src/server/auth/session.ts');
const { readBuildInfo } = await import('../src/embeds/status.ts');

const app = buildApp();
const COOKIE = '__Host-magguu_session';

function adminCookie(userId = ADMIN_ID): string {
  return `${COOKIE}=${signSession({
    userId,
    username: 'tester',
    globalName: null,
    avatarUrl: null,
    issuedAt: Date.now(),
  })}`;
}

test('unauthenticated GET /api/admin/stats is 401', async () => {
  const res = await app.request('/api/admin/stats');
  assert.equal(res.status, 401);
});

test('non-admin session GET /api/admin/stats is 401', async () => {
  const res = await app.request('/api/admin/stats', {
    headers: { cookie: adminCookie('1498095100000000002') },
  });
  assert.equal(res.status, 401);
});

test('admin GET /api/admin/stats returns build from readBuildInfo', async () => {
  const res = await app.request('/api/admin/stats', {
    headers: { cookie: adminCookie() },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { build?: { sha: string | null; date: string | null }; uptimeSeconds?: number };
  assert.deepEqual(body.build, readBuildInfo());
  assert.deepEqual(body.build, { sha: BUILD_SHA, date: BUILD_DATE });
  assert.equal(typeof body.uptimeSeconds, 'number');
});
