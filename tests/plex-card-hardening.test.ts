import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { EmbedBuilder } from 'discord.js';
import {
  PlexCardManager,
  isPermanentDiscordError,
  type PlexCardGateway,
  type PlexCardRecord,
  type PlexCardStore,
} from '../src/discord/plex-card-manager.ts';
import {
  applyPlexCardEvent,
  buildPlexCardEmbed,
  clipPlexText,
  emptyPlexCardState,
  escapePlexMarkdown,
  PLEX_CARD_MAX_PLAYER,
  PLEX_CARD_MAX_TITLE,
  PLEX_CARD_MAX_USER,
  type PlexCardEvent,
} from '../src/utils/plex-card.ts';

const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);
const CH = '111';

function ev(kind: string, at: number, extra: Partial<PlexCardEvent> = {}): PlexCardEvent {
  return { kind, key: 'u|p', user: 'anna', player: 'tv', title: 'Dune', mediaType: 'movie', at, ...extra };
}

class MemStore implements PlexCardStore {
  rows = new Map<string, PlexCardRecord>();
  load(c: string) { const r = this.rows.get(c); return r ? structuredClone(r) : null; }
  save(r: PlexCardRecord) { this.rows.set(r.channelId, structuredClone(r)); }
}

class Gateway implements PlexCardGateway {
  posts = 0;
  edits = 0;
  editError: unknown = null;
  postError: unknown = null;
  private n = 1;
  async post(_c: string, _e: EmbedBuilder) { if (this.postError) throw this.postError; this.posts += 1; return String(this.n++); }
  async edit(_c: string, _m: string, _e: EmbedBuilder) { if (this.editError) throw this.editError; this.edits += 1; }
}

const err = (code: number) => Object.assign(new Error(`discord ${code}`), { code });

/** Manual clock + timers: fake, no real waiting. */
function rig(options: Partial<ConstructorParameters<typeof PlexCardManager>[0]> = {}) {
  let now = T0;
  let seq = 0;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  const timers = {
    setTimeout: (fn: () => void, ms: number) => { jobs.set(++seq, { at: now + ms, fn }); return seq; },
    clearTimeout: (h: unknown) => void jobs.delete(h as number),
  };
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  const store = new MemStore();
  const gateway = new Gateway();
  const logs: Array<{ level: string; msg: string; data?: Record<string, unknown> }> = [];
  const manager = new PlexCardManager({
    store, gateway, timers, now: () => now,
    debounceMs: 4000, maxWaitMs: 15_000, retryMs: 30_000,
    log: (level, msg, data) => logs.push({ level, msg, ...(data ? { data } : {}) }),
    ...options,
  });
  /** Advances time in 1 s steps, firing due timers, and calls the 30 s tick like the scheduler does. */
  async function run(ms: number, tickEveryMs = 0): Promise<void> {
    const end = now + ms;
    let nextTick = tickEveryMs > 0 ? now + tickEveryMs : Number.POSITIVE_INFINITY;
    while (now < end) {
      now += 1000;
      for (const [id, j] of [...jobs.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (j.at <= now) { jobs.delete(id); j.fn(); await settle(); }
      }
      if (now >= nextTick) { nextTick += tickEveryMs; await manager.tick(CH); await settle(); }
    }
  }
  return { manager, store, gateway, logs, run, now: () => now };
}

// ─── 1. failure counting and backoff ────────────────────────────────────────

test('retry timer and 30 s tick together count one failure per real attempt (exponential backoff)', async () => {
  const t = rig({ maxEditFailures: 5, repostCooldownMs: 600_000 });
  t.manager.handleEvent(CH, ev('play', T0));
  await t.run(5000, 30_000);
  assert.equal(t.gateway.posts, 1);
  await t.run(11 * 60_000);
  t.gateway.editError = new Error('503');
  t.manager.handleEvent(CH, ev('pause', t.now()));
  const start = t.now();
  const attempts: number[] = [];
  const origEdit = t.gateway.edit.bind(t.gateway);
  t.gateway.edit = async (c, m, e) => { attempts.push(Math.round((t.now() - start) / 1000)); return origEdit(c, m, e); };
  await t.run(400_000, 30_000);
  // 4 s debounce, then backoff 30 s, 60 s, 120 s: ~4, 34, 94, 214 s; 5th would be at ~454 s
  assert.equal(attempts.length, 4, `attempts at ${attempts.join(',')}`);
  assert.ok(attempts[1]! - attempts[0]! >= 30 && attempts[2]! - attempts[1]! >= 60 && attempts[3]! - attempts[2]! >= 120);
  assert.equal(t.gateway.posts, 1, 'no repost after 3 minutes any more');
  const failedLogs = t.logs.filter((l) => l.msg === 'Plex card edit failed');
  assert.deepEqual(failedLogs.map((l) => l.data?.attempt), [1, 2, 3, 4]);
  await t.run(120_000, 30_000); // 5th real failure -> repost
  assert.equal(t.gateway.posts, 2);
});

test('flushes inside a backoff window do not call Discord and return retry', async () => {
  const t = rig();
  t.manager.handleEvent(CH, ev('play', T0));
  await t.run(5000);
  t.gateway.editError = new Error('boom');
  t.manager.handleEvent(CH, ev('pause', t.now()));
  await t.run(5000);
  assert.equal(t.logs.filter((l) => l.msg === 'Plex card edit failed').length, 1);
  for (let i = 0; i < 5; i++) assert.equal(await t.manager.flush(CH), 'retry');
  assert.equal(t.logs.filter((l) => l.msg === 'Plex card edit failed').length, 1);
});

// ─── 2. permanent errors ────────────────────────────────────────────────────

test('permanent Discord errors are classified', () => {
  for (const code of [10_003, 50_001, 50_013]) assert.equal(isPermanentDiscordError(err(code)), true, String(code));
  for (const code of [10_008, 50_005, 500]) assert.equal(isPermanentDiscordError(err(code)), false, String(code));
  assert.equal(isPermanentDiscordError(new Error('x')), false);
});

for (const code of [10_003, 50_001, 50_013]) {
  test(`edit error ${code}: card pauses (no retry every 30 s, no repost), one attempt after the pause`, async () => {
    const t = rig({ permanentPauseMs: 30 * 60_000 });
    t.manager.handleEvent(CH, ev('play', T0));
    await t.run(5000);
    await t.run(11 * 60_000);
    t.gateway.editError = err(code);
    let edits = 0;
    const origEdit = t.gateway.edit.bind(t.gateway);
    t.gateway.edit = async (c, m, e) => { edits += 1; return origEdit(c, m, e); };
    t.manager.handleEvent(CH, ev('pause', t.now()));
    await t.run(25 * 60_000, 30_000); // 50 ticks inside the pause
    assert.equal(edits, 1, 'one attempt, then silence');
    assert.equal(t.gateway.posts, 1);
    const blocked = t.logs.filter((l) => /blocked by Discord/.test(l.msg));
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0]?.level, 'warn');
    assert.equal(blocked[0]?.data?.code, code);
    assert.equal(await t.manager.flush(CH), 'paused');

    await t.run(10 * 60_000, 30_000); // pause over: exactly one more attempt, pause again
    assert.equal(edits, 2);
    assert.equal(t.gateway.posts, 1, 'a permanent error never reposts');
    // fixed on the Discord side → next attempt after the pause recovers
    t.gateway.editError = null;
    await t.run(31 * 60_000, 30_000);
    assert.equal(t.gateway.edits, 1);
    assert.equal(t.gateway.posts, 1);
  });
}

test('post error 50013 pauses too and keeps the state for later', async () => {
  const t = rig({ permanentPauseMs: 10 * 60_000 });
  t.gateway.postError = err(50_013);
  t.manager.handleEvent(CH, ev('play', T0));
  await t.run(5000, 30_000);
  assert.equal(t.store.load(CH)?.messageId, null);
  assert.equal(t.logs.filter((l) => /blocked by Discord/.test(l.msg)).length, 1);
  await t.run(5 * 60_000, 30_000);
  assert.equal(t.gateway.posts, 0);
  t.gateway.postError = null;
  await t.run(6 * 60_000, 30_000);
  assert.equal(t.gateway.posts, 1);
  assert.equal(t.manager.getState(CH).sessions.length, 1);
});

// ─── 3. goneCooldownMs (10008) ──────────────────────────────────────────────

test('goneCooldownMs: a deleted message is replaced at most once per cooldown', async () => {
  const t = rig({ goneCooldownMs: 60_000 });
  t.manager.handleEvent(CH, ev('play', T0));
  await t.run(5000);
  assert.equal(t.gateway.posts, 1);
  t.gateway.editError = err(10_008);
  t.manager.handleEvent(CH, ev('pause', t.now())); // < 60 s after the post
  await t.run(5000);
  assert.equal(t.gateway.posts, 1, 'inside the cooldown: no repost');
  assert.equal(t.store.load(CH)?.messageId, '1', 'old id kept while cooling down');
  await t.run(70_000, 30_000);
  assert.equal(t.gateway.posts, 2, 'cooldown over: replaced once');
  assert.equal(t.store.load(CH)?.messageId, '2');
});

// ─── 4. untrusted text ──────────────────────────────────────────────────────

test('folding clips user/player/title (40/40/150) and strips control characters', () => {
  const long = 'x'.repeat(500);
  const s = applyPlexCardEvent(emptyPlexCardState(), ev('play', T0, { user: long, player: long, title: `${long}\n\u0000evil` }));
  const session = s.sessions[0]!;
  assert.equal(Array.from(session.user).length, PLEX_CARD_MAX_USER);
  assert.equal(Array.from(session.player).length, PLEX_CARD_MAX_PLAYER);
  assert.equal(Array.from(session.title).length, PLEX_CARD_MAX_TITLE);
  assert.ok(session.title.endsWith('…'));
  assert.equal(clipPlexText('a\r\nb\tc\u200bd', 50), 'a b c d');
  assert.equal(clipPlexText(undefined, 5), '');
  const stop = applyPlexCardEvent(s, ev('stop', T0 + 1));
  assert.equal(Array.from(stop.recent[0]!.title).length, PLEX_CARD_MAX_TITLE);
  // anonymous history line is clipped as well
  const anon = applyPlexCardEvent(emptyPlexCardState(), { kind: 'stop', key: null, title: long, user: long, at: T0 });
  assert.equal(Array.from(anon.recent[0]!.title).length, PLEX_CARD_MAX_TITLE);
  assert.equal(Array.from(anon.recent[0]!.user).length, PLEX_CARD_MAX_USER);
});

test('markdown, mentions and timestamps in webhook text render literally', () => {
  assert.equal(escapePlexMarkdown('a*b_c~d`e|f'), 'a\\*b\\_c\\~d\\`e\\|f');
  const s = applyPlexCardEvent(emptyPlexCardState(), ev('play', T0, {
    user: '**admin** <@123>', title: '[click](http://evil) <t:1:R> @everyone # > _x_', player: '`code`',
  }));
  const text = buildPlexCardEmbed(s).data.description ?? '';
  assert.ok(text.includes('\\*\\*admin\\*\\* \\<\\@123\\>'), text);
  assert.ok(text.includes('\\[click\\]\\(http://evil\\) \\<t:1:R\\> \\@everyone'), text);
  assert.ok(text.includes('\\`code\\`'));
  // the only live formatting left is the bot's own bold user + relative timestamp
  assert.equal((text.match(/<t:\d+:R>/g) ?? []).length, 1);
});

// ─── 5. real SQLite store and migration (temp DB) ───────────────────────────

const dir = mkdtempSync(join(tmpdir(), 'plex-card-db-'));
const dbPath = join(dir, 'bot.db');
after(() => rmSync(dir, { recursive: true, force: true }));
Object.assign(process.env, {
  DATABASE_PATH: dbPath,
  DISCORD_TOKEN: 'test-token',
  DISCORD_CLIENT_ID: '1',
  DISCORD_GUILD_ID: '2',
  WEBHOOK_SECRET: 'test-webhook-secret-0123456789abcdef',
});

test('real SQLite: tables are created, card and weekly stores round-trip, corrupt state degrades', async () => {
  const { sqliteHandle } = await import('../src/db/client.ts');
  const { plexCardStore } = await import('../src/discord/plex-card.ts');
  const { plexWeeklyStore } = await import('../src/discord/plex-weekly.ts');

  const cols = (table: string) => (sqliteHandle.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
  assert.deepEqual(cols('plex_activity_card'), ['guild_id', 'channel_id', 'message_id', 'content_hash', 'state_json', 'posted_at', 'updated_at']);
  assert.deepEqual(cols('plex_weekly_card'), ['guild_id', 'channel_id', 'message_id', 'content_hash', 'posted_at', 'updated_at']);

  assert.equal(plexCardStore.load(CH), null);
  const state = applyPlexCardEvent(emptyPlexCardState(), ev('play', T0));
  plexCardStore.save({ channelId: CH, messageId: '900', contentHash: 'h1', state, postedAt: T0 });
  assert.deepEqual(plexCardStore.load(CH), { channelId: CH, messageId: '900', contentHash: 'h1', state, postedAt: T0 });
  plexCardStore.save({ channelId: CH, messageId: '900', contentHash: 'h2', state: emptyPlexCardState(), postedAt: null });
  const upd = plexCardStore.load(CH);
  assert.equal(upd?.contentHash, 'h2');
  assert.equal(upd?.postedAt, null);
  assert.equal((sqliteHandle.prepare('SELECT COUNT(*) c FROM plex_activity_card').get() as { c: number }).c, 1, 'upsert, not insert');

  sqliteHandle.prepare("UPDATE plex_activity_card SET state_json = '{not json' WHERE channel_id = ?").run(CH);
  assert.deepEqual(plexCardStore.load(CH)?.state, emptyPlexCardState());
  sqliteHandle.prepare("UPDATE plex_activity_card SET state_json = '{\"sessions\":\"x\"}' WHERE channel_id = ?").run(CH);
  assert.deepEqual(plexCardStore.load(CH)?.state, emptyPlexCardState());

  assert.equal(plexWeeklyStore.load(CH), null);
  plexWeeklyStore.save({ channelId: CH, messageId: '901', contentHash: 'w1', postedAt: T0 });
  plexWeeklyStore.save({ channelId: CH, messageId: '901', contentHash: 'w2', postedAt: T0 });
  assert.deepEqual(plexWeeklyStore.load(CH), { channelId: CH, messageId: '901', contentHash: 'w2', postedAt: T0 });
  assert.equal(plexWeeklyStore.load('other'), null);
});

test('real SQLite: manager on the real store survives a restart and a second boot keeps the rows', async () => {
  const { plexCardStore } = await import('../src/discord/plex-card.ts');
  const gateway = new Gateway();
  const make = () => new PlexCardManager({ store: plexCardStore, gateway, debounceMs: 4000, log: () => {} });
  const first = make();
  first.handleEvent('777', ev('play', T0));
  assert.equal(await first.flush('777'), 'posted');
  const id = plexCardStore.load('777')?.messageId;
  assert.ok(id);
  const restarted = make();
  restarted.handleEvent('777', ev('stop', T0 + 1000));
  assert.equal(await restarted.flush('777'), 'edited');
  assert.equal(gateway.posts, 1);
  assert.equal(plexCardStore.load('777')?.messageId, id);

  // second boot against the same file: schema creation is idempotent and keeps the rows
  const out = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    `const { sqliteHandle } = await import(${JSON.stringify(new URL('../src/db/client.ts', import.meta.url).href)});
     const c = sqliteHandle.prepare("SELECT message_id m FROM plex_activity_card WHERE channel_id = '777'").get();
     console.log(JSON.stringify(c)); process.exit(0);`], { env: process.env, encoding: 'utf8' });
  assert.equal(JSON.parse(out.trim().split('\n').at(-1)!).m, id);
});
