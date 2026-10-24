import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import pino from 'pino';

// Fake key, made up for the test.
const KEY = 'FAKEKEY0123456789abcdef';
const dir = mkdtempSync(join(tmpdir(), 'magguu-scrub-'));
process.env.DISCORD_TOKEN ??= 'test-token-not-used';
process.env.DISCORD_CLIENT_ID ??= '1498095100000000001';
process.env.DISCORD_GUILD_ID ??= '1400000000000000099';
process.env.WEBHOOK_SECRET ??= 'test-secret-0123456789abcdef';
process.env.DATABASE_PATH = join(dir, 'bot.db');
process.env.TAUTULLI_URL = 'http://tautulli.invalid:8181';
process.env.TAUTULLI_API_KEY = KEY;
const { errSerializer, scrubString, registerSecret } = await import('../src/utils/scrub.ts');
const { logger } = await import('../src/utils/logger.ts');
const { getRecentlyAdded } = await import('../src/services/tautulli.ts');

const URL_WITH_KEY = `http://tautulli.invalid:8181/api/v2?apikey=${KEY}&cmd=get_recently_added&count=150`;

function leakyError(): Error {
  const cause = Object.assign(new Error(`connect ECONNREFUSED while fetching ${URL_WITH_KEY}`), { code: 'ECONNREFUSED' });
  const err = Object.assign(new Error(`fetch failed: ${URL_WITH_KEY}`, { cause }), {
    config: { url: URL_WITH_KEY, headers: { 'X-Plex-Token': 'PLEXFAKE123456' } },
    url: URL_WITH_KEY,
  });
  err.stack = `Error: fetch failed: ${URL_WITH_KEY}\n    at fetch (node:internal)`;
  return err;
}

test('scrubString: query secrets, URL credentials, bearer values and registered literals', () => {
  assert.equal(scrubString('GET /api/v2?apikey=abc123&cmd=x'), 'GET /api/v2?apikey=[redacted]&cmd=x');
  assert.equal(scrubString('x-plex-token=ZZZ9 api_key=Q1'), 'x-plex-token=[redacted] api_key=[redacted]');
  assert.equal(scrubString('https://user:pw@host.example/x'), 'https://[redacted]@host.example/x');
  assert.equal(scrubString('Authorization: Bearer abcdef123456'), 'Authorization: Bearer [redacted]');
  registerSecret('LITERALSECRET99');
  assert.equal(scrubString('boom LITERALSECRET99 boom'), 'boom [redacted] boom');
  assert.equal(scrubString('plain log line without secrets'), 'plain log line without secrets');
});

test('errSerializer: message, stack, cause chain, config.url and extra props are scrubbed', () => {
  const out = JSON.stringify(errSerializer(leakyError()));
  assert.ok(!out.includes(KEY), out);
  assert.ok(!out.includes('PLEXFAKE123456'), out);
  assert.match(out, /apikey=\[redacted\]/);
  assert.match(out, /ECONNREFUSED/, 'useful error info is kept');
});

test('pino line produced with the project serializer never contains the key', () => {
  let written = '';
  const stream = new Writable({ write(chunk, _enc, cb) { written += String(chunk); cb(); } });
  const log = pino({ serializers: { err: errSerializer } }, stream);
  log.warn({ err: leakyError(), cmd: 'get_recently_added' }, 'tautulli fetch error');
  assert.ok(written.length > 0);
  assert.ok(!written.includes(KEY), written);
  const parsed = JSON.parse(written) as { err: { message: string } };
  assert.match(parsed.err.message, /apikey=\[redacted\]/);
});

test('project logger has the scrubbing err serializer installed', () => {
  // pino keeps serializers on a symbol; compare behaviour instead of internals.
  const sym = Object.getOwnPropertySymbols(logger).find((s) => s.toString() === 'Symbol(pino.serializers)');
  assert.ok(sym, 'serializers symbol present');
  const serializers = (logger as unknown as Record<symbol, { err?: (e: unknown) => unknown }>)[sym!];
  assert.ok(serializers?.err);
  assert.ok(!JSON.stringify(serializers!.err!(leakyError())).includes(KEY));
});

test('tautulli service: a fetch error that echoes the apikey URL is logged without the key (fake fetch, stubbed logger sink)', async () => {
  const calls: unknown[][] = [];
  const realWarn = logger.warn.bind(logger);
  const realFetch = globalThis.fetch;
  (logger as unknown as { warn: (...a: unknown[]) => void }).warn = (...args: unknown[]) => { calls.push(args); };
  try {
    globalThis.fetch = (async (url: string | URL) => { throw leakyErrorWith(String(url)); }) as typeof fetch;
    assert.equal(await getRecentlyAdded('movie', 5), null);
  } finally {
    globalThis.fetch = realFetch;
    (logger as unknown as { warn: typeof realWarn }).warn = realWarn;
  }
  assert.equal(calls.length, 1);
  const serialised = JSON.stringify(calls[0]);
  assert.ok(!serialised.includes(KEY), serialised);
  assert.match(serialised, /apikey=\[redacted\]/);
});

function leakyErrorWith(url: string): Error {
  return Object.assign(new Error(`fetch failed ${url}`, { cause: new Error(`dns lookup failed for ${url}`) }), { url });
}
