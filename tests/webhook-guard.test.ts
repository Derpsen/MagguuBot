import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import {
  createWebhookGuard,
  FixedWindowLimiter,
  PREAUTH_MAX,
  WEBHOOK_MAX,
  webhookIdentity,
  webhookSource,
} from '../src/server/webhook-guard.js';

const SECRET = 'test-webhook-secret-0123456789';
const GITHUB_SECRET = 'gh-secret';

function setup(opts: { preAuthMax?: number; webhookMax?: number } = {}) {
  let now = 1_000_000;
  const logs: Array<{ obj: object; msg: string }> = [];
  const guard = createWebhookGuard({
    secret: SECRET,
    // Every request shares one IP, like all tunnel traffic without TRUSTED_PROXIES.
    clientIp: (c) => c.req.header('x-test-ip') ?? '192.168.178.19',
    logger: { warn: (obj, msg) => logs.push({ obj, msg }) },
    now: () => now,
    ...opts,
  });
  const app = new Hono();
  app.use('/webhook/*', guard.preAuth);
  app.use('/webhook/*', guard.sharedSecretAuth);
  app.post('/webhook/sonarr', (c) => c.json({ ok: true }));
  app.post('/webhook/radarr', (c) => c.json({ ok: true }));
  app.post('/webhook/prowlarr', (c) => c.json({ ok: true }));
  // GitHub-style route: verifies its own credential, then reports to the guard.
  app.post('/webhook/github', (c) => {
    if (c.req.header('x-sig') !== 'valid') return c.json({ ok: false }, 401);
    const limited = c.get('webhookGuard').authorized(c, webhookIdentity('github', GITHUB_SECRET));
    return limited ?? c.json({ ok: true });
  });
  const send = (path: string, headers: Record<string, string> = {}) =>
    app.request(path, { method: 'POST', headers, body: '{}' });
  return { send, logs, advance: (ms: number) => { now += ms; } };
}

const auth = { 'x-magguu-token': SECRET };

describe('webhook rate limiting (pre-auth flood vs. per-webhook)', () => {
  it('uses documented defaults', () => {
    assert.equal(PREAUTH_MAX, 300);
    assert.equal(WEBHOOK_MAX, 600);
  });

  it('pre-auth limit triggers for an unauthenticated flood from one IP', async () => {
    const { send } = setup({ preAuthMax: 5 });
    for (let i = 0; i < 5; i++) assert.equal((await send('/webhook/sonarr', { 'x-magguu-token': 'wrong' })).status, 401);
    assert.equal((await send('/webhook/sonarr', { 'x-magguu-token': 'wrong' })).status, 429);
    assert.equal((await send('/webhook/sonarr')).status, 429);
    // Other IPs have their own bucket.
    assert.equal((await send('/webhook/sonarr', { 'x-test-ip': '203.0.113.7' })).status, 401);
  });

  it('an unauthenticated flood does not block authenticated webhooks from the same IP', async () => {
    const { send } = setup({ preAuthMax: 5 });
    for (let i = 0; i < 50; i++) await send('/webhook/sonarr', { 'x-magguu-token': 'nope' });
    assert.equal((await send('/webhook/sonarr')).status, 429);
    assert.equal((await send('/webhook/sonarr', auth)).status, 200);
    assert.equal((await send('/webhook/radarr', auth)).status, 200);
    assert.equal((await send(`/webhook/prowlarr?token=${SECRET}`)).status, 200);
    assert.equal((await send('/webhook/prowlarr', { authorization: `Bearer ${SECRET}` })).status, 200);
  });

  it('authenticated traffic never consumes the pre-auth budget', async () => {
    const { send } = setup({ preAuthMax: 3 });
    for (let i = 0; i < 20; i++) assert.equal((await send('/webhook/sonarr', auth)).status, 200);
    // GitHub succeeds too (refunded after its own HMAC check).
    for (let i = 0; i < 10; i++) assert.equal((await send('/webhook/github', { 'x-sig': 'valid' })).status, 200);
    for (let i = 0; i < 3; i++) assert.equal((await send('/webhook/sonarr')).status, 401);
    assert.equal((await send('/webhook/sonarr')).status, 429);
  });

  it('per-webhook limit triggers per source and resets after the window', async () => {
    const { send, advance } = setup({ webhookMax: 4 });
    for (let i = 0; i < 4; i++) assert.equal((await send('/webhook/sonarr', auth)).status, 200);
    assert.equal((await send('/webhook/sonarr', auth)).status, 429);
    // Another webhook source keeps its own budget.
    assert.equal((await send('/webhook/radarr', auth)).status, 200);
    for (let i = 0; i < 4; i++) assert.equal((await send('/webhook/github', { 'x-sig': 'valid' })).status, 200);
    assert.equal((await send('/webhook/github', { 'x-sig': 'valid' })).status, 429);
    advance(60_001);
    assert.equal((await send('/webhook/sonarr', auth)).status, 200);
  });

  it('never logs the raw token', async () => {
    const { send, logs } = setup({ preAuthMax: 1, webhookMax: 1 });
    await send('/webhook/sonarr', auth);
    await send('/webhook/sonarr', auth);
    await send('/webhook/sonarr', { 'x-magguu-token': 'leaked-wrong-token' });
    await send('/webhook/sonarr', { 'x-magguu-token': 'leaked-wrong-token' });
    assert.ok(logs.length >= 2);
    const text = JSON.stringify(logs);
    assert.ok(!text.includes(SECRET) && !text.includes('leaked-wrong-token'), text);
    assert.match(text, /sonarr:[0-9a-f]{12}/);
  });
});

describe('helpers', () => {
  it('webhookSource takes the first segment', () => {
    assert.equal(webhookSource('/webhook/Sonarr'), 'sonarr');
    assert.equal(webhookSource('/webhook/github/'), 'github');
    assert.equal(webhookSource('/other'), 'unknown');
  });

  it('limiter map stays bounded', () => {
    const limiter = new FixedWindowLimiter(1, 60_000, 3);
    for (let i = 0; i < 10; i++) limiter.hit(`ip${i}`);
    assert.equal(limiter.size, 3);
  });
});
