import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { Collection, MessagePayload, type EmbedBuilder, type MessageCreateOptions, type MessageEditOptions } from 'discord.js';

// Welcome counter: ONE self-editing message instead of a per-join card. Real discord.js payloads, fake Discord and
// clock, join waves, privacy counter-probes, the unchanged join DM. No network.
const dir = mkdtempSync(join(tmpdir(), 'magguu-welcome-'));
Object.assign(process.env, {
  DISCORD_TOKEN: 'test-token-not-used',
  DISCORD_CLIENT_ID: '1498095100000000001',
  DISCORD_GUILD_ID: '1400000000000000099',
  WEBHOOK_SECRET: 'test-secret-0123456789abcdef',
  DATABASE_PATH: join(dir, 'bot.db'),
});
for (const k of ['WELCOME_COUNTER_ENABLED', 'DISCORD_CHANNEL_WELCOME']) delete process.env[k];

const { config } = await import('../src/config.ts');
const { db, ensureSchema, sqliteHandle } = await import('../src/db/client.ts');
const { memberHistory } = await import('../src/db/schema.ts');
const { saveChannel } = await import('../src/discord/channel-store.ts');
const wc = await import('../src/discord/welcome-counter.ts');
const pure = await import('../src/utils/welcome-counter.ts');
const { ServerHealthManager } = await import('../src/discord/server-health-manager.ts');
const { guildMemberAddEvent } = await import('../src/discord/events/guild-member-add.ts');
const { guildMemberRemoveEvent } = await import('../src/discord/events/guild-member-remove.ts');
const { classifyBotEmbed, ROUTES } = await import('../src/utils/routing.ts');
type Rec = import('../src/discord/server-health-manager.ts').ServerHealthRecord;

ensureSchema();
after(() => {
  wc.setWelcomeCounterForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

const WELCOME_CH = '1530000000000000700';
const CH = '1520000000000000001';
const NAME = 'Zuzana_Geheimname';
const UID = '1400000000000007777';
const err = (code: number) => Object.assign(new Error(`discord ${code}`), { code });

function wire(options: MessageCreateOptions | MessageEditOptions) {
  const target = { client: { options: { allowedMentions: { parse: ['users', 'roles', 'everyone'] }, jsonTransformer: (v: unknown) => v } } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new MessagePayload(target as any, options as any).resolveBody().body as {
    content?: string; allowed_mentions?: { parse?: string[] }; components?: unknown[]; attachments?: unknown[];
    embeds?: Array<Record<string, unknown> & { title?: string; description?: string; timestamp?: string; footer?: { text: string }; fields?: Array<{ name: string; value: string }> }>;
  };
}

const stats = (over: Partial<import('../src/utils/welcome-counter.ts').WelcomeCounterStats> = {}) => ({ members: 1234, newThisWeek: 7, weekStart: '2026-10-26', ...over });

// ─── embed ──────────────────────────────────────────────────────────────────

test('embed: two numbers only, no timestamp, no author/thumbnail/image, no mention, no components', () => {
  const embed = pure.buildWelcomeCounterEmbed(stats());
  const body = wire({ embeds: [embed] });
  const e = body.embeds![0]!;
  assert.equal(e.title, '👋 Willkommen');
  assert.deepEqual(e.fields!.map((f) => [f.name, f.value]), [['Mitglieder', '1.234'], ['Neu diese Woche', '7']]);
  assert.equal(e.timestamp, undefined);
  for (const k of ['author', 'thumbnail', 'image', 'url']) assert.equal(e[k], undefined, k);
  assert.equal(e.footer?.text, pure.WELCOME_COUNTER_FOOTER);
  assert.equal(body.components, undefined);
  assert.ok(!JSON.stringify(body).includes('<@'), 'no mention anywhere');
  assert.equal(pure.buildWelcomeCounterEmbed(stats({ members: null })).toJSON().fields?.[0]?.value, '–');
  assert.equal(pure.buildWelcomeCounterEmbed(stats({ members: -5, newThisWeek: -1 })).toJSON().fields?.[1]?.value, '0');
});

// ─── throttle: join waves ───────────────────────────────────────────────────

function clock() {
  const s = { now: 1_000_000, timers: [] as Array<{ at: number; fn: () => void; id: number }>, n: 0, runs: [] as number[] };
  const trig = (run: () => Promise<unknown>, windowMs = 60_000) => new pure.CoalescedTrigger({
    run: async () => { s.runs.push(s.now); await run(); },
    windowMs,
    now: () => s.now,
    setTimer: (fn, ms) => { const id = ++s.n; s.timers.push({ at: s.now + ms, fn, id }); return id; },
    clearTimer: (h) => { s.timers = s.timers.filter((t) => t.id !== h); },
  });
  const advance = async (ms: number) => {
    const end = s.now + ms;
    for (;;) {
      const next = s.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      s.timers = s.timers.filter((t) => t.id !== next.id);
      s.now = Math.max(s.now, next.at);
      next.fn();
      await new Promise((r) => setImmediate(r));
    }
    s.now = end;
  };
  return { s, trig, advance };
}

test('trigger: a join wave (500 requests in one window) gives one leading run and ONE trailing run, never more per window', async () => {
  const c = clock();
  const t = c.trig(async () => undefined);
  for (let i = 0; i < 500; i++) { t.request(); c.s.now += 10; }
  await new Promise((r) => setImmediate(r));
  assert.equal(c.s.runs.length, 1, 'leading run only so far');
  assert.equal(c.s.timers.length, 1, 'exactly one trailing timer however many requests');
  await c.advance(60_000);
  assert.equal(c.s.runs.length, 2, 'one trailing run');
  const gaps = c.s.runs.slice(1).map((r, i) => r - c.s.runs[i]!);
  assert.ok(gaps.every((g) => g >= 60_000), `window respected: ${gaps.join(',')}`);
  await c.advance(10 * 60_000);
  assert.equal(c.s.runs.length, 2, 'quiet afterwards, no timer left');
  assert.equal(c.s.timers.length, 0);
});

test('trigger: a sustained wave over 10 windows produces at most one run per window', async () => {
  const c = clock();
  const t = c.trig(async () => undefined);
  for (let sec = 0; sec < 600; sec++) {
    for (let k = 0; k < 20; k++) t.request();
    await c.advance(1000);
  }
  await c.advance(60_000);
  assert.ok(c.s.runs.length <= 11, `runs ${c.s.runs.length}`);
  for (let i = 1; i < c.s.runs.length; i++) assert.ok(c.s.runs[i]! - c.s.runs[i - 1]! >= 60_000);
});

test('trigger: a request while a run is in flight is not lost and not run in parallel; errors are reported, not thrown', async () => {
  const c = clock();
  let release: () => void = () => undefined;
  let active = 0;
  let maxActive = 0;
  const errors: unknown[] = [];
  const t = new pure.CoalescedTrigger({
    run: async () => { active++; maxActive = Math.max(maxActive, active); c.s.runs.push(c.s.now); await new Promise<void>((r) => { release = r; }); active--; if (c.s.runs.length === 1) throw new Error('boom'); },
    windowMs: 60_000, now: () => c.s.now,
    setTimer: (fn, ms) => { c.s.timers.push({ at: c.s.now + ms, fn, id: ++c.s.n }); return c.s.n; },
    onError: (e) => errors.push(e),
  });
  t.request();
  t.request();
  t.request();
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(errors.length, 1);
  assert.equal(c.s.timers.length, 1, 'the in-flight request became ONE trailing run');
  await c.advance(60_000);
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(c.s.runs.length, 2);
  assert.equal(maxActive, 1);
  t.cancel();
});

// ─── manager behind the throttle ────────────────────────────────────────────

function rig(initial = 0) {
  const c = clock();
  const store = new Map<string, Rec>();
  const state = { members: initial, postErr: null as unknown, editErr: null as unknown };
  const calls: Array<{ op: 'post' | 'edit'; messageId?: string; embed: EmbedBuilder }> = [];
  const logs: Array<{ level: string; msg: string; data?: Record<string, unknown> }> = [];
  let n = 0;
  const manager = new ServerHealthManager({
    store: { load: (id) => store.get(id) ?? null, save: (r) => { store.set(r.channelId, { ...r }); } },
    gateway: {
      async post(_c, embed) { if (state.postErr) throw state.postErr; calls.push({ op: 'post', embed }); n += 1; return `15000000000000${String(n).padStart(5, '0')}`; },
      async edit(_c, messageId, embed) { if (state.editErr) throw state.editErr; calls.push({ op: 'edit', messageId, embed }); },
    },
    render: () => pure.buildWelcomeCounterEmbed(stats({ members: state.members })),
    label: 'welcome counter card',
    debounceMs: 30_000,
    now: () => c.s.now,
    log: (level, msg, data) => logs.push({ level, msg, ...(data ? { data } : {}) }),
  });
  const trigger = c.trig(async () => { await manager.refresh(CH); });
  return { c, store, state, calls, logs, manager, trigger };
}

test('wave end to end: 300 joins in 5 minutes = at most one Discord call per window, the last edit shows the final count, no name/id anywhere', async () => {
  const r = rig(1000);
  const log: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => { log.push(String(chunk)); return true; }) as typeof process.stdout.write;
  try {
    for (let i = 1; i <= 300; i++) {
      r.state.members = 1000 + i;
      r.trigger.request(); // a join; the member name/id never reaches the counter
      await r.c.advance(1000);
    }
    await r.c.advance(2 * 60_000);
  } finally {
    process.stdout.write = realWrite;
  }
  assert.equal(r.calls[0]?.op, 'post');
  assert.ok(r.calls.slice(1).every((x) => x.op === 'edit'), 'only edits after the first post (no post per join)');
  assert.ok(r.calls.length <= 7, `calls ${r.calls.length}`);
  const times = r.c.s.runs;
  for (let i = 1; i < times.length; i++) assert.ok(times[i]! - times[i - 1]! >= 60_000);
  assert.equal(r.calls.at(-1)?.embed.toJSON().fields?.[0]?.value, new Intl.NumberFormat('de-DE').format(1300), 'trailing edit has the final number');
  const dump = JSON.stringify(r.calls.map((x) => wire({ embeds: [x.embed] }))) + log.join('');
  assert.ok(!dump.includes(NAME) && !dump.includes(UID) && !dump.includes('<@') && !dump.includes('avatar'));
});

test('manager (welcome label): same content is unchanged; repost only on 10008/50005; 10003/50001/50013 pause quietly; failures back off', async () => {
  const r = rig(5);
  assert.equal(await r.manager.refresh(CH), 'posted');
  r.c.s.now += 120_000;
  assert.equal(await r.manager.refresh(CH), 'unchanged');
  r.state.members = 6;
  r.c.s.now += 120_000;
  r.state.editErr = err(10008);
  assert.equal(await r.manager.refresh(CH), 'reposted');
  assert.equal(r.calls.filter((x) => x.op === 'post').length, 2);
  r.state.editErr = null;
  r.state.members = 7;
  r.c.s.now += 120_000;
  r.state.editErr = err(50013);
  assert.equal(await r.manager.refresh(CH), 'paused');
  assert.equal(r.calls.filter((x) => x.op === 'post').length, 2, 'permission error never reposts');
  const warns = r.logs.filter((l) => l.level === 'warn');
  assert.equal(warns.length, 1);
  assert.match(warns[0]!.msg, /^welcome counter card edit blocked/);
  r.c.s.now += 120_000;
  assert.equal(await r.manager.refresh(CH), 'paused');
  r.state.editErr = null;
  assert.equal(await r.manager.refresh(CH, { force: true }), 'edited');
  r.state.members = 8;
  r.c.s.now += 120_000;
  r.state.editErr = new Error('network');
  assert.equal(await r.manager.refresh(CH), 'error');
  r.c.s.now += 1000;
  assert.equal(await r.manager.refresh(CH), 'backoff');
});

// ─── DB: new this week ──────────────────────────────────────────────────────

test('countNewThisWeek: plain COUNT of members whose latest join is in the local week (Monday 00:00 Berlin)', () => {
  sqliteHandle.exec('DELETE FROM member_history');
  const guildId = config.DISCORD_GUILD_ID;
  const row = (userId: string, at: string) => ({ guildId, userId, firstJoinedAt: new Date('2026-01-01T00:00:00Z'), lastJoinedAt: new Date(at), joinCount: 1 });
  db.insert(memberHistory).values([
    row('1400000000000000001', '2026-10-25T22:59:00Z'), // Sunday 23:59 Berlin (CET after DST end) = previous week
    row('1400000000000000002', '2026-10-25T23:00:00Z'), // Monday 00:00 Berlin
    row('1400000000000000003', '2026-10-28T10:00:00Z'),
  ]).run();
  db.insert(memberHistory).values({ ...row('1400000000000000004', '2026-10-28T10:00:00Z'), guildId: '1400000000000000555' }).run();
  assert.equal(config.TIME_ZONE, 'Europe/Berlin');
  assert.equal(wc.countNewThisWeek(new Date('2026-10-29T12:00:00Z')), 2);
  assert.equal(wc.loadWelcomeCounterStats(new Date('2026-10-29T12:00:00Z')).weekStart, '2026-10-26');
  assert.equal(wc.loadWelcomeCounterStats(new Date('2026-10-29T12:00:00Z')).members, null, 'no client: dash, never a REST call');
  sqliteHandle.exec('DELETE FROM member_history');
});

// ─── the join event ─────────────────────────────────────────────────────────

test('wiring: default on, tick skips silently without a welcome channel', async () => {
  assert.equal(config.WELCOME_COUNTER_ENABLED, true);
  const calls: string[] = [];
  wc.setWelcomeCounterForTests({ refresh: async (channelId: string) => { calls.push(channelId); return 'unchanged'; } });
  assert.equal(await wc.runWelcomeCounterTick(), 'skipped');
  saveChannel('welcome', WELCOME_CH);
  assert.equal(await wc.runWelcomeCounterTick(), 'unchanged');
  saveChannel('auditLog', '1530000000000000701');
  assert.deepEqual(calls, [WELCOME_CH]);
});

function fakeMember(opts: { dmFails?: boolean } = {}) {
  const sent = { welcome: [] as unknown[], audit: [] as unknown[], dm: [] as Array<MessageCreateOptions> };
  const mk = (bucket: unknown[]) => ({ isSendable: () => true, send: async (o: unknown) => { bucket.push(o); return {}; } });
  const channels = new Map<string, unknown>([[WELCOME_CH, mk(sent.welcome)], ['1530000000000000701', mk(sent.audit)]]);
  const user = {
    bot: false, id: UID, username: NAME, globalName: NAME, displayName: NAME,
    createdTimestamp: Date.now() - 400 * 86_400_000,
    displayAvatarURL: () => 'https://cdn.example/avatar.png',
  };
  const member = {
    id: UID, user, toString: () => `<@${UID}>`, displayName: NAME,
    guild: {
      id: config.DISCORD_GUILD_ID, name: 'TestServer', memberCount: 42, premiumTier: 0, iconURL: () => null,
      channels: { fetch: async (id: string) => channels.get(id) ?? null, cache: new Collection() },
      roles: { cache: new Collection(), fetch: async () => null },
      members: { me: { id: '1498095100000000001' }, fetchMe: async () => null },
    },
    roles: { cache: new Collection(), add: async () => undefined },
    send: async (o: MessageCreateOptions) => { if (opts.dmFails) throw new Error('DMs closed'); sent.dm.push(o); return {}; },
    kick: async () => undefined,
  };
  return { member, sent };
}

test('join: nothing about the member is posted in the public welcome channel; the DM keeps its role buttons; audit entry stays; one refresh is requested', async () => {
  const refreshes: string[] = [];
  wc.setWelcomeCounterForTests({ refresh: async (channelId: string) => { refreshes.push(channelId); return 'edited'; } });
  const { member, sent } = fakeMember();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await guildMemberAddEvent.execute(member as any);
  assert.equal(sent.welcome.length, 0, 'no per-join post in the welcome channel (no name, ping, avatar, PNG)');
  assert.equal(sent.dm.length, 1, 'DM unchanged');
  const dm = wire(sent.dm[0]!);
  assert.ok((dm.components ?? []).length >= 1, 'role buttons stay in the DM');
  assert.equal(sent.audit.length, 1, 'audit entry stays');
  assert.match(JSON.stringify(wire(sent.audit[0] as MessageCreateOptions)), new RegExp(UID));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(refreshes, [WELCOME_CH], 'one counter refresh for the join');
});

test('join wave through the real event: 50 joins = one refresh now, at most one more later, zero welcome posts', async () => {
  const refreshes: string[] = [];
  wc.setWelcomeCounterForTests({ refresh: async (channelId: string) => { refreshes.push(channelId); return 'edited'; } });
  let welcomePosts = 0;
  for (let i = 0; i < 50; i++) {
    const { member, sent } = fakeMember();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await guildMemberAddEvent.execute(member as any);
    welcomePosts += sent.welcome.length;
  }
  await new Promise((r) => setImmediate(r));
  assert.equal(welcomePosts, 0);
  assert.equal(refreshes.length, 1, 'the other 49 joins only ride on the single trailing timer');
});

test('leave: also only requests the counter refresh (no extra post)', async () => {
  const refreshes: string[] = [];
  wc.setWelcomeCounterForTests({ refresh: async (channelId: string) => { refreshes.push(channelId); return 'edited'; } });
  const { member, sent } = fakeMember();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await guildMemberRemoveEvent.execute(member as any);
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.welcome.length, 0);
  assert.deepEqual(refreshes, [WELCOME_CH]);
});

test('join with WELCOME_COUNTER_ENABLED=false: no refresh, still no per-join card', async () => {
  const refreshes: string[] = [];
  wc.setWelcomeCounterForTests({ refresh: async (channelId: string) => { refreshes.push(channelId); return 'edited'; } });
  const mutable = config as unknown as Record<string, unknown>;
  mutable.WELCOME_COUNTER_ENABLED = false;
  try {
    const { member, sent } = fakeMember();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await guildMemberAddEvent.execute(member as any);
    await new Promise((r) => setImmediate(r));
    assert.equal(sent.welcome.length, 0);
    assert.equal(refreshes.length, 0);
    assert.equal(await wc.runWelcomeCounterTick(), 'skipped');
  } finally {
    mutable.WELCOME_COUNTER_ENABLED = true;
  }
});

// ─── wiring, storage, routing ───────────────────────────────────────────────

test('storage: only message id + hash + times, round trip, no person column', () => {
  wc.welcomeCounterStore.save({ channelId: WELCOME_CH, messageId: '1540000000000000011', contentHash: 'abc', postedAt: 9 });
  assert.deepEqual(wc.welcomeCounterStore.load(WELCOME_CH), { channelId: WELCOME_CH, messageId: '1540000000000000011', contentHash: 'abc', postedAt: 9 });
  assert.equal(wc.welcomeCounterStore.load('1530000000000000001'), null);
  assert.deepEqual(sqliteHandle.prepare('PRAGMA table_info(welcome_counter_card)').all().map((c) => (c as { name: string }).name).sort(),
    ['channel_id', 'content_hash', 'guild_id', 'message_id', 'posted_at', 'updated_at']);
});

test('routing: the counter footer is classified as welcome and listed in ROUTES; the old per-join route is gone', () => {
  assert.deepEqual(classifyBotEmbed({ footer: pure.WELCOME_COUNTER_FOOTER }), ['welcome']);
  assert.ok(ROUTES.some((r) => r.source.startsWith('Willkommen-Zähler') && r.keys.join() === 'welcome'));
  assert.ok(!ROUTES.some((r) => r.source === 'Join (Willkommen)'));
});
