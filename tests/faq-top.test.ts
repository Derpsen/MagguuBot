import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { MessagePayload, type EmbedBuilder, type MessageCreateOptions } from 'discord.js';

// Weekly FAQ top: aggregation, week window, embed (real discord.js payloads), manager lifecycle and the anonymous
// counter table. Throwaway env + DB; Discord and the clock are fakes, no network.
const dir = mkdtempSync(join(tmpdir(), 'magguu-faqtop-'));
Object.assign(process.env, {
  DISCORD_TOKEN: 'test-token-not-used',
  DISCORD_CLIENT_ID: '1498095100000000001',
  DISCORD_GUILD_ID: '1400000000000000099',
  WEBHOOK_SECRET: 'test-secret-0123456789abcdef',
  DATABASE_PATH: join(dir, 'bot.db'),
});
for (const k of ['FAQ_TOP_ENABLED', 'FAQ_TOP_DAY', 'FAQ_TOP_HOUR', 'DISCORD_CHANNEL_FAQ_TOP', 'DISCORD_CHANNEL_WEEKLY_DIGEST']) delete process.env[k];

const { config } = await import('../src/config.ts');
const { ensureSchema, sqliteHandle } = await import('../src/db/client.ts');
const { saveChannel } = await import('../src/discord/channel-store.ts');
const stats = await import('../src/discord/faq-stats.ts');
const topWiring = await import('../src/discord/faq-top.ts');
const { FaqTopManager } = await import('../src/discord/faq-top-manager.ts');
const { cardPostOptions } = await import('../src/discord/plex-card.ts');
const top = await import('../src/utils/faq-top.ts');
const { classifyBotEmbed, ROUTES } = await import('../src/utils/routing.ts');
type FaqTopRecord = import('../src/discord/faq-top-manager.ts').FaqTopRecord;
type FaqEntry = import('../src/utils/faq-matcher.ts').FaqEntry;

ensureSchema();
after(() => {
  topWiring.setFaqTopForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

const TZ = 'Europe/Berlin';
const PAGE = 'https://ui.magguu.xyz/faq';
const entry = (id: number, question: string): FaqEntry => ({ id, category: 'Allgemein', question, answer: `Antwort ${id}` });
const ENTRIES = [entry(1, 'Wie installiere ich MagguuUI?'), entry(2, 'Wo finde ich die Einstellungen?'), entry(3, 'Warum fehlt mein Profil?')];

// Monday 2026-10-26 10:00 Berlin (CET, one day after the DST end) = 09:00 UTC.
const SLOT = Date.UTC(2026, 9, 26, 9, 0);

function wire(options: MessageCreateOptions) {
  const target = { client: { options: { allowedMentions: { parse: ['users', 'roles', 'everyone'] }, jsonTransformer: (v: unknown) => v } } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new MessagePayload(target as any, options).resolveBody().body as {
    content?: string; allowed_mentions?: { parse?: string[] };
    embeds?: Array<{ title?: string; description?: string; footer?: { text: string }; fields?: Array<{ name: string; value: string }> }>;
  };
}

// ─── pure part ──────────────────────────────────────────────────────────────

test('summarizeFaqUsage: sums per entry and source, ranks by uses then id, ignores unknown sources and entries', () => {
  const s = top.summarizeFaqUsage([
    { faqId: 2, source: 'command', count: 2 },
    { faqId: 2, source: 'autocomplete', count: 3 },
    { faqId: 1, source: 'autoanswer', count: 5 },
    { faqId: 3, source: 'command', count: 5 },
    { faqId: 9, source: 'command', count: 50 },
    { faqId: 1, source: 'mystery', count: 7 },
    { faqId: 1, source: 'command', count: -4 },
  ], new Set([1, 2, 3]));
  assert.equal(s.total, 15);
  assert.deepEqual(s.bySource, { command: 7, autocomplete: 3, autoanswer: 5 });
  assert.deepEqual(s.ranked.map((r) => [r.faqId, r.uses]), [[1, 5], [2, 5], [3, 5]], 'tie: lower id first');
});

test('faqTopWindow: the seven full local days before the slot day, also across the DST end', () => {
  assert.deepEqual(top.faqTopWindow(SLOT, TZ), { fromDay: '2026-10-19', toDay: '2026-10-25' });
  // Monday 2026-03-30 10:00 (CEST) after the DST start on 2026-03-29
  assert.deepEqual(top.faqTopWindow(Date.UTC(2026, 2, 30, 8, 0), TZ), { fromDay: '2026-03-23', toDay: '2026-03-29' });
});

test('embed: top question, further questions, usage split; nothing below the minimum or without a known entry', () => {
  const summary = top.summarizeFaqUsage([
    { faqId: 2, source: 'command', count: 4 }, { faqId: 2, source: 'autocomplete', count: 3 },
    { faqId: 1, source: 'autoanswer', count: 2 }, { faqId: 3, source: 'command', count: 1 },
  ]);
  const embed = top.buildFaqTopEmbed({ summary, entries: ENTRIES, fromDay: '2026-10-19', toDay: '2026-10-25', pageUrl: PAGE });
  assert.ok(embed);
  const json = embed.toJSON();
  assert.equal(json.title, '📚 FAQ der Woche');
  assert.equal(json.footer?.text, top.FAQ_TOP_FOOTER);
  assert.match(json.description ?? '', /19\.10\.2026 bis 25\.10\.2026/);
  assert.match(json.description ?? '', /\*\*Wo finde ich die Einstellungen\?\*\*\n7× abgerufen/);
  assert.match(json.fields?.[0]?.value ?? '', /^2\. Wie installiere ich MagguuUI\\?\?? · 2×\n3\. /);
  assert.equal(json.fields?.[1]?.value, '10 Abrufe · /faq-Suche 5 · /faq-Auswahl 3 · Auto-Antwort 2');

  const few = top.summarizeFaqUsage([{ faqId: 1, source: 'command', count: 2 }]);
  assert.equal(top.buildFaqTopEmbed({ summary: few, entries: ENTRIES, fromDay: 'a', toDay: 'b', pageUrl: PAGE }), null);
  const unknown = top.summarizeFaqUsage([{ faqId: 77, source: 'command', count: 9 }]);
  assert.equal(top.buildFaqTopEmbed({ summary: unknown, entries: ENTRIES, fromDay: 'a', toDay: 'b', pageUrl: PAGE }), null);
});

test('real discord.js payload: one embed, no content, no pings, hostile titles inert and clipped, within 6000 characters', () => {
  const evil = `@everyone <@123456789012345678> **bold** ${'x'.repeat(400)}`;
  const entries = [entry(1, evil), entry(2, '@here [x](http://evil.example) `code` ||spoiler||'), entry(3, 'c'), entry(4, 'd'), entry(5, 'e'), entry(6, 'f')];
  const summary = top.summarizeFaqUsage(entries.map((e, i) => ({ faqId: e.id, source: 'command', count: 10 - i })));
  const embed = top.buildFaqTopEmbed({ summary, entries, fromDay: '2026-10-19', toDay: '2026-10-25', pageUrl: PAGE });
  assert.ok(embed);
  const body = wire(cardPostOptions(embed));
  assert.equal(body.content, undefined);
  assert.deepEqual(body.allowed_mentions?.parse, []);
  assert.equal(body.embeds?.length, 1);
  const text = JSON.stringify(body.embeds);
  assert.ok(!text.includes('@everyone') && !text.includes('@here'), 'mentions defused');
  assert.ok(!text.includes('<@123456789012345678>'));
  assert.ok(!/\*\*bold\*\*/.test(body.embeds?.[0]?.description ?? ''), 'markdown escaped');
  assert.ok((body.embeds?.[0]?.description ?? '').length < 700, 'question clipped');
  assert.equal(body.embeds?.[0]?.fields?.[0]?.value.split('\n').length, 4, 'top 5: the top entry plus four more');
  const total = JSON.stringify(body.embeds).length;
  assert.ok(total < 6000);
});

test('routing: the footer belongs to the weekly digest channel and has a matrix row', () => {
  assert.deepEqual(classifyBotEmbed({ footer: top.FAQ_TOP_FOOTER }), ['weeklyDigest']);
  assert.ok(ROUTES.some((r) => r.keys.includes('weeklyDigest') && r.source.startsWith('FAQ der Woche')));
});

// ─── manager lifecycle ──────────────────────────────────────────────────────

class MemStore {
  record: FaqTopRecord | null = null;
  saves = 0;
  load() { return this.record ? { ...this.record } : null; }
  save(r: FaqTopRecord) { this.record = { ...r }; this.saves += 1; }
}

function rig(opts: { rows?: Array<{ faqId: number; source: string; count: number }>; channel?: string | undefined; now: number; store?: MemStore; failPost?: unknown; entries?: () => Promise<readonly FaqEntry[]> }) {
  const store = opts.store ?? new MemStore();
  const posts: Array<{ channelId: string; embed: EmbedBuilder }> = [];
  const logs: Array<{ level: string; msg: string; data?: Record<string, unknown> }> = [];
  let failPost = opts.failPost;
  const state = { now: opts.now, rows: opts.rows ?? [{ faqId: 1, source: 'command', count: 4 }], usageCalls: [] as string[] };
  const manager = new FaqTopManager({
    store, timeZone: TZ, day: 1, hour: 10, pageUrl: PAGE,
    now: () => state.now,
    channelId: () => ('channel' in opts ? opts.channel : '1530000000000000500'),
    usage: (from, to) => { state.usageCalls.push(`${from}..${to}`); return state.rows; },
    entries: opts.entries ?? (async () => ENTRIES),
    post: async (channelId, embed) => {
      if (failPost) throw failPost;
      posts.push({ channelId, embed });
      return `15400000000000009${posts.length}`;
    },
    log: (level, msg, data) => logs.push({ level, msg, ...(data ? { data } : {}) }),
  });
  return { manager, store, posts, logs, state, setFail: (e: unknown) => { failPost = e; } };
}

const err = (code: number) => Object.assign(new Error(`discord ${code}`), { code });

test('posts one embed per slot, never twice; a restart (new manager, same store) stays quiet', async () => {
  const r = rig({ now: SLOT + 60_000 });
  assert.equal(await r.manager.tick(), 'posted');
  assert.equal(r.posts.length, 1);
  assert.equal(r.posts[0]?.channelId, '1530000000000000500');
  assert.deepEqual(r.state.usageCalls, ['2026-10-19..2026-10-25']);
  assert.equal(await r.manager.tick(), 'done');
  r.state.now = SLOT + 4 * 3_600_000;
  assert.equal(await r.manager.tick(), 'done');
  const again = rig({ now: SLOT + 5 * 3_600_000, store: r.store });
  assert.equal(await again.manager.tick(), 'done');
  assert.equal(again.posts.length, 0);
  assert.equal(r.store.record?.lastScheduledAt, SLOT);
  // next week is a new slot
  r.state.now = SLOT + 7 * 86_400_000 + 3_600_000;
  assert.equal(await r.manager.tick(), 'posted');
  assert.equal(r.posts.length, 2);
});

test('slot is 10:00 local also across DST: a week that starts on CEST posts at 08:00 UTC', async () => {
  const r = rig({ now: Date.UTC(2026, 2, 30, 7, 59) });
  assert.equal(await r.manager.tick(), 'stale', 'before 10:00 local the slot of the week before is long gone (first run: strict window)');
  assert.equal(r.posts.length, 0);
  r.state.now = Date.UTC(2026, 2, 30, 8, 1);
  assert.equal(await r.manager.tick(), 'posted');
  assert.deepEqual(r.state.usageCalls, ['2026-03-23..2026-03-29']);
});

test('no data: nothing is posted, the slot is remembered and not re-evaluated', async () => {
  const empty = rig({ now: SLOT + 1000, rows: [] });
  assert.equal(await empty.manager.tick(), 'empty');
  assert.equal(await empty.manager.tick(), 'done');
  assert.equal(empty.posts.length, 0);

  const few = rig({ now: SLOT + 1000, rows: [{ faqId: 1, source: 'command', count: 2 }] });
  assert.equal(await few.manager.tick(), 'empty');
  assert.equal(few.posts.length, 0);

  const gone = rig({ now: SLOT + 1000, rows: [{ faqId: 99, source: 'command', count: 50 }] });
  assert.equal(await gone.manager.tick(), 'empty');
  assert.equal(gone.posts.length, 0);
});

test('first run keeps the strict 15 minute window; after a handled slot an outage is caught up until Sunday 23:59', async () => {
  const first = rig({ now: SLOT + 3 * 3_600_000 });
  assert.equal(await first.manager.tick(), 'stale');
  assert.equal(first.posts.length, 0);

  const store = new MemStore();
  store.record = { lastScheduledAt: SLOT - 7 * 86_400_000, lastPostedAt: null, lastMessageId: null, pausedUntil: null };
  const later = rig({ now: SLOT + 3 * 86_400_000, store });
  assert.equal(await later.manager.tick(), 'posted');
  assert.ok(later.logs.some((l) => l.msg === 'FAQ top delivered late (catch-up within the week)'));
  const record = { lastScheduledAt: SLOT - 7 * 86_400_000, lastPostedAt: null, lastMessageId: null, pausedUntil: null };
  // Sunday 2026-11-01 22:00 local (21:00 UTC) is the last catch-up moment of the week, Monday 06:00 local is too late.
  const sundayNight = rig({ now: Date.UTC(2026, 10, 1, 21, 0), store: Object.assign(new MemStore(), { record: { ...record } }) });
  assert.equal(await sundayNight.manager.tick(), 'posted');
  const mondayMorning = rig({ now: Date.UTC(2026, 10, 2, 5, 0), store: Object.assign(new MemStore(), { record: { ...record } }) });
  assert.equal(await mondayMorning.manager.tick(), 'stale');
  assert.equal(mondayMorning.posts.length, 0);
});

test('no channel: quiet skip; entries unavailable: retried, warned once per slot', async () => {
  const none = rig({ now: SLOT + 1000, channel: undefined });
  assert.equal(await none.manager.tick(), 'no-channel');
  assert.equal(none.store.saves, 0);

  const down = rig({ now: SLOT + 1000, entries: async () => [] });
  assert.equal(await down.manager.tick(), 'unavailable');
  assert.equal(await down.manager.tick(), 'unavailable');
  assert.equal(down.logs.filter((l) => l.level === 'warn').length, 1);
  assert.equal(down.store.saves, 0, 'not recorded: the next tick retries');

  const throwing = rig({ now: SLOT + 1000, entries: async () => { throw new Error('offline'); } });
  assert.equal(await throwing.manager.tick(), 'unavailable');
});

test('permanent Discord errors pause for 30 minutes with one warn, then a new attempt; other errors retry next tick', async () => {
  for (const code of [10003, 50001, 50013]) {
    const r = rig({ now: SLOT + 1000, failPost: err(code) });
    assert.equal(await r.manager.tick(), 'paused', String(code));
    assert.equal(r.store.record?.lastScheduledAt ?? null, null, 'slot not consumed');
    r.state.now += 10 * 60_000;
    assert.equal(await r.manager.tick(), 'paused');
    assert.equal(r.logs.filter((l) => l.level === 'warn').length, 1, 'one warn');
    r.setFail(null);
    r.state.now += 21 * 60_000;
    assert.equal(await r.manager.tick(), 'stale', 'pause outlasted the 15 minute first-run window: skipped, never spams');
  }
  const store = new MemStore();
  store.record = { lastScheduledAt: SLOT - 7 * 86_400_000, lastPostedAt: null, lastMessageId: null, pausedUntil: null };
  const r = rig({ now: SLOT + 1000, store, failPost: err(50013) });
  assert.equal(await r.manager.tick(), 'paused');
  r.setFail(null);
  r.state.now += 31 * 60_000;
  assert.equal(await r.manager.tick(), 'posted', 'catch-up after the pause');

  const flaky = rig({ now: SLOT + 1000, failPost: new Error('socket hang up') });
  assert.equal(await flaky.manager.tick(), 'error');
  assert.equal(await flaky.manager.tick(), 'error');
  assert.equal(flaky.logs.filter((l) => l.level === 'warn').length, 1);
  flaky.setFail(null);
  assert.equal(await flaky.manager.tick(), 'posted');
});

test('a failed state write after a successful post still never posts the slot twice in this process', async () => {
  const store = new MemStore();
  const save = store.save.bind(store);
  let first = true;
  store.save = (rec: FaqTopRecord) => { if (first) { first = false; throw new Error('disk full'); } save(rec); };
  const r = rig({ now: SLOT + 1000, store });
  assert.equal(await r.manager.tick(), 'posted');
  assert.equal(await r.manager.tick(), 'done');
  assert.equal(r.posts.length, 1);
});

// ─── counter table, wiring, privacy ─────────────────────────────────────────

test('real SQLite: counters add up per day/entry/source, only the numbers are stored', () => {
  const day1 = new Date(Date.UTC(2026, 9, 20, 12, 0));
  const day2 = new Date(Date.UTC(2026, 9, 22, 12, 0));
  stats.recordFaqUse(7, 'command', day1);
  stats.recordFaqUse(7, 'command', day1);
  stats.recordFaqUse(7, 'autocomplete', day2);
  stats.recordFaqUse(8, 'autoanswer', day2);
  stats.recordFaqUse(-1, 'command', day2);
  const rows = stats.faqUsageBetween('2026-10-19', '2026-10-25').sort((a, b) => a.faqId - b.faqId || a.source.localeCompare(b.source));
  assert.deepEqual(rows, [
    { faqId: 7, source: 'autocomplete', count: 1 },
    { faqId: 7, source: 'command', count: 2 },
    { faqId: 8, source: 'autoanswer', count: 1 },
  ]);
  assert.deepEqual(stats.faqUsageBetween('2026-10-23', '2026-10-25'), []);
  const columns = (sqliteHandle.prepare('PRAGMA table_info(faq_usage_daily)').all() as Array<{ name: string }>).map((c) => c.name);
  assert.deepEqual(columns, ['day', 'faq_id', 'source', 'count'], 'no user, channel, message or text column');
  const state = (sqliteHandle.prepare('PRAGMA table_info(faq_top_state)').all() as Array<{ name: string }>).map((c) => c.name);
  assert.ok(!state.some((c) => /user/.test(c)));
});

test('wiring: defaults, channel order (override, then weeklyDigest), enable switch and store round trip', async () => {
  assert.equal(config.FAQ_TOP_ENABLED, true);
  assert.equal(config.FAQ_TOP_DAY, 1);
  assert.equal(config.FAQ_TOP_HOUR, 10);
  assert.equal(config.DISCORD_CHANNEL_FAQ_TOP, undefined);
  assert.equal(topWiring.faqTopChannelId(), undefined, 'no channel known: quiet skip');
  saveChannel('weeklyDigest', '1530000000000000700');
  assert.equal(topWiring.faqTopChannelId(), '1530000000000000700');
  const mutable = config as unknown as Record<string, unknown>;
  mutable.DISCORD_CHANNEL_FAQ_TOP = '1530000000000000800';
  try {
    assert.equal(topWiring.faqTopChannelId(), '1530000000000000800');
  } finally {
    mutable.DISCORD_CHANNEL_FAQ_TOP = undefined;
  }

  topWiring.faqTopStore.save({ lastScheduledAt: SLOT, lastPostedAt: SLOT + 5, lastMessageId: '1540000000000000001', pausedUntil: null });
  assert.deepEqual(topWiring.faqTopStore.load(), { lastScheduledAt: SLOT, lastPostedAt: SLOT + 5, lastMessageId: '1540000000000000001', pausedUntil: null });

  let ticks = 0;
  topWiring.setFaqTopForTests({ tick: async () => { ticks += 1; return 'posted'; } });
  const was = config.FAQ_TOP_ENABLED;
  try {
    mutable.FAQ_TOP_ENABLED = false;
    await topWiring.runFaqTopTick();
    assert.equal(ticks, 0);
    mutable.FAQ_TOP_ENABLED = true;
    await topWiring.runFaqTopTick();
    assert.equal(ticks, 1);
  } finally {
    mutable.FAQ_TOP_ENABLED = was;
    topWiring.setFaqTopForTests(null);
  }
});

test('privacy: manager logs carry no ids or question text', async () => {
  const r = rig({ now: SLOT + 1000, failPost: err(50013) });
  await r.manager.tick();
  const text = JSON.stringify(r.logs);
  assert.ok(!/\d{15,}/.test(text), 'no snowflake');
  assert.ok(!text.includes('MagguuUI'), 'no question text');
});
