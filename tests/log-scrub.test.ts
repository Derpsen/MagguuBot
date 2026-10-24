import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
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

// ─── bare credentials in free text (fake values, built at runtime) ───

const FAKE = 'Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56Qr78';

test('scrubString: bare GitHub tokens (ghp_/gho_/ghs_/ghu_/ghr_/github_pat_) are redacted anywhere in a line', () => {
  for (const prefix of ['ghp_', 'gho_', 'ghs_', 'ghu_', 'ghr_', 'github_pat_']) {
    const out = scrubString(`push failed for ${prefix}${FAKE} (remote said no)`);
    assert.ok(!out.includes(FAKE), `${prefix}: ${out}`);
    assert.match(out, /push failed for \[redacted\] \(remote said no\)/);
  }
  assert.equal(scrubString('ghp_short is not a token'), 'ghp_short is not a token');
});

test('scrubString: JWTs are redacted, normal dotted text is not', () => {
  const jwt = `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.${'s'.repeat(20)}`;
  const out = scrubString(`session ${jwt} expired`);
  assert.equal(out, 'session [redacted] expired');
  assert.equal(scrubString('see example.com/v1.2 and node.js'), 'see example.com/v1.2 and node.js');
});

test('scrubString: Discord webhook URLs lose their token (also in nested errors), id/path stay for diagnosis', () => {
  const hook = `https://discord.com/api/webhooks/123456789012345678/${FAKE}_-x`;
  const out = scrubString(`POST ${hook} failed`);
  assert.ok(!out.includes(FAKE));
  assert.match(out, /api\/webhooks\/123456789012345678\/\[redacted\]/);
  for (const host of ['https://discordapp.com/api/v10/webhooks', 'https://ptb.discord.com/api/webhooks']) {
    const o = scrubString(`${host}/5/${FAKE}?wait=true`);
    assert.ok(!o.includes(FAKE), o);
  }
  const err = Object.assign(new Error(`failed: ${hook}`, { cause: new Error(`dns ${hook}`) }), { url: hook });
  assert.ok(!JSON.stringify(errSerializer(err)).includes(FAKE));
});

test('scrubString: "password: xyz", "secret = xyz", "passwd is xyz" free text (quoted or not), idempotent', () => {
  assert.equal(scrubString('login with password: hunter2 now'), 'login with password: [redacted] now');
  assert.equal(scrubString('Password = "correct horse"'), 'Password = [redacted]');
  assert.equal(scrubString("secret: 'abc def' ok"), 'secret: [redacted] ok');
  assert.equal(scrubString('the passwd is s3cr3t!'), 'the passwd is [redacted]');
  assert.equal(scrubString('password=abc'), 'password=[redacted]');
  const once = scrubString('password: hunter2');
  assert.equal(scrubString(once), once);
  // unrelated words stay readable
  assert.equal(scrubString('secretary meeting; the secrets of the dungeon'), 'secretary meeting; the secrets of the dungeon');
});

test('plain-string reasons (unhandledRejection style) and poster errors go through the err serializer', () => {
  let written = '';
  const stream = new Writable({ write(chunk, _enc, cb) { written += String(chunk); cb(); } });
  const log = pino({ serializers: { err: errSerializer } }, stream);
  log.error({ err: `rejected: ghp_${FAKE} password: hunter2` }, 'unhandled promise rejection');
  log.error({ err: Object.assign(new Error(`Discord said no for https://discord.com/api/webhooks/1/${FAKE}`), { code: 50013 }) }, 'failed to post embed');
  assert.ok(!written.includes(FAKE), written);
  assert.ok(!written.includes('hunter2'), written);
  assert.match(written, /50013/);
});

test('call sites log through the serializer instead of raw strings (index.ts reason, discord-poster error)', () => {
  const root = new URL('../src/', import.meta.url);
  const index = readFileSync(new URL('index.ts', root), 'utf8');
  assert.match(index, /logger\.error\(\{ err: reason \}/);
  assert.doesNotMatch(index, /logger\.error\(\{ reason \}/);
  const poster = readFileSync(new URL('server/discord-poster.ts', root), 'utf8');
  assert.doesNotMatch(poster, /logger\.(error|warn)\(\{[^}]*\berror \}/);
  assert.match(poster, /scrubString\(err instanceof Error/);
});
