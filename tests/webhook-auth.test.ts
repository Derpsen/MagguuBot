import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

// The real Hono app (buildApp) with its real middleware order; throwaway env, requests go through app.request()
// in-process, so there is no socket and no network. Only requests that stop before any Discord post are used.
const dir = mkdtempSync(join(tmpdir(), 'magguu-webhookauth-'));
const SECRET = 'webhook-secret-0123456789abcdef';
const GH_SECRET = 'github-secret-0123456789abcdef';
const STATUS_TOKEN = 'status-token-0123456789abcdef';
process.env.DISCORD_TOKEN ??= 'test-token-not-used';
process.env.DISCORD_CLIENT_ID ??= '1498095100000000001';
process.env.DISCORD_GUILD_ID ??= '1400000000000000099';
process.env.WEBHOOK_SECRET = SECRET;
process.env.GITHUB_WEBHOOK_SECRET = GH_SECRET;
process.env.STATUS_API_TOKEN = STATUS_TOKEN;
process.env.DATABASE_PATH = join(dir, 'bot.db');

const { buildApp } = await import('../src/server/app.ts');
const { constantTimeEquals, PREAUTH_MAX } = await import('../src/server/webhook-guard.ts');

const TEST_EVENT = JSON.stringify({ eventType: 'Test' });
const post = (app: ReturnType<typeof buildApp>, path: string, init: { headers?: Record<string, string>; body?: BodyInit; method?: string } = {}) =>
  app.request(path, { method: init.method ?? 'POST', headers: { 'content-type': 'application/json', ...init.headers }, body: init.body ?? TEST_EVENT });
const hdr = (token: string): Record<string, string> => ({ 'x-magguu-token': token });

const HEADER_ROUTES = ['sonarr', 'radarr', 'seerr', 'tautulli', 'sabnzbd'];

describe('shared-secret auth on every webhook route', () => {
  for (const route of HEADER_ROUTES) {
    it(`/webhook/${route}: missing, empty, wrong and near-miss tokens are 401; the right token passes auth`, async () => {
      const app = buildApp();
      const path = `/webhook/${route}`;
      assert.equal((await post(app, path)).status, 401, 'missing');
      assert.equal((await post(app, path, { headers: hdr('') })).status, 401, 'empty');
      for (const bad of ['wrong', SECRET.slice(0, -1), `${SECRET}x`, `x${SECRET}`, `${SECRET}\u00a0`, SECRET.toUpperCase(), 'é'.repeat(SECRET.length)]) {
        assert.equal((await post(app, path, { headers: hdr(bad) })).status, 401, bad);
      }
      const ok = await post(app, path, { headers: hdr(SECRET), body: 'not json' });
      assert.ok(![401, 403, 429].includes(ok.status) && ok.status < 500, `authenticated request got ${ok.status}`);
    });
  }

  it('the 401 body is generic and never echoes the presented or the expected token', async () => {
    const app = buildApp();
    const res = await post(app, '/webhook/sonarr', { headers: hdr('presented-wrong-token') });
    const text = await res.text();
    assert.equal(res.status, 401);
    assert.deepEqual(JSON.parse(text), { ok: false, error: 'unauthorized' });
    assert.ok(!text.includes('presented-wrong-token') && !text.includes(SECRET));
  });

  it('only the documented credential locations count (query/Bearer are Prowlarr-only, the header is not Prowlarr)', async () => {
    const app = buildApp();
    assert.equal((await post(app, `/webhook/sonarr?token=${SECRET}`)).status, 401);
    assert.equal((await post(app, '/webhook/sonarr', { headers: { authorization: `Bearer ${SECRET}` } })).status, 401);
    assert.equal((await post(app, '/webhook/prowlarr', { headers: hdr(SECRET) })).status, 401);
    assert.equal((await post(app, '/webhook/prowlarr?token=wrong')).status, 401);
    assert.equal((await post(app, '/webhook/prowlarr', { headers: { authorization: 'Bearer wrong' } })).status, 401);
    for (const ok of [
      post(app, `/webhook/prowlarr?token=${SECRET}`, { body: 'not json' }),
      post(app, '/webhook/prowlarr', { headers: { authorization: `Bearer ${SECRET}` }, body: 'not json' }),
    ]) {
      const status = (await ok).status;
      assert.ok(![401, 429].includes(status) && status < 500, String(status));
    }
  });

  it('Sonarr/Radarr Test events authenticate and answer 200 without posting anything', async () => {
    const app = buildApp();
    for (const route of ['sonarr', 'radarr']) {
      const res = await post(app, `/webhook/${route}`, { headers: hdr(SECRET) });
      assert.equal(res.status, 200, route);
      assert.deepEqual(await res.json(), { ok: true, test: true });
    }
  });

  it('path tricks without a token never reach a handler', async () => {
    const app = buildApp();
    for (const path of ['/webhook/%73onarr', '/webhook//sonarr', '/webhook/sonarr/', '/Webhook/sonarr', '/webhook/sonarr/../radarr', '/webhook/SONARR', '/webhook/sonarr%2F', '//webhook/sonarr']) {
      const res = await post(app, path);
      assert.ok(res.status === 401 || res.status === 404, `${path} -> ${res.status}`);
    }
  });
});

describe('constantTimeEquals (timing-safe comparison)', () => {
  it('compares by value, tolerates different lengths and multi-byte input without throwing', () => {
    assert.equal(constantTimeEquals(SECRET, SECRET), true);
    assert.equal(constantTimeEquals(SECRET, `${SECRET}x`), false);
    assert.equal(constantTimeEquals(SECRET, SECRET.slice(1)), false);
    assert.equal(constantTimeEquals('é', 'e'), false);
    assert.equal(constantTimeEquals('é', 'ê'), false);
    assert.equal(constantTimeEquals('', ''), true);
    assert.equal(constantTimeEquals('a', ''), false);
  });

  it('every credential check in the server uses crypto.timingSafeEqual (no === on secrets)', () => {
    for (const file of ['src/server/webhook-guard.ts', 'src/server/webhooks/github.ts', 'src/server/auth/session.ts']) {
      assert.match(readFileSync(file, 'utf8'), /timingSafeEqual/, file);
    }
    const guard = readFileSync('src/server/webhook-guard.ts', 'utf8');
    assert.doesNotMatch(guard, /(?:token|secret|credential)\s*[!=]==?\s*(?:options\.)?(?:secret|token)\b/i);
    const app = readFileSync('src/server/app.ts', 'utf8');
    assert.match(app, /constantTimeEquals\(token, expected\)/, '/api/status compares its token timing-safe');
  });
});

describe('rate limit runs before auth', () => {
  it('an unauthenticated flood gets 429 before the token is even evaluated, authenticated traffic still passes', async () => {
    const app = buildApp();
    const statuses = new Set<number>();
    for (let i = 0; i < PREAUTH_MAX; i += 1) statuses.add((await post(app, '/webhook/sonarr', { headers: hdr('wrong') })).status);
    assert.deepEqual([...statuses], [401]);
    const limited = await post(app, '/webhook/sonarr', { headers: hdr('wrong') });
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { ok: false, error: 'rate limit exceeded' });
    assert.equal((await post(app, '/webhook/sonarr')).status, 429, 'missing token is limited too');
    assert.equal((await post(app, '/webhook/sonarr', { headers: hdr(SECRET) })).status, 200, 'valid secret still passes');
    assert.equal((await post(app, '/webhook/github', { body: '{}' })).status, 429, 'GitHub cannot be prechecked, so the flood limit covers it');
  });
});

describe('method and content type', () => {
  it('GET/PUT/PATCH/DELETE/OPTIONS never succeed: 401 without token, 404/405 with it', async () => {
    const app = buildApp();
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const anon = await app.request('/webhook/sonarr', { method });
      assert.equal(anon.status, 401, `${method} without token`);
      const authed = await app.request('/webhook/sonarr', { method, headers: hdr(SECRET) });
      assert.ok([404, 405].includes(authed.status), `${method} with token -> ${authed.status}`);
    }
  });

  it('a body that is not JSON is rejected (400) whatever the content type says, and never 5xx', async () => {
    const app = buildApp();
    for (const type of ['application/json', 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/xml']) {
      const res = await app.request('/webhook/sonarr', { method: 'POST', headers: { ...hdr(SECRET), 'content-type': type }, body: '<xml>nope</xml>' });
      assert.equal(res.status, 400, type);
    }
    const empty = await app.request('/webhook/sonarr', { method: 'POST', headers: hdr(SECRET) });
    assert.equal(empty.status, 400);
  });

  it('schema-invalid JSON is a 400 as well', async () => {
    const app = buildApp();
    const res = await post(app, '/webhook/sonarr', { headers: hdr(SECRET), body: JSON.stringify({ eventType: 12345 }) });
    assert.equal(res.status, 400);
  });
});

describe('body size', () => {
  const MB = 1024 * 1024;
  it('more than 1 MiB is 413 (declared length) before any parsing, with or without a valid token', async () => {
    const app = buildApp();
    const big = 'x'.repeat(MB + 1);
    for (const headers of [hdr(SECRET), hdr('wrong'), {}]) {
      const res = await app.request('/webhook/sonarr', { method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'content-length': String(MB + 1) }, body: big });
      assert.equal(res.status, 413);
    }
  });

  it('a chunked/undeclared oversize body is stopped too, exactly 1 MiB is still read', async () => {
    const app = buildApp();
    const big = new Blob([new Uint8Array(MB + 1)]);
    const res = await app.request('/webhook/sonarr', { method: 'POST', headers: hdr(SECRET), body: big.stream(), duplex: 'half' } as RequestInit);
    assert.equal(res.status, 413);
    const exact = await app.request('/webhook/sonarr', { method: 'POST', headers: hdr(SECRET), body: 'x'.repeat(MB) });
    assert.equal(exact.status, 400, 'at the limit: read, then rejected as invalid JSON');
  });

  it('GitHub rejects an oversized declared length too', async () => {
    const app = buildApp();
    const res = await app.request('/webhook/github', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(MB + 1), 'x-github-event': 'ping' },
      body: 'x'.repeat(MB + 1),
    });
    assert.equal(res.status, 413);
  });
});

describe('GitHub HMAC (its own credential, the shared token does not apply)', () => {
  const sign = (body: string, secret = GH_SECRET): string => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const body = JSON.stringify({ zen: 'Keep it logically awesome.', hook_id: 1 });
  const gh = (app: ReturnType<typeof buildApp>, headers: Record<string, string>, payload = body) =>
    app.request('/webhook/github', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: payload });

  it('missing signature or event header is 400, a malformed or wrong signature is 401', async () => {
    const app = buildApp();
    assert.equal((await gh(app, { 'x-github-event': 'ping' })).status, 400);
    assert.equal((await gh(app, { 'x-hub-signature-256': sign(body) })).status, 400);
    assert.equal((await gh(app, { 'x-github-event': 'ping', 'x-hub-signature-256': sign(body).slice('sha256='.length) })).status, 401, 'no sha256= prefix');
    assert.equal((await gh(app, { 'x-github-event': 'ping', 'x-hub-signature-256': sign(body, 'other-secret') })).status, 401, 'wrong secret');
    assert.equal((await gh(app, { 'x-github-event': 'ping', 'x-hub-signature-256': sign('{"tampered":true}') })).status, 401, 'signature of a different body');
    assert.equal((await gh(app, { 'x-github-event': 'ping', 'x-hub-signature-256': 'sha256=abc' })).status, 401, 'short signature (length mismatch, no throw)');
    assert.equal((await gh(app, { 'x-github-event': 'ping', 'x-hub-signature-256': `${sign(body)}00` })).status, 401, 'long signature');
  });

  it('the shared X-Magguu-Token does not replace the HMAC', async () => {
    const app = buildApp();
    assert.equal((await gh(app, { 'x-github-event': 'ping', ...hdr(SECRET) })).status, 400);
    assert.equal((await gh(app, { 'x-github-event': 'ping', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64), ...hdr(SECRET) })).status, 401);
  });

  it('a correct HMAC passes, and a replayed delivery id is not processed twice', async () => {
    const app = buildApp();
    const headers = { 'x-github-event': 'push-not-routed', 'x-hub-signature-256': sign(body), 'x-github-delivery': 'delivery-auth-test-1' };
    const first = await gh(app, headers);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true, skipped: 'push-not-routed' });
    const replay = await gh(app, headers);
    assert.deepEqual(await replay.json(), { ok: true, skipped: 'duplicate delivery' });
  });

  it('a validly signed body that is not JSON is 400', async () => {
    const app = buildApp();
    const bad = 'not json';
    assert.equal((await gh(app, { 'x-github-event': 'ping', 'x-hub-signature-256': sign(bad) }, bad)).status, 400);
  });
});

describe('/api/status bearer token', () => {
  it('missing, wrong and right-length wrong tokens are 401; the right token is accepted', async () => {
    const app = buildApp();
    assert.equal((await app.request('/api/status')).status, 401);
    assert.equal((await app.request('/api/status', { headers: { authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await app.request('/api/status', { headers: { authorization: `Bearer ${'x'.repeat(STATUS_TOKEN.length)}` } })).status, 401);
    assert.equal((await app.request('/api/status', { headers: { authorization: STATUS_TOKEN } })).status, 401, 'no Bearer scheme');
    assert.equal((await app.request('/api/status', { headers: { authorization: `Bearer ${STATUS_TOKEN}` } })).status, 200);
  });
});
