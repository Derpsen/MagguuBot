import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { MessagePayload, type EmbedBuilder, type MessageCreateOptions, type MessageEditOptions } from 'discord.js';

// Server health card: week key, anonymous active-user counter, embed (real discord.js payloads), manager lifecycle
// (fake Discord + clock), DB counters, privacy (no ids/hashes in DB or logs) and wiring. No network.
const dir = mkdtempSync(join(tmpdir(), 'magguu-health-'));
Object.assign(process.env, {
  DISCORD_TOKEN: 'test-token-not-used',
  DISCORD_CLIENT_ID: '1498095100000000001',
  DISCORD_GUILD_ID: '1400000000000000099',
  WEBHOOK_SECRET: 'test-secret-0123456789abcdef',
  DATABASE_PATH: join(dir, 'bot.db'),
});
for (const k of ['SERVER_HEALTH_CARD_ENABLED', 'DISCORD_CHANNEL_SERVER_HEALTH']) delete process.env[k];

const { config } = await import('../src/config.ts');
const { ensureSchema, sqliteHandle } = await import('../src/db/client.ts');
const { saveChannel } = await import('../src/discord/channel-store.ts');
const { dispatchChatInputCommand } = await import('../src/discord/command-dispatch.ts');
const health = await import('../src/discord/server-health.ts');
const hstats = await import('../src/discord/server-health-stats.ts');
const { ServerHealthManager } = await import('../src/discord/server-health-manager.ts');
const { cardPostOptions, cardEditOptions } = await import('../src/discord/plex-card.ts');
const pure = await import('../src/utils/server-health.ts');
const { classifyBotEmbed, ROUTES } = await import('../src/utils/routing.ts');
type ServerHealthRecord = import('../src/discord/server-health-manager.ts').ServerHealthRecord;
type ServerHealthStats = import('../src/utils/server-health.ts').ServerHealthStats;

ensureSchema();
after(() => {
  health.setServerHealthForTests(null);
  hstats.setActiveUserCounterForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

const TZ = 'Europe/Berlin';
const USER = '1400000000000004242';
const OTHER = '1400000000000004343';

function wire(options: MessageCreateOptions | MessageEditOptions) {
  const target = { client: { options: { allowedMentions: { parse: ['users', 'roles', 'everyone'] }, jsonTransformer: (v: unknown) => v } } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new MessagePayload(target as any, options as any).resolveBody().body as {
    content?: string; allowed_mentions?: { parse?: string[] }; components?: unknown[];
    embeds?: Array<{ title?: string; description?: string; timestamp?: string; footer?: { text: string }; fields?: Array<{ name: string; value: string; inline?: boolean }> }>;
  };
}

const stats = (over: Partial<ServerHealthStats> = {}): ServerHealthStats => ({
  members: 1234,
  activeUsers: 87,
  commandsTotal: 456,
  topCommands: [
    { name: 'faq', count: 200 }, { name: 'status', count: 100 }, { name: 'plex', count: 80 },
    { name: 'tag', count: 50 }, { name: 'ping', count: 20 }, { name: 'rank', count: 6 },
  ],
  weekStart: '2026-10-26',
  ...over,
});

// ─── week key + counter ─────────────────────────────────────────────────────

test('healthWeekKey: local Monday, switches at local midnight (also across DST end)', () => {
  assert.equal(pure.healthWeekKey(new Date(Date.UTC(2026, 9, 25, 21, 59)), TZ), '2026-10-19', 'Sunday 23:59 CET/CEST still the old week');
  assert.equal(pure.healthWeekKey(new Date(Date.UTC(2026, 9, 25, 23, 0)), TZ), '2026-10-26', 'Monday 00:00 CET (DST ended on that Sunday)');
  assert.equal(pure.healthWeekKey(new Date(Date.UTC(2026, 9, 28, 12, 0)), TZ), '2026-10-26');
  assert.equal(pure.healthWeekKey(new Date(Date.UTC(2026, 2, 29, 23, 30)), TZ), '2026-03-30', 'Monday 01:30 CEST after the DST start');
});

test('sanitizeCommandName: only real command-name shapes are counted', () => {
  assert.equal(pure.sanitizeCommandName('FAQ'), 'faq');
  assert.equal(pure.sanitizeCommandName('movie-night'), 'movie-night');
  for (const bad of ['', 'a b', '<@123>', '@everyone', 'x'.repeat(33), 'a/b', '`x`']) assert.equal(pure.sanitizeCommandName(bad), null, bad);
});

function counter(keys: Buffer[] = []) {
  const saves: Array<[string, number]> = [];
  const weeks: string[] = [];
  let base = 0;
  let i = 0;
  const c = new pure.ActiveUserCounter({
    loadBase: () => base,
    saveCount: (w, n) => { saves.push([w, n]); },
    onWeek: (w) => { weeks.push(w); },
    randomKey: () => keys[i++] ?? Buffer.alloc(32, i),
  });
  return { c, saves, weeks, setBase: (n: number) => { base = n; } };
}

test('ActiveUserCounter: counts distinct users once, saves only the number, resets with the week', () => {
  const r = counter();
  r.c.record(USER, '2026-10-26');
  r.c.record(USER, '2026-10-26');
  r.c.record(OTHER, '2026-10-26');
  r.c.record('', '2026-10-26');
  assert.equal(r.c.count('2026-10-26'), 2);
  assert.deepEqual(r.saves, [['2026-10-26', 1], ['2026-10-26', 2]], 'a repeated user writes nothing');
  assert.deepEqual(r.weeks, ['2026-10-26']);
  // new week: counter and hashes are gone, the same user counts again from zero
  r.c.record(USER, '2026-11-02');
  assert.equal(r.c.count('2026-11-02'), 1);
  assert.equal(r.c.distinctInMemory, 1);
  assert.deepEqual(r.weeks, ['2026-10-26', '2026-11-02']);
  assert.ok(!JSON.stringify(r.saves).includes(USER), 'no id in what is persisted');
});

test('ActiveUserCounter: after a restart the persisted number is the base (no ids to restore)', () => {
  const r = counter();
  r.setBase(40);
  r.c.record(USER, '2026-10-26');
  assert.equal(r.c.count('2026-10-26'), 41);
  assert.deepEqual(r.saves.at(-1), ['2026-10-26', 41]);
});

test('ActiveUserCounter: counters with different random keys are independent and expose no id', () => {
  const seenDigests: string[] = [];
  const spy = new pure.ActiveUserCounter({
    loadBase: () => 0, saveCount: () => {}, randomKey: () => Buffer.alloc(32, 7),
  });
  spy.record(USER, 'w1');
  assert.equal(spy.distinctInMemory, 1);
  // Same user + different key (a second counter) can never be matched: the sets are private and hold 12 hex chars.
  const other = new pure.ActiveUserCounter({ loadBase: () => 0, saveCount: () => {}, randomKey: () => Buffer.alloc(32, 9) });
  other.record(USER, 'w1');
  assert.equal(other.distinctInMemory, 1);
  seenDigests.push(JSON.stringify(Object.keys(spy)), JSON.stringify(Object.keys(other)));
  assert.ok(!seenDigests.join('').includes(USER));
});

// ─── embed ──────────────────────────────────────────────────────────────────

test('embed: real discord.js payload, three counters, top 5, no timestamp, no mentions, within limits', () => {
  const embed = pure.buildServerHealthEmbed(stats());
  const body = wire(cardPostOptions(embed));
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.equal(body.content, undefined);
  assert.equal(body.embeds?.length, 1);
  const e = body.embeds?.[0];
  assert.equal(e?.title, '📊 Server-Health');
  assert.equal(e?.footer?.text, 'MagguuBot · Server-Health');
  assert.equal(e?.timestamp, undefined);
  assert.match(e?.description ?? '', /26\.10\.2026/);
  const f = e?.fields ?? [];
  assert.deepEqual(f.slice(0, 3).map((x) => [x.name, x.value, x.inline]), [
    ['Mitglieder', '1.234', true], ['Aktive Nutzer', '87', true], ['Befehle', '456', true],
  ]);
  const topLines = (f[3]?.value ?? '').split('\n');
  assert.equal(topLines.length, 5, 'top 5 only');
  assert.equal(topLines[0], '1. /faq · 200×');
  assert.ok(!topLines.join('\n').includes('rank'));
  const edit = wire(cardEditOptions(embed));
  assert.deepEqual(edit.allowed_mentions, { parse: [] });
  assert.deepEqual(edit.components, []);
});

test('embed: unknown member count shows a dash, no commands shows a note, hostile names stay inert', () => {
  const e1 = pure.buildServerHealthEmbed(stats({ members: null, commandsTotal: 0, topCommands: [] })).toJSON();
  assert.equal(e1.fields?.[0]?.value, '–');
  assert.equal(e1.fields?.[3]?.value, 'Noch keine Befehle.');
  const e2 = pure.buildServerHealthEmbed(stats({ topCommands: [{ name: '*bold*_x_<@123>@everyone', count: 2 }] })).toJSON();
  const v = e2.fields?.[3]?.value ?? '';
  assert.ok(!/(?<!\\)\*/.test(v), 'markdown escaped');
  const body = wire(cardPostOptions(pure.buildServerHealthEmbed(stats({ topCommands: [{ name: '@everyone', count: 2 }] }))));
  assert.deepEqual(body.allowed_mentions, { parse: [] });
});

test('hash: ignores the timestamp, changes with content', () => {
  const a = pure.buildServerHealthEmbed(stats());
  const b = pure.buildServerHealthEmbed(stats()).setTimestamp(new Date(1));
  assert.equal(pure.serverHealthHash(a), pure.serverHealthHash(b));
  assert.notEqual(pure.serverHealthHash(a), pure.serverHealthHash(pure.buildServerHealthEmbed(stats({ activeUsers: 88 }))));
});

// ─── manager ────────────────────────────────────────────────────────────────

const err = (code: number) => Object.assign(new Error(`discord ${code}`), { code });
const CH = '1520000000000000001';

function rig(over: { store?: Map<string, ServerHealthRecord>; now?: number } = {}) {
  const store = over.store ?? new Map<string, ServerHealthRecord>();
  const state = { now: over.now ?? 1_000_000, stats: stats(), postErr: null as unknown, editErr: null as unknown, saveFail: false };
  const calls: Array<{ op: 'post' | 'edit'; messageId?: string; embed: EmbedBuilder }> = [];
  const logs: Array<{ level: string; msg: string; data?: Record<string, unknown> }> = [];
  let n = 0;
  const manager = new ServerHealthManager({
    store: {
      load: (c) => store.get(c) ?? null,
      save: (r) => { if (state.saveFail) throw new Error('disk'); store.set(r.channelId, { ...r }); },
    },
    gateway: {
      async post(_c, embed) { if (state.postErr) throw state.postErr; calls.push({ op: 'post', embed }); n += 1; return `150000000000000${String(n).padStart(4, '0')}`; },
      async edit(_c, messageId, embed) { if (state.editErr) throw state.editErr; calls.push({ op: 'edit', messageId, embed }); },
    },
    stats: () => state.stats,
    now: () => state.now,
    log: (level, msg, data) => logs.push({ level, msg, ...(data ? { data } : {}) }),
  });
  return { manager, store, state, calls, logs };
}

test('manager: first refresh posts, the same content is unchanged, new numbers edit in place', async () => {
  const r = rig();
  assert.equal(await r.manager.refresh(CH), 'posted');
  assert.equal(r.calls.length, 1);
  r.state.now += 15 * 60_000;
  assert.equal(await r.manager.refresh(CH), 'unchanged');
  r.state.now += 15 * 60_000;
  r.state.stats = stats({ activeUsers: 90 });
  assert.equal(await r.manager.refresh(CH), 'edited');
  assert.equal(r.calls.length, 2);
  assert.equal(r.calls[1]?.op, 'edit');
  assert.equal(r.calls[1]?.messageId, r.store.get(CH)?.messageId);
  assert.equal(r.logs.length, 0, 'quiet on the normal path');
});

test('manager: restart (new manager, persisted record) edits the same message and never posts a second card', async () => {
  const a = rig();
  await a.manager.refresh(CH);
  const b = rig({ store: a.store, now: a.state.now + 20 * 60_000 });
  b.state.stats = stats({ commandsTotal: 500 });
  assert.equal(await b.manager.refresh(CH), 'edited');
  assert.equal(b.calls.filter((c) => c.op === 'post').length, 0);
});

test('manager: repost only when Discord says the message is gone (10008 / 50005)', async () => {
  for (const code of [10008, 50005]) {
    const r = rig();
    await r.manager.refresh(CH);
    const first = r.store.get(CH)?.messageId;
    r.state.now += 20 * 60_000;
    r.state.stats = stats({ activeUsers: 1 });
    r.state.editErr = err(code);
    assert.equal(await r.manager.refresh(CH), 'reposted', String(code));
    assert.notEqual(r.store.get(CH)?.messageId, first);
  }
  // any other edit error never reposts
  const r = rig();
  await r.manager.refresh(CH);
  r.state.now += 20 * 60_000;
  r.state.stats = stats({ activeUsers: 1 });
  r.state.editErr = err(50035);
  assert.equal(await r.manager.refresh(CH), 'error');
  assert.equal(r.calls.filter((c) => c.op === 'post').length, 1);
});

test('manager: 10003 / 50001 / 50013 pause quietly (one warn, no repost, no alarm); force lifts the pause', async () => {
  for (const code of [10003, 50001, 50013]) {
    for (const where of ['post', 'edit'] as const) {
      const r = rig();
      if (where === 'edit') { await r.manager.refresh(CH); r.state.now += 20 * 60_000; r.state.stats = stats({ activeUsers: 5 }); r.state.editErr = err(code); }
      else r.state.postErr = err(code);
      assert.equal(await r.manager.refresh(CH), 'paused', `${code}/${where}`);
      assert.equal(r.logs.filter((l) => l.level === 'warn').length, 1);
      assert.ok(!r.logs.some((l) => /alarm|ops/i.test(l.msg)));
      r.state.now += 5 * 60_000;
      assert.equal(await r.manager.refresh(CH), 'paused', 'still paused, no extra calls or logs');
      assert.equal(r.logs.length, 1);
      r.state.editErr = null; r.state.postErr = null;
      assert.notEqual(await r.manager.refresh(CH, { force: true }), 'paused');
    }
  }
  // after the pause (30 min) the card tries again by itself
  const r = rig();
  r.state.postErr = err(10003);
  await r.manager.refresh(CH);
  r.state.postErr = null;
  r.state.now += 31 * 60_000;
  assert.equal(await r.manager.refresh(CH), 'posted');
});

test('manager: transient failures back off exponentially (capped), success resets, nothing is saved on failure', async () => {
  const r = rig();
  r.state.postErr = err(500);
  assert.equal(await r.manager.refresh(CH), 'error'); // backoff 1 min
  assert.equal(r.store.size, 0);
  r.state.now += 61_000;
  assert.equal(await r.manager.refresh(CH), 'error'); // backoff 2 min
  r.state.now += 61_000;
  assert.equal(await r.manager.refresh(CH), 'backoff');
  r.state.now += 60_000;
  assert.equal(await r.manager.refresh(CH), 'error'); // backoff 4 min
  for (let i = 0; i < 10; i += 1) { r.state.now += 31 * 60_000; await r.manager.refresh(CH); }
  r.state.now += 29 * 60_000;
  r.state.postErr = null;
  // cap is 30 minutes: the next attempt after 31 min always goes through
  r.state.now += 2 * 60_000;
  assert.equal(await r.manager.refresh(CH), 'posted');
  assert.equal(r.logs.filter((l) => l.level === 'warn').length > 0, true);
  // reset: a following failure starts again at the first delay
  r.state.stats = stats({ activeUsers: 3 });
  r.state.editErr = err(500);
  r.state.now += 20 * 60_000;
  assert.equal(await r.manager.refresh(CH), 'error');
  r.state.now += 61_000;
  r.state.editErr = null;
  assert.equal(await r.manager.refresh(CH), 'edited');
});

test('manager: refreshes inside the debounce window are skipped (force skips the debounce)', async () => {
  const r = rig();
  assert.equal(await r.manager.refresh(CH), 'posted');
  r.state.now += 10_000;
  r.state.stats = stats({ activeUsers: 9 });
  assert.equal(await r.manager.refresh(CH), 'debounced');
  assert.equal(r.calls.length, 1);
  assert.equal(await r.manager.refresh(CH, { force: true }), 'edited');
});

test('manager: parallel refreshes never double-post; a failing stats provider is a quiet error', async () => {
  const r = rig();
  const [a, b, c] = await Promise.all([r.manager.refresh(CH), r.manager.refresh(CH), r.manager.refresh(CH)]);
  assert.equal(r.calls.filter((x) => x.op === 'post').length, 1);
  assert.deepEqual([a, b, c].sort(), ['debounced', 'debounced', 'posted']);
  const m = new ServerHealthManager({
    store: { load: () => null, save: () => {} },
    gateway: { post: async () => 'x', edit: async () => {} },
    stats: () => { throw new Error('db'); },
    log: () => {},
  });
  assert.equal(await m.refresh(CH), 'error');
});

// ─── DB counters ────────────────────────────────────────────────────────────

const rowsOf = (table: string) => sqliteHandle.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
const wipe = () => { for (const t of ['server_health_week', 'server_health_command']) sqliteHandle.prepare(`DELETE FROM ${t}`).run(); hstats.setActiveUserCounterForTests(null); };

test('DB counters: commands per name, top 5 ordered (ties by name), total, current week only', () => {
  wipe();
  const mon = new Date('2026-10-26T10:00:00Z');
  for (const [name, n] of [['faq', 3], ['status', 3], ['plex', 2], ['tag', 1], ['ping', 1], ['rank', 1]] as const) for (let i = 0; i < n; i += 1) hstats.recordCommandUse(name, mon);
  hstats.recordCommandUse('<@1>', mon);
  hstats.recordCommandUse('', mon);
  const s = hstats.loadServerHealthStats(321, mon);
  assert.equal(s.members, 321);
  assert.equal(s.weekStart, '2026-10-26');
  assert.equal(s.commandsTotal, 11);
  assert.deepEqual(s.topCommands.map((c) => `${c.name}:${c.count}`), ['faq:3', 'status:3', 'plex:2', 'ping:1', 'rank:1']);
});

test('DB counters: a new week deletes the old rows (counters and number), only counts remain', () => {
  wipe();
  const w1 = new Date('2026-10-26T10:00:00Z');
  const w2 = new Date('2026-11-03T10:00:00Z');
  hstats.recordCommandUse('faq', w1);
  hstats.recordActiveUser(USER, w1);
  assert.equal(hstats.loadServerHealthStats(null, w1).activeUsers, 1);
  assert.equal(rowsOf('server_health_command').length, 1);
  hstats.recordActiveUser(USER, w2); // rollover
  const s = hstats.loadServerHealthStats(null, w2);
  assert.equal(s.weekStart, '2026-11-02');
  assert.equal(s.commandsTotal, 0);
  assert.equal(s.activeUsers, 1);
  assert.deepEqual(rowsOf('server_health_command'), []);
  assert.deepEqual(rowsOf('server_health_week').map((r) => r.week), ['2026-11-02']);
});

test('DB counters: a restarted process continues from the persisted number', () => {
  wipe();
  const now = new Date('2026-10-28T10:00:00Z');
  hstats.recordActiveUser(USER, now);
  hstats.recordActiveUser(OTHER, now);
  hstats.setActiveUserCounterForTests(null); // "restart": memory gone, only the number is in the DB
  assert.equal(hstats.loadServerHealthStats(null, now).activeUsers, 2);
  hstats.recordActiveUser('1400000000000005555', now);
  assert.equal(hstats.loadServerHealthStats(null, now).activeUsers, 3);
});

test('privacy: no user id, no hash and no key in any table, the DB files or the log output', () => {
  wipe();
  const written: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => { written.push(String(chunk)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => { written.push(String(chunk)); return true; }) as typeof process.stderr.write;
  const now = new Date('2026-10-28T10:00:00Z');
  try {
    hstats.recordActiveUser(USER, now);
    hstats.recordActiveUser(OTHER, now);
    hstats.recordCommandUse('faq', now);
    hstats.loadServerHealthStats(10, now);
  } finally {
    process.stdout.write = realWrite;
    process.stderr.write = realErr;
  }
  const weekRows = rowsOf('server_health_week');
  assert.deepEqual(Object.keys(weekRows[0] ?? {}).sort(), ['active_count', 'updated_at', 'week']);
  assert.deepEqual(Object.keys(rowsOf('server_health_command')[0] ?? {}).sort(), ['command', 'count', 'week']);
  assert.deepEqual(sqliteHandle.prepare('PRAGMA table_info(server_health_card)').all().map((c) => (c as { name: string }).name).sort(),
    ['channel_id', 'content_hash', 'guild_id', 'message_id', 'posted_at', 'updated_at']);
  const dump = JSON.stringify([rowsOf('server_health_week'), rowsOf('server_health_command'), rowsOf('server_health_card')]);
  assert.ok(!dump.includes(USER) && !dump.includes(OTHER));
  sqliteHandle.pragma('wal_checkpoint(TRUNCATE)');
  for (const f of readdirSync(dir)) {
    const bytes = readFileSync(join(dir, f)).toString('latin1');
    assert.ok(!bytes.includes(USER) && !bytes.includes(OTHER), `no id in ${f}`);
  }
  assert.equal(written.join('').includes(USER) || written.join('').includes(OTHER), false, 'no id in log output');
});

// ─── hooks ──────────────────────────────────────────────────────────────────

test('command dispatch counts executed commands only (not unknown, not denied) and tolerates odd interactions', async () => {
  wipe();
  const now = new Date();
  const mk = (name: string, perms: bigint | null = 0n, user: unknown = { id: USER }) => {
    const replies: unknown[] = [];
    return { replies, i: { commandName: name, user, memberPermissions: perms === null ? null : { has: () => true, bitfield: perms }, reply: async (p: unknown) => { replies.push(p); } } };
  };
  let ran = 0;
  const open = { data: { toJSON: () => ({ default_member_permissions: null }) }, execute: async () => { ran += 1; } };
  const locked = { data: { toJSON: () => ({ default_member_permissions: '8' }) }, execute: async () => { ran += 1; } };
  const registry = new Map<string, typeof open>([['faq', open], ['admin', locked]]);
  const log = { warn: () => {} };
  assert.equal(await dispatchChatInputCommand(mk('faq').i as never, registry as never, log), 'executed');
  assert.equal(await dispatchChatInputCommand(mk('faq', 0n, undefined).i as never, registry as never, log), 'executed', 'no user object: still fine');
  assert.equal(await dispatchChatInputCommand(mk('nope').i as never, registry as never, log), 'unknown');
  assert.equal(await dispatchChatInputCommand(mk('admin', null).i as never, registry as never, log), 'denied');
  assert.equal(ran, 2);
  const s = hstats.loadServerHealthStats(null, now);
  assert.deepEqual(s.topCommands, [{ name: 'faq', count: 2 }]);
  assert.equal(s.activeUsers, 1, 'one distinct user (the interaction without a user adds none)');
});

// ─── wiring: config, channel, tick, routing ─────────────────────────────────

test('wiring: defaults, channel resolution (override, then health), silent skip without a channel, disabled skip', async () => {
  assert.equal(config.SERVER_HEALTH_CARD_ENABLED, true);
  assert.equal(config.DISCORD_CHANNEL_SERVER_HEALTH, undefined);
  const mutable = config as unknown as Record<string, unknown>;
  const calls: Array<{ channelId: string; force?: boolean }> = [];
  health.setServerHealthForTests({ refresh: async (channelId: string, o?: { force?: boolean }) => { calls.push({ channelId, force: o?.force }); return 'edited'; } });

  assert.equal(health.serverHealthChannelId(), undefined);
  assert.equal(await health.runServerHealthTick(), 'skipped', 'no channel known: nothing happens');
  assert.equal(calls.length, 0);

  saveChannel('health', '1530000000000000900');
  assert.equal(health.serverHealthChannelId(), '1530000000000000900');
  assert.equal(await health.runServerHealthTick(), 'edited');
  assert.deepEqual(calls.map((c) => c.channelId), ['1530000000000000900']);

  mutable.DISCORD_CHANNEL_SERVER_HEALTH = '1530000000000000901';
  try {
    assert.equal(health.serverHealthChannelId(), '1530000000000000901');
    await health.runServerHealthTick();
    assert.equal(calls.at(-1)?.channelId, '1530000000000000901');
  } finally {
    mutable.DISCORD_CHANNEL_SERVER_HEALTH = undefined;
  }

  mutable.SERVER_HEALTH_CARD_ENABLED = false;
  try {
    const before = calls.length;
    assert.equal(await health.runServerHealthTick(), 'skipped');
    assert.equal(calls.length, before);
  } finally {
    mutable.SERVER_HEALTH_CARD_ENABLED = true;
  }
});

test('wiring: card store roundtrip and member count without a Discord client is null', () => {
  health.serverHealthStore.save({ channelId: '1530000000000000900', messageId: '1540000000000000009', contentHash: 'abc', postedAt: 5 });
  assert.deepEqual(health.serverHealthStore.load('1530000000000000900'), { channelId: '1530000000000000900', messageId: '1540000000000000009', contentHash: 'abc', postedAt: 5 });
  assert.equal(health.serverHealthStore.load('1530000000000000001'), null);
  assert.equal(health.cachedMemberCount(), null);
});

test('routing: the card footer is classified as health and listed in ROUTES; /doctor needs no new key', () => {
  assert.deepEqual(classifyBotEmbed({ footer: pure.SERVER_HEALTH_FOOTER }), ['health']);
  const row = ROUTES.find((r) => r.source.startsWith('Server-Health-Karte'));
  assert.deepEqual(row?.keys, ['health']);
});
