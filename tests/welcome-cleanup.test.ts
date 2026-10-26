import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// One-time cleanup of the old public welcome cards: strict selector with a counter-probe per condition, paced single
// deletes, abort rules, counters-only output. Fake REST, no network (one stubbed fetch test for the 429 path).
Object.assign(process.env, {
  DISCORD_TOKEN: 'test-token-not-used',
  DISCORD_CLIENT_ID: '1498095100000000001',
  DISCORD_GUILD_ID: '1400000000000000099',
  WEBHOOK_SECRET: 'test-secret-0123456789abcdef',
});
const wc = await import('../src/rollout/welcome-cleanup.ts');
const { DiscordError, DiscordRest } = await import('../src/rollout/rest.ts');
type Msg = import('../src/rollout/welcome-cleanup.ts').RawMessage;
type Ctx = import('../src/rollout/welcome-cleanup.ts').CleanupContext;

const CH = '1530000000000000700';
const BOT = '1498095100000000001';
const MEMBER = '1400000000000007777';
const COUNTER = '1550000000000000001';
const TRACKED = '1550000000000000002';
const ctx: Ctx = { channelId: CH, botId: BOT, trackedIds: new Set([TRACKED]), counterId: COUNTER };

let seq = 1560000000000000000n;
const card = (over: Partial<Msg> = {}): Msg => ({
  id: String((seq += 1n)),
  channel_id: CH,
  author: { id: BOT, bot: true },
  content: `🎉 <@${MEMBER}> hat den Server betreten!`,
  attachments: [{ filename: 'welcome.png' }],
  pinned: false,
  ...over,
});

test('selector: both exact old formats are candidates', () => {
  assert.equal(wc.classifyMessage(card(), ctx), 'candidate');
  assert.equal(wc.classifyMessage(card({ content: `↩️ <@${MEMBER}> ist zurück.` }), ctx), 'candidate');
});

// Counter-probes: each condition removed (all others valid) must turn a candidate into a skip with its own reason.
test('probe: message in another channel is never a candidate', () => {
  assert.equal(wc.classifyMessage(card({ channel_id: '1530000000000000999' }), ctx), 'other_channel');
});
test('probe: user message (even with identical text and attachment) is never a candidate', () => {
  assert.equal(wc.classifyMessage(card({ author: { id: MEMBER, bot: false } }), ctx), 'user_message');
  assert.equal(wc.classifyMessage(card({ author: { id: MEMBER } }), ctx), 'user_message');
  assert.equal(wc.classifyMessage(card({ author: null }), ctx), 'user_message');
});
test('probe: another bot / webhook as author is never a candidate', () => {
  assert.equal(wc.classifyMessage(card({ author: { id: '1498095100000000777', bot: true } }), ctx), 'other_author');
});
test('probe: no welcome.png attachment (none, other name) is never a candidate', () => {
  assert.equal(wc.classifyMessage(card({ attachments: [] }), ctx), 'no_attachment');
  assert.equal(wc.classifyMessage(card({ attachments: undefined }), ctx), 'no_attachment');
  assert.equal(wc.classifyMessage(card({ attachments: [{ filename: 'rank.png' }] }), ctx), 'no_attachment');
});
test('probe: any other text is never a candidate', () => {
  for (const content of [
    '', undefined, null,
    `🎉 <@${MEMBER}> hat den Server betreten! Willkommen`,
    `Hallo 🎉 <@${MEMBER}> hat den Server betreten!`,
    `🎉 <@!${MEMBER}> hat den Server betreten!`,
    `🎉 <@abc> hat den Server betreten!`,
    `🎉 hat den Server betreten!`,
    `🎉 <@${MEMBER}> hat den Server verlassen!`,
    `↩️ <@${MEMBER}> ist zurück`,
    `🎉 <@${MEMBER}> hat den Server betreten!\n`,
    `🎉 <@${MEMBER}> hat den Server betreten!\n<@${MEMBER}>`,
    '👋 Willkommen',
  ]) assert.equal(wc.classifyMessage(card({ content: content as string }), ctx), 'other_text', String(content));
});
test('probe: pinned message is never a candidate', () => {
  assert.equal(wc.classifyMessage(card({ pinned: true }), ctx), 'pinned');
});
test('probe: the new counter message and tracked (pinned) cards are never candidates, even if everything else matches', () => {
  assert.equal(wc.classifyMessage(card({ id: COUNTER }), ctx), 'counter_message');
  assert.equal(wc.classifyMessage(card({ id: TRACKED }), ctx), 'tracked_card');
});
test('probe: real counter / roles card shapes (embed only, no welcome.png, other text) are skipped', () => {
  assert.equal(wc.classifyMessage(card({ id: COUNTER, content: '', attachments: [] }), ctx), 'no_attachment');
  assert.equal(wc.classifyMessage(card({ id: TRACKED, content: '', attachments: [], pinned: true }), ctx), 'no_attachment');
});
test('probe: old cards whose PNG render failed (embed only) are NOT selected (strict by design)', () => {
  assert.equal(wc.classifyMessage(card({ attachments: [] }), ctx) === 'candidate', false);
});

// ─── scan + run ─────────────────────────────────────────────────────────────

interface Call { method: string; path: string }
function fakeRest(channel: Msg[], opts: { deleteErr?: (id: string, nth: number) => unknown } = {}) {
  const calls: Call[] = [];
  let deletes = 0;
  const rest = {
    async request<T>(method: string, path: string): Promise<T | null> {
      calls.push({ method, path });
      if (method === 'GET') {
        const m = /\/messages\?limit=(\d+)(?:&before=(\d+))?/.exec(path)!;
        const limit = Number(m[1]);
        const before = m[2];
        const sorted = [...channel].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
        const start = before ? sorted.findIndex((x) => x.id === before) + 1 : 0;
        return sorted.slice(start, start + limit) as unknown as T;
      }
      deletes += 1;
      const id = path.split('/').pop()!;
      const err = opts.deleteErr?.(id, deletes);
      if (err) throw err;
      const i = channel.findIndex((x) => x.id === id);
      if (i >= 0) channel.splice(i, 1);
      return null;
    },
  };
  return { rest, calls, deletes: () => deletes };
}
const de = (status: number, code: number) => new DiscordError('DELETE', `/channels/${CH}/messages/1`, status, JSON.stringify({ code, message: 'x' }));

function fixture(n = 5) {
  const olds = Array.from({ length: n }, () => card());
  const keep = [
    card({ id: COUNTER, content: '', attachments: [] }),
    card({ id: TRACKED, content: '', attachments: [], pinned: true }),
    card({ author: { id: MEMBER, bot: false } }),
    card({ pinned: true }),
    card({ attachments: [] }),
    card({ content: 'anderer Text' }),
    card({ author: { id: '1498095100000000777', bot: true } }),
  ];
  return { olds, keep, all: [...olds, ...keep] };
}

test('dry run (default): counts candidates and skips by category, issues NO delete', async () => {
  const f = fixture(5);
  const r = fakeRest([...f.all]);
  const counts = await wc.runWelcomeCleanup({ rest: r.rest, ctx, execute: false });
  assert.equal(counts.candidates, 5);
  assert.equal(counts.deleted, 0);
  assert.equal(counts.scanned, 12);
  assert.equal(counts.skipped, 7);
  assert.deepEqual(counts.skippedBy, { no_attachment: 3, user_message: 1, other_author: 1, other_text: 1, pinned: 1 });
  assert.equal(counts.scanComplete, true);
  assert.equal(r.calls.filter((c) => c.method !== 'GET').length, 0);
});

test('execute: deletes exactly the candidates with single DELETEs, >= 1.2 s apart, never bulk, everything else stays', async () => {
  const f = fixture(6);
  const channel = [...f.all];
  const r = fakeRest(channel);
  const naps: number[] = [];
  const counts = await wc.runWelcomeCleanup({ rest: r.rest, ctx, execute: true, sleepFn: async (ms) => { naps.push(ms); } });
  assert.equal(counts.deleted, 6);
  assert.equal(counts.errors, 0);
  assert.deepEqual(r.calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('/').pop()).sort(), f.olds.map((o) => o.id).sort());
  assert.ok(r.calls.every((c) => !/bulk/i.test(c.path)));
  assert.equal(naps.length, 5, 'a pause between deletes, none before the first');
  assert.ok(naps.every((ms) => ms >= 1200));
  assert.deepEqual(channel.map((m) => m.id).sort(), f.keep.map((m) => m.id).sort(), 'only the kept messages remain');
  const again = await wc.runWelcomeCleanup({ rest: fakeRest(channel).rest, ctx, execute: false });
  assert.equal(again.candidates, 0, 'idempotent');
});

test('scan limit: paginated 100 per page, stops at the limit, reports an incomplete scan; invalid limits are rejected', async () => {
  const many = Array.from({ length: 250 }, () => card());
  const r = fakeRest([...many]);
  const counts = await wc.runWelcomeCleanup({ rest: r.rest, ctx, execute: false, scanLimit: 120 });
  assert.equal(counts.scanned, 120);
  assert.equal(counts.candidates, 120);
  assert.equal(counts.scanComplete, false);
  const gets = r.calls.filter((c) => c.method === 'GET').map((c) => c.path);
  assert.equal(gets.length, 2);
  assert.match(gets[0]!, /limit=100$/);
  assert.match(gets[1]!, /limit=20&before=\d+$/);
  const all = await wc.runWelcomeCleanup({ rest: fakeRest([...many]).rest, ctx, execute: false, scanLimit: 1000 });
  assert.equal(all.scanned, 250);
  assert.equal(all.scanComplete, true);
  for (const bad of [0, -1, 1.5, 10_001, Number.NaN]) assert.throws(() => wc.normalizeScanLimit(bad), /scan-limit/);
  assert.equal(wc.normalizeScanLimit(undefined), 1000);
});

for (const code of [10003, 50001, 50013]) {
  test(`abort: permanent error ${code} stops the run at once (no further deletes)`, async () => {
    const f = fixture(6);
    const r = fakeRest([...f.all], { deleteErr: (_id, nth) => (nth === 2 ? de(code === 10003 ? 404 : 403, code) : null) });
    const counts = await wc.runWelcomeCleanup({ rest: r.rest, ctx, execute: true, sleepFn: async () => undefined });
    assert.equal(counts.aborted, 'permanent_error');
    assert.equal(counts.deleted, 1);
    assert.equal(counts.errors, 1);
    assert.equal(r.deletes(), 2, 'no third attempt');
  });
}

test('abort: a 429 that the REST client gives up on stops the run (rate_limit), nothing is hammered', async () => {
  const f = fixture(4);
  const r = fakeRest([...f.all], { deleteErr: (_id, nth) => (nth === 2 ? new DiscordError('DELETE', '/x', 429, 'Rate-Limit, erneut versuchen in 120 s') : null) });
  const counts = await wc.runWelcomeCleanup({ rest: r.rest, ctx, execute: true, sleepFn: async () => undefined });
  assert.equal(counts.aborted, 'rate_limit');
  assert.equal(r.deletes(), 2);
});

test('errors: an already-deleted message (10008) is skipped and the run continues; 5 consecutive other errors abort; a single one does not', async () => {
  const f = fixture(4);
  const r = fakeRest([...f.all], { deleteErr: (_id, nth) => (nth === 1 ? de(404, 10008) : null) });
  const counts = await wc.runWelcomeCleanup({ rest: r.rest, ctx, execute: true, sleepFn: async () => undefined });
  assert.equal(counts.deleted, 3);
  assert.equal(counts.errors, 0);
  assert.equal(counts.skippedBy.already_gone, 1);
  assert.equal(counts.aborted, null);

  const g = fixture(8);
  const r2 = fakeRest([...g.all], { deleteErr: () => de(500, 0) });
  const c2 = await wc.runWelcomeCleanup({ rest: r2.rest, ctx, execute: true, sleepFn: async () => undefined });
  assert.equal(c2.aborted, 'too_many_errors');
  assert.equal(r2.deletes(), 5);

  const h = fixture(4);
  const r3 = fakeRest([...h.all], { deleteErr: (_id, nth) => (nth === 2 ? de(500, 0) : null) });
  const c3 = await wc.runWelcomeCleanup({ rest: r3.rest, ctx, execute: true, sleepFn: async () => undefined });
  assert.equal(c3.deleted, 3);
  assert.equal(c3.errors, 1);
  assert.equal(c3.aborted, null);
});

test('real REST client: a 429 with a short retry_after is waited out, then the delete counts', async () => {
  const f = fixture(1);
  const realFetch = globalThis.fetch;
  let deleteTries = 0;
  const seen: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.push(`${init?.method} ${url}`);
    if (init?.method === 'GET') return new Response(JSON.stringify([...f.all].reverse()), { status: 200, headers: { 'content-type': 'application/json' } });
    deleteTries += 1;
    if (deleteTries === 1) return new Response(JSON.stringify({ retry_after: 0.01, global: false }), { status: 429, headers: { 'content-type': 'application/json' } });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    const counts = await wc.runWelcomeCleanup({ rest: new DiscordRest('test-token-not-used'), ctx, execute: true, sleepFn: async () => undefined });
    assert.equal(counts.deleted, 1);
    assert.equal(counts.errors, 0);
    assert.equal(deleteTries, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ─── output + CLI ───────────────────────────────────────────────────────────

test('output: counters only, no member id, message id, text, channel id or name', async () => {
  const f = fixture(3);
  const counts = await wc.runWelcomeCleanup({ rest: fakeRest([...f.all]).rest, ctx, execute: false });
  const text = wc.formatReport('dry-run', counts, 1000);
  const json = JSON.stringify({ mode: 'dry-run', ...counts });
  for (const out of [text, json]) {
    for (const secret of [MEMBER, CH, BOT, COUNTER, TRACKED, ...f.all.map((m) => m.id), 'betreten', 'zurück', 'welcome.png']) assert.ok(!out.includes(secret), `no ${secret}`);
  }
  assert.match(text, /candidates=3 deleted=0 skipped=7 errors=0/);
  assert.match(text, /Dry-Run: es wurde nichts gelöscht/);
  const run = await wc.runWelcomeCleanup({ rest: fakeRest([...f.all]).rest, ctx, execute: true, sleepFn: async () => undefined });
  assert.ok(!wc.formatReport('execute', run, 1000).includes('Dry-Run'));
});

test('CLI args: dry-run is the default, --execute is explicit, conflicts and unknown options are rejected', () => {
  assert.deepEqual(wc.parseArgs([]), { execute: false, json: false, scanLimit: 1000 });
  assert.equal(wc.parseArgs(['--dry-run']).execute, false);
  assert.equal(wc.parseArgs(['--execute', '--scan-limit=250', '--json']).execute, true);
  assert.equal(wc.parseArgs(['--scan-limit=250']).scanLimit, 250);
  assert.throws(() => wc.parseArgs(['--execute', '--dry-run']), /schließen sich aus/);
  assert.throws(() => wc.parseArgs(['--apply']), /Unbekannte Option/);
  assert.throws(() => wc.parseArgs(['--channel=123']), /Unbekannte Option/);
  assert.throws(() => wc.parseArgs(['--scan-limit=0']), /scan-limit/);
  assert.throws(() => wc.parseArgs(['--scan-limit=abc']), /Unbekannte Option/);
});

test('one-time tool only: no bulk delete, no slash command / scheduler / event wiring references it', () => {
  const lib = readFileSync('src/rollout/welcome-cleanup.ts', 'utf8');
  const cli = readFileSync('src/rollout/discord-welcome-cleanup.ts', 'utf8');
  const code = (lib + cli).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/bulkDelete|bulk-delete|messages\/bulk/i.test(code));
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const users = walk('src').filter((f) => f.endsWith('.ts') && /welcome-cleanup/.test(readFileSync(f, 'utf8')) && !f.startsWith('src/rollout/'));
  assert.deepEqual(users, [], 'nothing outside src/rollout imports the cleanup');
  assert.match(cli, /DiscordRest/);
});
