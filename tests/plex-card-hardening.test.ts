import assert from 'node:assert/strict';
import { test } from 'node:test';
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
  buildPlexUserCardEmbed,
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
  load(c: string, u: string) { const r = this.rows.get(`${c}|${u}`); return r ? structuredClone(r) : null; }
  save(r: PlexCardRecord) { this.rows.set(`${r.channelId}|${r.userKey}`, structuredClone(r)); }
  list(c: string) { return [...this.rows.values()].filter((r) => r.channelId === c).map((r) => structuredClone(r)); }
}

class Gateway implements PlexCardGateway {
  posts = 0;
  edits = 0;
  editError: unknown = null;
  postError: unknown = null;
  deletes: Array<{ channelId: string; messageId: string }> = [];
  deleteError: unknown = null;
  private n = 1;
  async delete(channelId: string, messageId: string) {
    this.deletes.push({ channelId, messageId });
    if (this.deleteError) throw this.deleteError;
  }
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
    debounceMs: 4000, maxWaitMs: 15_000, retryMs: 30_000, postSpacingMs: 0, editSpacingMs: 0,
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
  for (let i = 0; i < 5; i++) assert.equal(await t.manager.flushCard(CH, 'anna'), 'retry');
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
    assert.equal(await t.manager.flushCard(CH, 'anna'), 'paused');

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
  assert.equal(t.store.load(CH, 'anna')?.messageId, null);
  assert.equal(t.logs.filter((l) => /blocked by Discord/.test(l.msg)).length, 1);
  await t.run(5 * 60_000, 30_000);
  assert.equal(t.gateway.posts, 0);
  t.gateway.postError = null;
  await t.run(6 * 60_000, 30_000);
  assert.equal(t.gateway.posts, 1);
  assert.equal(t.manager.getState(CH, 'anna').sessions.length, 1);
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
  assert.equal(t.store.load(CH, 'anna')?.messageId, '1', 'old id kept while cooling down');
  await t.run(70_000, 30_000);
  assert.equal(t.gateway.posts, 2, 'cooldown over: replaced once');
  assert.equal(t.store.load(CH, 'anna')?.messageId, '2');
});

// ─── 3b. failure repost removes the old tracked message (best effort) ───────

async function failedEditsUntilRepost(t: ReturnType<typeof rig>): Promise<void> {
  t.manager.handleEvent(CH, ev('play', T0));
  await t.run(5000, 30_000);
  assert.equal(t.gateway.posts, 1);
  await t.run(11 * 60_000);
  t.gateway.editError = new Error('503');
  t.manager.handleEvent(CH, ev('pause', t.now()));
  await t.run(10 * 60_000, 30_000);
}

test('failure repost: the old tracked message is deleted once, after the new card is saved; no bulk delete', async () => {
  const t = rig({ maxEditFailures: 3, repostCooldownMs: 60_000 });
  await failedEditsUntilRepost(t);
  assert.equal(t.gateway.posts, 2);
  assert.deepEqual(t.gateway.deletes, [{ channelId: CH, messageId: '1' }], 'exactly the old tracked id, one call');
  assert.equal(t.store.load(CH, 'anna')?.messageId, '2', 'the new id is what is tracked');
});

test('failure repost: a failing delete is ignored (card still reposted and tracked, only an info log)', async () => {
  const t = rig({ maxEditFailures: 3, repostCooldownMs: 60_000 });
  t.gateway.deleteError = err(50_013);
  await failedEditsUntilRepost(t);
  assert.equal(t.gateway.posts, 2);
  assert.equal(t.gateway.deletes.length, 1);
  assert.equal(t.store.load(CH, 'anna')?.messageId, '2');
  assert.ok(t.logs.some((l) => l.level === 'info' && /could not be deleted/.test(l.msg)));
  assert.ok(!t.logs.some((l) => l.level === 'warn' && /delete/i.test(l.msg)));
});

test('no delete when the message is simply gone (10008) or the new post fails', async () => {
  const gone = rig({ goneCooldownMs: 1000 });
  gone.manager.handleEvent(CH, ev('play', T0));
  await gone.run(5000);
  gone.gateway.editError = err(10_008);
  gone.manager.handleEvent(CH, ev('pause', gone.now()));
  await gone.run(60_000, 30_000);
  assert.equal(gone.gateway.posts, 2);
  assert.equal(gone.gateway.deletes.length, 0, 'nothing to delete: the message does not exist');

  const t = rig({ maxEditFailures: 2, repostCooldownMs: 60_000 });
  t.manager.handleEvent(CH, ev('play', T0));
  await t.run(5000, 30_000);
  await t.run(11 * 60_000);
  t.gateway.editError = new Error('503');
  t.gateway.postError = new Error('503 post');
  t.manager.handleEvent(CH, ev('pause', t.now()));
  await t.run(5 * 60_000, 30_000);
  assert.equal(t.gateway.deletes.length, 0, 'old card is kept while no replacement exists');
  assert.equal(t.store.load(CH, 'anna')?.messageId, '1');
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
  const text = buildPlexUserCardEmbed('**admin** <@123>', s).data.description ?? '';
  const title = buildPlexUserCardEmbed('**admin** <@123>', s).data.title ?? '';
  assert.ok(title.includes('\\*\\*admin\\*\\* \\<\\@123\\>'), title);
  assert.ok(text.includes('\\[click\\]\\(http://evil\\) \\<t:1:R\\> \\@everyone'), text);
  assert.ok(text.includes('\\`code\\`'));
  // the only live formatting left is the bot's own relative timestamp
  assert.equal((text.match(/<t:\d+:R>/g) ?? []).length, 1);
});

