import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, mock } from 'node:test';

// GET /healthz through the real app (app.request, no socket): DB ok/fail x gateway ready / short outage / long outage,
// startup grace, and a body that carries no secrets or ids. The gateway probe and the clock are fakes.
const dir = mkdtempSync(join(tmpdir(), 'magguu-healthz-'));
const TOKEN = 'test-token-not-used';
Object.assign(process.env, {
  DISCORD_TOKEN: TOKEN,
  DISCORD_CLIENT_ID: '1498095100000000001',
  DISCORD_GUILD_ID: '1400000000000000099',
  WEBHOOK_SECRET: 'test-secret-0123456789abcdef',
  STATUS_API_TOKEN: 'status-token-0123456789abcdef',
  DATABASE_PATH: join(dir, 'bot.db'),
  GATEWAY_GRACE_SECONDS: '300',
});

mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
const gh = await import('../src/discord/gateway-health.ts');
const { buildApp } = await import('../src/server/app.ts');
const { sqliteHandle } = await import('../src/db/client.ts');

let live = { ready: false, pingMs: null as number | null };
gh.setGatewayProbe(() => live);
const app = buildApp();
const get = async () => {
  const res = await app.request('/healthz');
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};
const tick = (ms: number) => mock.timers.tick(ms);

describe('GET /healthz gateway state', () => {
  it('startup: never ready but inside the grace window is 200 degraded (state starting)', async () => {
    tick(60_000);
    const { status, body } = await get();
    assert.equal(status, 200);
    assert.equal(body.status, 'degraded');
    assert.equal(body.ok, true);
    assert.equal(body.db, 'ok');
    assert.equal(body.gateway.ready, false);
    assert.equal(body.gateway.state, 'starting');
    assert.equal(body.gateway.lastReadyAt, null);
    assert.equal(body.gateway.graceSeconds, 300);
  });

  it('ready: 200 ok with ping and last ready timestamp', async () => {
    live = { ready: true, pingMs: 41.6 };
    gh.noteGatewayReady();
    const { status, body } = await get();
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.gateway.ready, true);
    assert.equal(body.gateway.state, 'ready');
    assert.equal(body.gateway.pingMs, 42);
    assert.equal(body.gateway.notReadySeconds, null);
    assert.equal(body.gateway.lastReadyAt, new Date(Date.now()).toISOString());
  });

  it('short outage (reconnect): still 200, status degraded, no ping while down', async () => {
    live = { ready: false, pingMs: 41 };
    gh.noteGatewayDown();
    tick(120_000);
    const { status, body } = await get();
    assert.equal(status, 200);
    assert.equal(body.status, 'degraded');
    assert.equal(body.gateway.state, 'reconnecting');
    assert.equal(body.gateway.pingMs, null);
    assert.equal(body.gateway.notReadySeconds, 120);
    assert.equal(body.gateway.beyondGrace, false);
  });

  it('exactly at the grace limit is still 200; one second later is 503 unhealthy', async () => {
    tick(180_000);
    assert.equal((await get()).status, 200);
    tick(1_000);
    const { status, body } = await get();
    assert.equal(status, 503);
    assert.equal(body.status, 'unhealthy');
    assert.equal(body.ok, false);
    assert.equal(body.db, 'ok');
    assert.equal(body.gateway.beyondGrace, true);
  });

  it('recovery after a long outage: ready again is 200 ok', async () => {
    live = { ready: true, pingMs: 55 };
    gh.noteGatewayReady();
    const { status, body } = await get();
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.gateway.notReadySeconds, null);
  });

  it('a missed down event is reconciled from the live probe (not ready is detected without events)', async () => {
    live = { ready: false, pingMs: null };
    assert.equal((await get()).body.gateway.notReadySeconds, 0);
    tick(301_000);
    assert.equal((await get()).status, 503);
    live = { ready: true, pingMs: 60 };
  });

  it('the body carries no secrets, ids or names', async () => {
    const text = JSON.stringify((await get()).body);
    for (const secret of [TOKEN, 'status-token', 'test-secret', '1498095100000000001', '1400000000000000099', dir]) {
      assert.ok(!text.includes(secret), `leaked ${secret}`);
    }
    assert.deepEqual(Object.keys((await get()).body).sort(), ['db', 'gateway', 'ok', 'status']);
    assert.deepEqual(Object.keys((await get()).body.gateway).sort(),
      ['beyondGrace', 'graceSeconds', 'lastReadyAt', 'notReadySeconds', 'pingMs', 'ready', 'state']);
  });

  it('DB down is 503 unhealthy with a ready gateway, as before', async () => {
    live = { ready: true, pingMs: 30 };
    gh.noteGatewayReady();
    sqliteHandle.close();
    const { status, body } = await get();
    assert.equal(status, 503);
    assert.equal(body.status, 'unhealthy');
    assert.equal(body.db, 'fail');
    assert.equal(body.ok, false);
    assert.equal(body.gateway.ready, true);
  });
});

describe('GatewayTracker (startup grace)', () => {
  it('never ready: counted from process start, beyond grace only after the window; ping values are sanitised', () => {
    const t = new gh.GatewayTracker(1_000_000);
    const down = { ready: false, pingMs: null };
    assert.equal(t.report(down, 1_000_000 + 299_000, 300_000).beyondGrace, false);
    const late = t.report(down, 1_000_000 + 301_000, 300_000);
    assert.equal(late.beyondGrace, true);
    assert.equal(late.state, 'starting');
    assert.equal(late.notReadySeconds, 301);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(t.report({ ready: true, pingMs: bad }, 1_400_000, 300_000).pingMs, null);
    }
  });
});
