import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { EmbedBuilder } from 'discord.js';

const dir = mkdtempSync(join(tmpdir(), 'plex-card-cleanup-'));
after(() => rmSync(dir, { recursive: true, force: true }));
Object.assign(process.env, {
  DATABASE_PATH: join(dir, 'bot.db'),
  DISCORD_TOKEN: 'test-token-not-used',
  DISCORD_CLIENT_ID: '1498095100000000001',
  DISCORD_GUILD_ID: '1400000000000000099',
  WEBHOOK_SECRET: 'test-secret-0123456789abcdef',
});

const cleanup = await import('../src/discord/plex-card-cleanup.ts');
const { classifyCleanupMessage, isFormerPlexActivityEmbed } = await import('../src/utils/plex-card-cleanup.ts');
const { buildPlexUserCardEmbed, emptyPlexCardState, PLEX_USER_CARD_FOOTER } = await import('../src/utils/plex-card.ts');
const { PLEX_WEEKLY_FOOTER } = await import('../src/utils/plex-weekly.ts');
const { DIGEST_FOOTER } = await import('../src/utils/plex-new-digest.ts');
const { NEU_FOOTER } = await import('../src/utils/plex-new.ts');
const { classifyBotEmbed } = await import('../src/utils/routing.ts');
const { sqliteHandle } = await import('../src/db/client.ts');
import type { CleanupStateRow, CleanupRawMessage, CleanupStateStore } from '../src/discord/plex-card-cleanup.ts';

const BOT = '900000000000000001';
const HUMAN = '800000000000000002';
const CH = '1530000000000000100';

type Raw = CleanupRawMessage & { deleted: boolean };

function fromEmbed(id: number, embed: EmbedBuilder | null, extra: Partial<Raw> & { authorId?: string } = {}): Raw {
  const json = embed?.toJSON();
  const msg: Raw = {
    id: String(1540000000000000000n + BigInt(id)),
    author: { id: extra.authorId ?? BOT },
    pinned: false,
    content: '',
    embeds: json ? [{ title: json.title ?? null, author: json.author ? { name: json.author.name } : null, footer: json.footer ? { text: json.footer.text } : null }] : [],
    deleted: false,
    async delete() { msg.deleted = true; },
    ...(extra.pinned !== undefined ? { pinned: extra.pinned } : {}),
    ...(extra.content !== undefined ? { content: extra.content } : {}),
    ...(extra.delete ? { delete: extra.delete } : {}),
  };
  return msg;
}

const legacyEmbed = (footer: string, author = 'Plex · Aktivität') => new EmbedBuilder().setTitle('🎬 x').setAuthor({ name: author }).setFooter({ text: footer });
const singleCard = () => legacyEmbed('MagguuBot · Plex-Aktivität (eine Karte, wird aktualisiert)');
const lifecycleCard = () => legacyEmbed('MagguuBot · Plex-Aktivität', 'Plex-Aktivität · Server');
const userCard = () => buildPlexUserCardEmbed('Anna', emptyPlexCardState());
const weekly = () => new EmbedBuilder().setTitle('📊').setFooter({ text: PLEX_WEEKLY_FOOTER });
const digest = () => new EmbedBuilder().setTitle('✨').setFooter({ text: DIGEST_FOOTER });
const neu = () => new EmbedBuilder().setTitle('🆕  Neu auf Plex').setFooter({ text: `${NEU_FOOTER}  ·  Seite 1/1  ·  3 Titel` });

class FakeChannel {
  fetches: Array<{ limit: number; before?: string }> = [];
  bulkDeleteCalls = 0;
  fetchError: unknown = null;
  constructor(readonly all: Raw[]) {}
  bulkDelete(): never { this.bulkDeleteCalls += 1; throw new Error('bulkDelete must never be used'); }
  readonly messages = {
    fetch: async (o: { limit: number; before?: string }) => {
      this.fetches.push(o);
      if (this.fetchError) throw this.fetchError;
      const sorted = [...this.all].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
      const from = o.before ? sorted.filter((m) => BigInt(m.id) < BigInt(o.before!)) : sorted;
      return new Map(from.slice(0, o.limit).map((m) => [m.id, m])) as unknown as { values(): IterableIterator<CleanupRawMessage> };
    },
  };
}

class MemState implements CleanupStateStore {
  row: CleanupStateRow | null = null;
  saves = 0;
  load() { return this.row ? { ...this.row } : null; }
  save(row: CleanupStateRow) { this.row = { ...row }; this.saves += 1; }
}

function deps(channel: FakeChannel, state: CleanupStateStore, extra: Partial<Parameters<typeof cleanup.runPlexCardCleanup>[0]> = {}) {
  const logs: Array<{ level: string; msg: string; data?: Record<string, unknown> }> = [];
  const sleeps: number[] = [];
  return {
    logs, sleeps,
    deps: {
      channel: channel as never, botId: BOT, protectedIds: new Set<string>(), state, scanLimit: 1000, dryRun: false,
      now: () => 5_000_000, sleep: async (ms: number) => { sleeps.push(ms); },
      log: (level: 'info' | 'warn', msg: string, data?: Record<string, unknown>) => logs.push({ level, msg, ...(data ? { data } : {}) }),
      ...extra,
    } satisfies Parameters<typeof cleanup.runPlexCardCleanup>[0],
  };
}

/** A realistic channel: old cards, the new user cards, weekly, digest, /neu, foreign and pinned messages. */
function realisticChannel() {
  const msgs = {
    single: fromEmbed(1, singleCard()),
    life1: fromEmbed(2, lifecycleCard()),
    life2: fromEmbed(3, legacyEmbed('MagguuBot · Plex-Aktivität', 'Plex-Aktivität · Server')),
    kind: fromEmbed(4, legacyEmbed('MagguuBot · stop', 'Plex · Tautulli')),
    oldFeed: fromEmbed(5, legacyEmbed('MagguuBot · Plex activity', 'Plex Activity · Server')),
    userA: fromEmbed(6, userCard()),
    userB: fromEmbed(7, userCard()),
    weekly: fromEmbed(8, weekly()),
    digest: fromEmbed(9, digest()),
    neu: fromEmbed(10, neu()),
    foreignOld: fromEmbed(11, singleCard(), { authorId: HUMAN }),
    pinnedOld: fromEmbed(12, singleCard(), { pinned: true }),
    textOnly: fromEmbed(13, null, { content: 'hallo' }),
    withContent: fromEmbed(14, singleCard(), { content: 'noch Text' }),
    trackedOld: fromEmbed(15, singleCard()),
    errorFooter: fromEmbed(16, legacyEmbed('MagguuBot · error', 'Irgendwas')),
  };
  return { msgs, channel: new FakeChannel(Object.values(msgs)), protectedIds: new Set([msgs.userA.id, msgs.userB.id, msgs.weekly.id, msgs.trackedOld.id]) };
}

const KEEP = ['userA', 'userB', 'weekly', 'digest', 'neu', 'foreignOld', 'pinnedOld', 'textOnly', 'withContent', 'trackedOld', 'errorFooter'] as const;
const GONE = ['single', 'life1', 'life2', 'kind', 'oldFeed'] as const;

// ─── classification ─────────────────────────────────────────────────────────

test('classification: footers of former Plex cards match, everything else (new cards, weekly, digest, /neu) does not', () => {
  assert.equal(isFormerPlexActivityEmbed({ footer: 'MagguuBot · Plex-Aktivität (eine Karte, wird aktualisiert)' }), true);
  assert.equal(isFormerPlexActivityEmbed({ footer: 'MagguuBot  ·  Plex-Aktivität', author: 'Plex-Aktivität · S' }), true, 'spacing variants');
  assert.equal(isFormerPlexActivityEmbed({ footer: 'MagguuBot · play', author: 'Plex · Tautulli' }), true);
  assert.equal(isFormerPlexActivityEmbed({ footer: 'MagguuBot · play', author: 'Irgendwer' }), false, 'kind footer needs the Plex author');
  assert.equal(isFormerPlexActivityEmbed({ footer: 'MagguuBot · Plex activity', author: 'Plex Activity · S' }), true);
  assert.equal(isFormerPlexActivityEmbed({ footer: 'MagguuBot · Plex activity', author: 'x' }), false);
  for (const footer of [PLEX_USER_CARD_FOOTER, PLEX_WEEKLY_FOOTER, DIGEST_FOOTER, `${NEU_FOOTER}  ·  Seite 1/2  ·  9 Titel`, 'MagguuBot · Plex-Aktivität (anders)', 'MagguuBot · Plex-Aktivitäten', '', 'MagguuUI · stabiles Update']) {
    assert.equal(isFormerPlexActivityEmbed({ footer, author: 'Plex · Nutzer' }), false, footer);
  }
  assert.equal(isFormerPlexActivityEmbed({ footer: null }), false);
  // the new card footer is not (and must not become) a routed legacy footer
  assert.equal(classifyBotEmbed({ footer: PLEX_USER_CARD_FOOTER, author: 'Plex · Nutzer' }), null);
});

test('classifyCleanupMessage: only bot + former Plex footer, with every exemption', () => {
  const { msgs, protectedIds } = realisticChannel();
  const verdict = (m: Raw) => classifyCleanupMessage({
    id: m.id, authorId: m.author.id, pinned: m.pinned, content: m.content,
    embeds: m.embeds.map((e) => ({ title: e.title ?? null, author: e.author?.name ?? null, footer: e.footer?.text ?? null })),
  }, { botId: BOT, protectedIds });
  for (const k of GONE) assert.equal(verdict(msgs[k]), 'candidate', k);
  assert.equal(verdict(msgs.userA), 'protected');
  assert.equal(verdict(msgs.weekly), 'protected');
  assert.equal(verdict(msgs.trackedOld), 'protected', 'tracked in SQLite wins over the footer');
  assert.equal(verdict(msgs.digest), 'not-plex-activity');
  assert.equal(verdict(msgs.neu), 'not-plex-activity');
  assert.equal(verdict(msgs.foreignOld), 'foreign-author');
  assert.equal(verdict(msgs.pinnedOld), 'pinned');
  assert.equal(verdict(msgs.textOnly), 'not-a-card');
  assert.equal(verdict(msgs.withContent), 'not-a-card');
  assert.equal(verdict(msgs.errorFooter), 'not-plex-activity');
  // even unprotected, a new user card / weekly / digest / neu never match by footer
  const unprotected = (m: Raw) => classifyCleanupMessage({
    id: m.id, authorId: m.author.id, pinned: false, content: '',
    embeds: m.embeds.map((e) => ({ title: e.title ?? null, author: e.author?.name ?? null, footer: e.footer?.text ?? null })),
  }, { botId: BOT, protectedIds: new Set() });
  for (const k of ['userA', 'weekly', 'digest', 'neu'] as const) assert.equal(unprotected(msgs[k]), 'not-plex-activity', k);
  // two embeds: not a plain card
  assert.equal(classifyCleanupMessage({ id: '1', authorId: BOT, pinned: false, content: '', embeds: [{ footer: 'MagguuBot · Plex-Aktivität' }, { footer: 'x' }] }, { botId: BOT, protectedIds: new Set() }), 'not-a-card');
});

// ─── core run ───────────────────────────────────────────────────────────────

test('real run: deletes exactly the former Plex cards, one by one with delay, never bulkDelete; result persisted and logged', async () => {
  const { msgs, channel, protectedIds } = realisticChannel();
  const state = new MemState();
  const t = deps(channel, state, { protectedIds });
  const out = await cleanup.runPlexCardCleanup(t.deps);
  assert.equal(out.status, 'done');
  assert.deepEqual([out.scanned, out.candidates, out.deleted, out.skipped, out.errors], [16, 5, 5, 0, 0]);
  for (const k of GONE) assert.equal(msgs[k].deleted, true, `${k} deleted`);
  for (const k of KEEP) assert.equal(msgs[k].deleted, false, `${k} kept`);
  assert.equal(channel.bulkDeleteCalls, 0);
  assert.equal(t.sleeps.filter((ms) => ms === cleanup.PLEX_CLEANUP_DELETE_DELAY_MS).length, 5, 'delay after every single delete');
  assert.equal(state.row?.status, 'done');
  assert.deepEqual([state.row?.deleted, state.row?.candidates, state.row?.scanLimit], [5, 5, 1000]);
  const before = t.logs.find((l) => l.msg === 'Plex card cleanup: candidates found');
  assert.equal(before?.data?.candidates, 5);
  assert.equal(before?.data?.scanLimit, 1000);
  assert.equal(before?.data?.dryRun, false);
  const after = t.logs.find((l) => l.msg === 'Plex card cleanup finished');
  assert.equal(after?.data?.deleted, 5);
  assert.equal(after?.data?.status, 'done');
  // numbers only: no id, no text
  assert.ok(!JSON.stringify(t.logs).match(/\d{15,}/), 'no snowflake in the logs');
});

test('dry run deletes nothing, persists nothing, only counts and logs; a later real run still happens', async () => {
  const { msgs, channel, protectedIds } = realisticChannel();
  const state = new MemState();
  const dry = deps(channel, state, { protectedIds, dryRun: true });
  const out = await cleanup.runPlexCardCleanup(dry.deps);
  assert.equal(out.status, 'dry-run');
  assert.equal(out.candidates, 5);
  assert.equal(out.deleted, 0);
  assert.ok(Object.values(msgs).every((m) => !m.deleted));
  assert.equal(state.saves, 0);
  assert.equal(dry.logs.find((l) => l.msg === 'Plex card cleanup finished')?.data?.wouldDelete, 5);
  assert.equal(dry.logs.find((l) => l.msg === 'Plex card cleanup: candidates found')?.data?.dryRun, true);

  const real = deps(channel, state, { protectedIds });
  assert.equal((await cleanup.runPlexCardCleanup(real.deps)).deleted, 5);
});

test('idempotent after a restart: a persisted done result means no scan and no delete at all', async () => {
  const { msgs, channel, protectedIds } = realisticChannel();
  const state = new MemState();
  await cleanup.runPlexCardCleanup(deps(channel, state, { protectedIds }).deps);
  const fetchesAfterFirst = channel.fetches.length;
  // "restart": new run, same persisted state; even a freshly appearing old-looking card is left alone
  const late = fromEmbed(99, singleCard());
  channel.all.push(late);
  const again = await cleanup.runPlexCardCleanup(deps(channel, state, { protectedIds }).deps);
  assert.equal(again.ran, false);
  assert.equal(again.status, 'skipped');
  assert.equal(channel.fetches.length, fetchesAfterFirst, 'no scan');
  assert.equal(late.deleted, false);
  void msgs;
});

test('scan depth is bounded and paginated; the log names it', async () => {
  const all = Array.from({ length: 250 }, (_, i) => fromEmbed(i + 1, i % 2 ? singleCard() : userCard()));
  const channel = new FakeChannel(all);
  const state = new MemState();
  const t = deps(channel, state, { scanLimit: 150 });
  const out = await cleanup.runPlexCardCleanup(t.deps);
  assert.equal(out.scanned, 150);
  assert.deepEqual(channel.fetches.map((f) => f.limit), [100, 50]);
  assert.equal(channel.fetches[0]?.before, undefined);
  assert.ok(channel.fetches[1]?.before);
  const found = t.logs.find((l) => l.msg === 'Plex card cleanup: candidates found');
  assert.equal(found?.data?.scanLimit, 150);
  assert.equal(found?.data?.scanLimitReached, true);
  // only the newest 150 were looked at: the oldest messages are untouched
  assert.ok(all.slice(0, 100).every((m) => !m.deleted));
  assert.equal(out.deleted, 75);
});

test('per-message errors: 10008 is skipped and counted, other errors counted, the run continues; leftovers are retried (not done)', async () => {
  const gone = fromEmbed(1, singleCard(), { delete: async () => { throw Object.assign(new Error('Unknown Message'), { code: 10_008 }); } });
  const flaky = fromEmbed(2, singleCard(), { delete: async () => { throw new Error('socket hang up'); } });
  const ok = fromEmbed(3, singleCard());
  const state = new MemState();
  const out = await cleanup.runPlexCardCleanup(deps(new FakeChannel([gone, flaky, ok]), state).deps);
  assert.equal(out.status, 'aborted', 'errors>0: not final, a bounded retry follows');
  assert.deepEqual([out.deleted, out.skipped, out.errors], [1, 1, 1]);
  assert.equal(ok.deleted, true);
  assert.equal(state.row?.status, 'aborted');
  assert.equal(state.row?.attempts, 1);
});

test('F3: leftover cards are retried after 6 h, only the leftovers are touched, max 3 attempts, then failed (final)', async () => {
  let failing = true;
  let deleteCalls = 0;
  const stubborn = fromEmbed(1, singleCard(), { delete: async () => { deleteCalls += 1; if (failing) throw new Error('socket hang up'); } });
  const fine = fromEmbed(2, singleCard());
  const channel = new FakeChannel([stubborn, fine]);
  const state = new MemState();
  let now = 7_000_000;
  const t = deps(channel, state, { now: () => now });
  const run = () => cleanup.runPlexCardCleanup(t.deps);

  assert.equal((await run()).status, 'aborted');
  assert.equal(fine.deleted, true);
  assert.equal(state.row?.deleted, 1);
  now += 60 * 60_000;
  assert.equal((await run()).status, 'skipped', 'too early for the retry');
  assert.equal(deleteCalls, 1);

  now += cleanup.PLEX_CLEANUP_RETRY_MS;
  assert.equal((await run()).status, 'aborted', 'attempt 2 still fails');
  assert.equal(deleteCalls, 2);
  assert.equal(state.row?.attempts, 2);
  failing = false;
  now += cleanup.PLEX_CLEANUP_RETRY_MS + 1;
  const third = await run();
  assert.equal(third.status, 'done', 'attempt 3 clears the leftover');
  assert.equal(deleteCalls, 3, "only the leftover was touched again");
  assert.equal(state.row?.status, 'done');
  assert.equal(state.row?.attempts, 3);

  // permanently failing: the third attempt ends as failed and nothing runs again
  const hard = fromEmbed(1, singleCard(), { delete: async () => { deleteCalls += 1; throw new Error('boom'); } });
  const s2 = new MemState();
  let n2 = 1_000;
  const d2 = deps(new FakeChannel([hard]), s2, { now: () => n2 });
  for (let i = 0; i < 3; i += 1) { await cleanup.runPlexCardCleanup(d2.deps); n2 += cleanup.PLEX_CLEANUP_RETRY_MS + 1; }
  assert.equal(s2.row?.status, 'failed');
  const before = deleteCalls;
  assert.equal((await cleanup.runPlexCardCleanup(d2.deps)).status, 'skipped');
  assert.equal(deleteCalls, before);
});

test('F3: PLEX_CARD_CLEANUP_ENABLED is re-checked before every delete; turning it off mid-run stops at once and persists nothing', async () => {
  const msgs = Array.from({ length: 5 }, (_, i) => fromEmbed(i + 1, singleCard()));
  let enabled = true;
  let checks = 0;
  const state = new MemState();
  const t = deps(new FakeChannel(msgs), state, {
    enabled: () => { checks += 1; return enabled; },
    sleep: async () => { if (msgs.filter((m) => m.deleted).length === 2) enabled = false; },
  });
  const out = await cleanup.runPlexCardCleanup(t.deps);
  assert.equal(out.status, 'aborted');
  assert.equal(out.deleted, 2, 'no delete after the switch went off');
  assert.deepEqual(msgs.map((m) => m.deleted), [false, false, false, true, true]);
  assert.equal(state.saves, 0, 'nothing persisted: the next enabled run starts clean');
  assert.equal(checks, 3);
  assert.ok(t.logs.some((l) => l.msg === 'Plex card cleanup stopped: disabled while running'));
});

test('50001 aborts at channel level immediately; 50013 skips per message but aborts after three in a row; warn logged', async () => {
  const mk = (code: number, n: number) => Array.from({ length: n }, (_, i) => fromEmbed(i + 1, singleCard(), { delete: async () => { throw Object.assign(new Error(`d${code}`), { code }); } }));
  const s1 = new MemState();
  const t1 = deps(new FakeChannel(mk(50_001, 4)), s1);
  const o1 = await cleanup.runPlexCardCleanup(t1.deps);
  assert.equal(o1.status, 'aborted');
  assert.equal(o1.errors, 1, 'stopped at the first message');
  assert.equal(s1.row?.status, 'aborted');
  const w = t1.logs.find((l) => l.level === 'warn');
  assert.equal(w?.msg, 'Plex card cleanup aborted');
  assert.equal(w?.data?.code, 50_001);

  const s2 = new MemState();
  const t2 = deps(new FakeChannel(mk(50_013, 6)), s2);
  const o2 = await cleanup.runPlexCardCleanup(t2.deps);
  assert.equal(o2.status, 'aborted');
  assert.equal(o2.errors, 3);
  assert.equal(t2.logs.filter((l) => l.level === 'warn').length, 1);

  // a single 50013 between successes does not abort
  const mixed = [fromEmbed(1, singleCard(), { delete: async () => { throw Object.assign(new Error('x'), { code: 50_013 }); } }), fromEmbed(2, singleCard()), fromEmbed(3, singleCard())];
  const o3 = await cleanup.runPlexCardCleanup(deps(new FakeChannel(mixed), new MemState()).deps);
  assert.equal(o3.status, 'aborted', 'one error: the leftover is retried later');
  assert.deepEqual([o3.deleted, o3.errors], [2, 1]);
});

test('scan failure aborts (warn, nothing deleted); an aborted run is retried only after 6 h and gives up after 3 attempts', async () => {
  const msg = fromEmbed(1, singleCard());
  const channel = new FakeChannel([msg]);
  channel.fetchError = Object.assign(new Error('Missing Access'), { code: 50_001 });
  const state = new MemState();
  let now = 5_000_000;
  const run = () => cleanup.runPlexCardCleanup(deps(channel, state, { now: () => now }).deps);

  assert.equal((await run()).status, 'aborted');
  assert.equal(msg.deleted, false);
  assert.equal(state.row?.attempts, 1);
  const calls = channel.fetches.length;
  now += 60 * 60_000;
  assert.equal((await run()).status, 'skipped', 'too early for a retry');
  assert.equal(channel.fetches.length, calls);

  now += cleanup.PLEX_CLEANUP_RETRY_MS;
  assert.equal((await run()).status, 'aborted');
  now += cleanup.PLEX_CLEANUP_RETRY_MS + 1;
  assert.equal((await run()).status, 'failed', 'third attempt: final');
  assert.equal(state.row?.attempts, 3);
  now += 10 * cleanup.PLEX_CLEANUP_RETRY_MS;
  assert.equal((await run()).status, 'skipped', 'failed is final');

  // the channel works again: a retry after an abort can still finish
  const ok = new FakeChannel([fromEmbed(1, singleCard())]);
  const s2 = new MemState();
  s2.row = { status: 'aborted', attempts: 1, scanned: 0, candidates: 0, deleted: 0, skipped: 0, errors: 0, scanLimit: 1000, finishedAt: 1 };
  assert.equal((await cleanup.runPlexCardCleanup(deps(ok, s2, { now: () => 1 + cleanup.PLEX_CLEANUP_RETRY_MS + 5 }).deps)).status, 'done');
});

test('a fake channel whose bulkDelete throws is never asked to bulk delete', async () => {
  const { channel, protectedIds } = realisticChannel();
  await cleanup.runPlexCardCleanup(deps(channel, new MemState(), { protectedIds, dryRun: true }).deps);
  await cleanup.runPlexCardCleanup(deps(channel, new MemState(), { protectedIds }).deps);
  assert.equal(channel.bulkDeleteCalls, 0);
});

// ─── gate: only after the per-user cards are live, never in the creating tick ──

test('gate: needs a posted, fully synced, unpaused state for a full minute and no recent post; never in the first observing tick', () => {
  const gate = { syncedSince: null as number | null, running: false, dryRunDone: false };
  const sync = (o: Partial<{ cards: number; posted: number; unsynced: number; paused: boolean; lastPostAt: number }> = {}) =>
    ({ cards: 2, posted: 2, unsynced: 0, paused: false, lastPostAt: 0, ...o });
  const T = 10_000_000;
  const g = (s: ReturnType<typeof sync>, at: number) => cleanup.evaluateCleanupGate(s, at, gate);

  assert.equal(g(sync({ posted: 0, cards: 0 }), T), 'wait', 'no card yet');
  assert.equal(g(sync({ unsynced: 1 }), T), 'wait', 'cards still being created');
  assert.equal(g(sync({ lastPostAt: T }), T + 30_000), 'wait', 'first tick that sees the synced state only starts the clock');
  assert.equal(g(sync({ lastPostAt: T }), T + 60_000), 'wait', 'a card was posted less than a minute ago');
  assert.equal(g(sync({ lastPostAt: T }), T + 30_000 + cleanup.PLEX_CLEANUP_STABLE_MS), 'start', 'one stable minute after the last post');
  assert.equal(g(sync({ paused: true }), T + 200_000), 'wait');
  assert.equal(g(sync(), T + 210_000), 'wait', 'pause reset the clock');
  assert.equal(g(sync({ unsynced: 1 }), T + 230_000), 'wait');
  assert.equal(g(sync(), T + 240_000), 'wait');
  assert.equal(g(sync(), T + 240_000 + cleanup.PLEX_CLEANUP_STABLE_MS), 'start');
});

/** A client spy: every touch is recorded; `live` makes it usable so a positive control can prove the spy works. */
function spyClient(channelId: string) {
  const touched: string[] = [];
  const fetched: string[] = [];
  const client = {
    get user() { touched.push('user'); return { id: BOT }; },
    channels: {
      fetch: async (id: string) => {
        touched.push('channels.fetch');
        fetched.push(id);
        return { isTextBased: () => true, messages: { fetch: async () => { touched.push('messages.fetch'); return new Map(); } }, expectedId: channelId };
      },
    },
  };
  return { client, touched, fetched, resolve: () => { touched.push('getClient'); return client; } };
}

const liveSync = { cards: 1, posted: 1, unsynced: 0, paused: false, lastPostAt: 0 };
const okOutcome = { ran: true, dryRun: false, status: 'done' as const, scanned: 0, candidates: 0, deleted: 0, skipped: 0, errors: 0 };

test('F1 tick emergency brake: with PLEX_CARD_CLEANUP_ENABLED=false neither the client, nor the channel, nor fetch/delete is touched (spy; fails without the check)', async () => {
  const { config } = await import('../src/config.ts');
  const spy = spyClient('cb');
  let runs = 0;
  const run = async () => { runs += 1; return okOutcome; };
  cleanup.resetCleanupGate();
  const was = config.PLEX_CARD_CLEANUP_ENABLED;
  const wasDry = config.PLEX_CARD_CLEANUP_DRY_RUN;
  try {
    config.PLEX_CARD_CLEANUP_DRY_RUN = false;
    config.PLEX_CARD_CLEANUP_ENABLED = false;
    for (let i = 0; i < 4; i += 1) await cleanup.runPlexCardCleanupTick('cb', liveSync, 1_000_000 + i * 10 * 60_000, run, spy.resolve as never);
    assert.deepEqual(spy.touched, [], 'a disabled cleanup must not reach getClient / channels.fetch / messages.fetch / delete');
    assert.equal(runs, 0, 'emergency brake');

    // positive control: the very same calls with the switch on DO reach the client (so the spy and the gate work)
    config.PLEX_CARD_CLEANUP_ENABLED = true;
    cleanup.resetCleanupGate();
    await cleanup.runPlexCardCleanupTick('cb', liveSync, 5_000_000, run, spy.resolve as never);
    await cleanup.runPlexCardCleanupTick('cb', liveSync, 5_000_000 + 10 * 60_000, run, spy.resolve as never);
    assert.equal(runs, 1, 'enabled: the run starts on the second live tick');
    assert.ok(spy.touched.includes('getClient') && spy.touched.includes('channels.fetch'));
  } finally {
    config.PLEX_CARD_CLEANUP_ENABLED = was;
    config.PLEX_CARD_CLEANUP_DRY_RUN = wasDry;
    cleanup.resetCleanupGate();
    sqliteHandle.prepare("DELETE FROM plex_cleanup_state WHERE channel_id IN ('cb')").run();
  }
});

test('F8 production wiring: the tick hands the run a LIVE enabled check (reads the config on every call); flipping it off is seen by the run (fails if the wiring is removed or frozen)', async () => {
  const { config } = await import('../src/config.ts');
  const spy = spyClient('cw');
  const seen: Array<(() => boolean) | undefined> = [];
  let afterFlip: boolean | null = null;
  const run = async (d: { enabled?: () => boolean }) => {
    seen.push(d.enabled);
    const before = d.enabled?.();
    config.PLEX_CARD_CLEANUP_ENABLED = false; // the switch is turned off while the run is in progress
    afterFlip = d.enabled?.() ?? null;
    config.PLEX_CARD_CLEANUP_ENABLED = true;
    assert.equal(before, true);
    return okOutcome;
  };
  cleanup.resetCleanupGate();
  const was = config.PLEX_CARD_CLEANUP_ENABLED;
  const wasDry = config.PLEX_CARD_CLEANUP_DRY_RUN;
  try {
    config.PLEX_CARD_CLEANUP_DRY_RUN = false;
    config.PLEX_CARD_CLEANUP_ENABLED = true;
    await cleanup.runPlexCardCleanupTick('cw', liveSync, 1_000_000, run as never, spy.resolve as never);
    await cleanup.runPlexCardCleanupTick('cw', liveSync, 1_000_000 + 10 * 60_000, run as never, spy.resolve as never);
    assert.equal(seen.length, 1, 'the run started');
    assert.equal(typeof seen[0], 'function', 'the tick passes an enabled check to the run');
    assert.equal(afterFlip, false, 'the check reads the live config, not a value frozen at the start');
  } finally {
    config.PLEX_CARD_CLEANUP_ENABLED = was;
    config.PLEX_CARD_CLEANUP_DRY_RUN = wasDry;
    cleanup.resetCleanupGate();
    sqliteHandle.prepare("DELETE FROM plex_cleanup_state WHERE channel_id IN ('cw')").run();
  }
});

test('tick wiring: final state and not-live state never start a run; 0 cards never reaches the client', async () => {
  const { config } = await import('../src/config.ts');
  let runs = 0;
  const run = async () => { runs += 1; return okOutcome; };
  cleanup.resetCleanupGate();
  const was = config.PLEX_CARD_CLEANUP_ENABLED;
  const wasDry = config.PLEX_CARD_CLEANUP_DRY_RUN;
  try {
    config.PLEX_CARD_CLEANUP_DRY_RUN = false;
    config.PLEX_CARD_CLEANUP_ENABLED = true;
    const spy = spyClient('c2');
    cleanup.plexCleanupStateStore('c2').save({ status: 'done', attempts: 1, scanned: 5, candidates: 2, deleted: 2, skipped: 0, errors: 0, scanLimit: 1000, finishedAt: 1 });
    await cleanup.runPlexCardCleanupTick('c2', liveSync, 1_000_000, run, spy.resolve as never);
    await cleanup.runPlexCardCleanupTick('c2', liveSync, 1_000_000 + 10 * 60_000, run, spy.resolve as never);
    // ... even 30 days later: a persisted 'done' is final (once-flag beyond the 6 h retry window)
    await cleanup.runPlexCardCleanupTick('c2', liveSync, 1_000_000 + 30 * 24 * 60 * 60_000, run, spy.resolve as never);
    await cleanup.runPlexCardCleanupTick('c2', liveSync, 1_000_000 + 30 * 24 * 60 * 60_000 + 120_000, run, spy.resolve as never);
    assert.equal(runs, 0, 'persisted done: never again');
    assert.deepEqual(spy.touched, []);
    assert.equal(cleanup.plexCleanupStateStore('c2').load()?.deleted, 2);

    const notLive = spyClient('c3');
    await cleanup.runPlexCardCleanupTick('c3', { ...liveSync, unsynced: 1 }, 1_000_000, run, notLive.resolve as never);
    await cleanup.runPlexCardCleanupTick('c3', { ...liveSync, unsynced: 1 }, 1_000_000 + 10 * 60_000, run, notLive.resolve as never);
    assert.equal(runs, 0, 'cards not live yet');

    // 0 cards: nothing to be synced against, so the cleanup (which would delete the old cards) must wait
    const none = spyClient('c4');
    const zero = { cards: 0, posted: 0, unsynced: 0, paused: false, lastPostAt: 0 };
    await cleanup.runPlexCardCleanupTick('c4', zero, 1_000_000, run, none.resolve as never);
    await cleanup.runPlexCardCleanupTick('c4', zero, 1_000_000 + 10 * 60_000, run, none.resolve as never);
    assert.equal(runs, 0);
    assert.deepEqual(none.touched, []);
  } finally {
    config.PLEX_CARD_CLEANUP_ENABLED = was;
    config.PLEX_CARD_CLEANUP_DRY_RUN = wasDry;
    cleanup.resetCleanupGate();
    sqliteHandle.prepare("DELETE FROM plex_cleanup_state WHERE channel_id IN ('c2','c3','c4')").run();
  }
});

test('F4 tick: the channel id passed to the tick is the one fetched and handed to the run; an aborted state older than 6 h starts again', async () => {
  const { config } = await import('../src/config.ts');
  const spy = spyClient('1530000000000000777');
  let seenChannel: unknown = null;
  const run = async (d: { channel: unknown }) => { seenChannel = d.channel; return okOutcome; };
  cleanup.resetCleanupGate();
  const was = config.PLEX_CARD_CLEANUP_ENABLED;
  const wasDry = config.PLEX_CARD_CLEANUP_DRY_RUN;
  try {
    config.PLEX_CARD_CLEANUP_DRY_RUN = false;
    config.PLEX_CARD_CLEANUP_ENABLED = true;
    const store = cleanup.plexCleanupStateStore('1530000000000000777');
    const T = 100 * 60 * 60_000;
    store.save({ status: 'aborted', attempts: 1, scanned: 0, candidates: 1, deleted: 0, skipped: 0, errors: 1, scanLimit: 1000, finishedAt: T });
    // inside 6 h: still blocked
    await cleanup.runPlexCardCleanupTick('1530000000000000777', liveSync, T + 60 * 60_000, run as never, spy.resolve as never);
    await cleanup.runPlexCardCleanupTick('1530000000000000777', liveSync, T + 2 * 60 * 60_000, run as never, spy.resolve as never);
    assert.equal(seenChannel, null);
    assert.deepEqual(spy.touched, []);
    // beyond 6 h: runs, with exactly this channel
    cleanup.resetCleanupGate();
    const late = T + cleanup.PLEX_CLEANUP_RETRY_MS + 1;
    await cleanup.runPlexCardCleanupTick('1530000000000000777', liveSync, late, run as never, spy.resolve as never);
    await cleanup.runPlexCardCleanupTick('1530000000000000777', liveSync, late + 120_000, run as never, spy.resolve as never);
    assert.deepEqual(spy.fetched, ['1530000000000000777']);
    assert.ok(seenChannel, 'run got the fetched channel');
    // a dry run only happens once per process (dryRunDone), also long after
    cleanup.resetCleanupGate();
    config.PLEX_CARD_CLEANUP_DRY_RUN = true;
    const dry = spyClient('dry');
    let dryRuns = 0;
    const dryRun = async () => { dryRuns += 1; return { ...okOutcome, dryRun: true, status: 'dry-run' as const }; };
    for (let i = 0; i < 6; i += 1) await cleanup.runPlexCardCleanupTick('dry', liveSync, 9_000_000 + i * 7 * 60 * 60_000, dryRun, dry.resolve as never);
    assert.equal(dryRuns, 1, 'dry-run flag: once per process, also beyond 6 h');
  } finally {
    config.PLEX_CARD_CLEANUP_ENABLED = was;
    config.PLEX_CARD_CLEANUP_DRY_RUN = wasDry;
    cleanup.resetCleanupGate();
    sqliteHandle.prepare("DELETE FROM plex_cleanup_state WHERE channel_id IN ('1530000000000000777','dry')").run();
  }
});

test('F4 gate: a card reposted while everything reads as synced (no unsynced) still delays the cleanup by a full minute', () => {
  const gate = { syncedSince: null as number | null, running: false, dryRunDone: false };
  const T = 50_000_000;
  const sync = (lastPostAt: number) => ({ cards: 2, posted: 2, unsynced: 0, paused: false, lastPostAt });
  assert.equal(cleanup.evaluateCleanupGate(sync(0), T, gate), 'wait');
  assert.equal(cleanup.evaluateCleanupGate(sync(0), T + 5 * 60_000, gate), 'start', 'long synced, no recent post');
  // repost 10 s ago without any unsynced tick in between: must wait
  assert.equal(cleanup.evaluateCleanupGate(sync(T + 5 * 60_000 + 20_000), T + 5 * 60_000 + 30_000, gate), 'wait');
  assert.equal(cleanup.evaluateCleanupGate(sync(T + 5 * 60_000 + 20_000), T + 5 * 60_000 + 20_000 + cleanup.PLEX_CLEANUP_STABLE_MS, gate), 'start');
});

test('F4 once-flag: done and failed stay final for any age, aborted only blocks for 6 h', () => {
  const row = (status: 'done' | 'failed' | 'aborted'): CleanupStateRow => ({ status, attempts: 1, scanned: 0, candidates: 0, deleted: 0, skipped: 0, errors: 0, scanLimit: 1, finishedAt: 1_000 });
  const far = 1_000 + 365 * 24 * 60 * 60_000;
  assert.equal(cleanup.cleanupIsFinal(row('done'), far), true);
  assert.equal(cleanup.cleanupIsFinal(row('failed'), far), true);
  assert.equal(cleanup.cleanupIsFinal(row('aborted'), 1_000 + cleanup.PLEX_CLEANUP_RETRY_MS - 1), true);
  assert.equal(cleanup.cleanupIsFinal(row('aborted'), 1_000 + cleanup.PLEX_CLEANUP_RETRY_MS), false);
  assert.equal(cleanup.cleanupIsFinal(null, far), false);
});

test('real SQLite: the cleanup state round-trips and upserts', () => {
  const store = cleanup.plexCleanupStateStore('state-ch');
  assert.equal(store.load(), null);
  store.save({ status: 'aborted', attempts: 1, scanned: 10, candidates: 3, deleted: 1, skipped: 1, errors: 1, scanLimit: 1000, finishedAt: 1_700_000_000_000 });
  store.save({ status: 'done', attempts: 2, scanned: 20, candidates: 3, deleted: 3, skipped: 0, errors: 0, scanLimit: 1000, finishedAt: 1_700_000_100_000 });
  assert.deepEqual(store.load(), { status: 'done', attempts: 2, scanned: 20, candidates: 3, deleted: 3, skipped: 0, errors: 0, scanLimit: 1000, finishedAt: 1_700_000_100_000 });
  assert.equal((sqliteHandle.prepare("SELECT COUNT(*) c FROM plex_cleanup_state WHERE channel_id = 'state-ch'").get() as { c: number }).c, 1);
});
