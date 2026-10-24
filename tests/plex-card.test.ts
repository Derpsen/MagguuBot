import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EmbedBuilder } from 'discord.js';
import {
  PlexCardManager,
  isMessageGone,
  type PlexCardGateway,
  type PlexCardRecord,
  type PlexCardStore,
} from '../src/discord/plex-card-manager.ts';
import {
  plexActivityMatchesLiveSession,
  plexPlayerCorrelationKey,
} from '../src/utils/plex-activity.ts';
import {
  applyPlexCardEvent,
  buildPlexUserCardEmbed,
  closePlexCardSessions,
  emptyPlexCardState,
  plexCardHash,
  PLEX_CARD_SESSION_TTL_MS,
  type PlexCardEvent,
  type PlexCardState,
} from '../src/utils/plex-card.ts';

const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);
const CHANNEL = '111';

function ev(kind: string, at: number, extra: Partial<PlexCardEvent> = {}): PlexCardEvent {
  return {
    kind,
    key: 'session:1',
    sessionKey: '1',
    user: 'Magguu',
    player: 'Apple TV',
    title: 'Toy Story',
    mediaType: 'movie',
    at,
    ...extra,
  };
}

function fold(events: PlexCardEvent[], start: PlexCardState = emptyPlexCardState()): PlexCardState {
  return events.reduce((state, event) => applyPlexCardEvent(state, event), start);
}

// ─── pure state ───────────────────────────────────────────

test('play, pause and stop fold into one session that moves to "Zuletzt"', () => {
  let state = fold([ev('play', T0)]);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0]?.state, 'play');
  state = fold([ev('pause', T0 + 1000)], state);
  assert.equal(state.sessions[0]?.state, 'pause');
  state = fold([ev('resume', T0 + 2000)], state);
  assert.equal(state.sessions[0]?.state, 'play');
  state = fold([ev('stop', T0 + 3000)], state);
  assert.equal(state.sessions.length, 0);
  assert.deepEqual(state.recent.map((r) => r.kind), ['stop']);
});

test('watched keeps the session running and wins over the later stop', () => {
  let state = fold([ev('play', T0), ev('watched', T0 + 1000)]);
  assert.equal(state.sessions[0]?.watched, true);
  state = fold([ev('stop', T0 + 2000)], state);
  assert.deepEqual(state.recent.map((r) => r.kind), ['watched']);
});

test('a stop that arrives before watched is upgraded instead of adding a second line', () => {
  const state = fold([ev('play', T0), ev('stop', T0 + 1000), ev('watched', T0 + 2000)]);
  assert.deepEqual(state.recent.map((r) => r.kind), ['watched']);
});

test('events for unknown sessions and exact duplicates do not change the state object', () => {
  const empty = emptyPlexCardState();
  assert.equal(applyPlexCardEvent(empty, ev('stop', T0)), empty);
  assert.equal(applyPlexCardEvent(empty, ev('weird', T0)), empty);
  const playing = fold([ev('play', T0)]);
  assert.equal(applyPlexCardEvent(playing, ev('play', T0 + 500)), playing);
  assert.equal(applyPlexCardEvent(playing, ev('resume', T0 + 500)), playing);
});

test('music keeps one key across tracks and ignores late events of the previous track', () => {
  const music = (kind: string, at: number, sessionKey: string, title: string): PlexCardEvent =>
    ev(kind, at, { key: 'music:magguu:iphone', sessionKey, title, mediaType: 'track' });
  let state = fold([music('play', T0, '10', 'Song A'), music('play', T0 + 1000, '11', 'Song B')]);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0]?.title, 'Song B');
  state = applyPlexCardEvent(state, music('stop', T0 + 1500, '10', 'Song A'));
  assert.equal(state.sessions.length, 1, 'late stop of Song A must not end Song B');
  state = applyPlexCardEvent(state, music('stop', T0 + 2000, '11', 'Song B'));
  assert.equal(state.sessions.length, 0);
});

test('a new session on the same user and player replaces the old one', () => {
  const state = fold([
    ev('play', T0),
    ev('play', T0 + 1000, { key: 'session:2', sessionKey: '2', title: 'Shrek' }),
  ]);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0]?.title, 'Shrek');
  assert.deepEqual(state.recent.map((r) => r.title), ['Toy Story']);
});

test('events without user/player only leave a deduplicated history line', () => {
  const anon = (kind: string, at: number): PlexCardEvent => ev(kind, at, { key: null, user: undefined, player: undefined });
  let state = fold([anon('play', T0), anon('play', T0 + 1000), anon('pause', T0 + 2000), anon('buffer', T0 + 3000)]);
  assert.equal(state.sessions.length, 0);
  assert.equal(state.recent.length, 1);
  state = fold([anon('stop', T0 + 4000)], state);
  assert.deepEqual(state.recent.map((r) => r.kind), ['stop', 'info']);
});

test('the embed is deterministic and its hash ignores the timestamp', () => {
  const state = fold([ev('play', T0)]);
  const a = buildPlexUserCardEmbed('Magguu', state);
  const b = buildPlexUserCardEmbed('Magguu', { ...state, changedAt: state.changedAt + 60_000 });
  assert.equal(plexCardHash(a), plexCardHash(b));
  assert.notEqual(plexCardHash(a), plexCardHash(buildPlexUserCardEmbed('Magguu', fold([ev('pause', T0 + 1)], state))));
  assert.ok(String(buildPlexUserCardEmbed('Magguu', emptyPlexCardState()).data.title).includes('nicht aktiv'));
});

test('embed stays within Discord limits for many sessions and long text', () => {
  const long = 'x'.repeat(500);
  let state = emptyPlexCardState();
  for (let i = 0; i < 30; i++) {
    state = applyPlexCardEvent(state, ev('play', T0 + i, {
      key: `session:${i}`, sessionKey: String(i), user: `${long}${i}`, player: `${long}${i}`, title: long,
    }));
    state = applyPlexCardEvent(state, ev('stop', T0 + i + 1, { key: `session:${i}`, sessionKey: String(i), title: long }));
  }
  const data = buildPlexUserCardEmbed('Magguu', state).toJSON();
  assert.ok((data.description?.length ?? 0) <= 4096);
  for (const field of data.fields ?? []) assert.ok(field.value.length <= 1024);
});

test('closePlexCardSessions moves matching sessions to history', () => {
  const state = fold([ev('play', T0), ev('play', T0, { key: 'session:2', sessionKey: '2', user: 'Anna', player: 'Web', title: 'Up' })]);
  const closed = closePlexCardSessions(state, (s) => s.key === 'session:1', T0 + 10);
  assert.equal(closed.sessions.length, 1);
  assert.equal(closed.recent[0]?.title, 'Toy Story');
  assert.equal(closePlexCardSessions(state, () => false, T0), state);
});

test('player correlation key is stable across event texts and matches live sessions', () => {
  assert.equal(plexPlayerCorrelationKey({ user: ' Magguu ', player: 'Apple  TV' }), 'player:magguu:apple tv');
  assert.equal(plexPlayerCorrelationKey({}), null);
  assert.equal(plexPlayerCorrelationKey({ user: 'A', player: 'B', mediaType: 'track' }), 'music:a:b');
  assert.equal(plexActivityMatchesLiveSession('player:magguu:apple tv', { user: 'Magguu', player: 'Apple TV' }), true);
  assert.equal(plexActivityMatchesLiveSession('player:magguu:apple tv', { user: 'Anna', player: 'Apple TV' }), false);
});

// ─── manager ──────────────────────────────────────────────

class MemoryStore implements PlexCardStore {
  readonly rows = new Map<string, PlexCardRecord>();
  load(channelId: string, userKey: string): PlexCardRecord | null {
    const row = this.rows.get(`${channelId}|${userKey}`);
    return row ? structuredClone(row) : null;
  }
  save(record: PlexCardRecord): void {
    this.rows.set(`${record.channelId}|${record.userKey}`, structuredClone(record));
  }
  list(channelId: string): PlexCardRecord[] {
    return [...this.rows.values()].filter((r) => r.channelId === channelId).map((r) => structuredClone(r));
  }
}

class FakeGateway implements PlexCardGateway {
  posts: Array<{ channelId: string; embed: EmbedBuilder }> = [];
  edits: Array<{ channelId: string; messageId: string; embed: EmbedBuilder }> = [];
  editError: unknown = null;
  postError: unknown = null;
  postDelayMs = 0;
  private next = 1000;

  async post(channelId: string, embed: EmbedBuilder): Promise<string> {
    if (this.postDelayMs) await new Promise((r) => setTimeout(r, this.postDelayMs));
    if (this.postError) throw this.postError;
    this.posts.push({ channelId, embed });
    return String(this.next++);
  }

  async edit(channelId: string, messageId: string, embed: EmbedBuilder): Promise<void> {
    if (this.editError) throw this.editError;
    this.edits.push({ channelId, messageId, embed });
  }
}

class FakeTimers {
  now = T0;
  private seq = 0;
  private readonly jobs = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.jobs.set(id, { at: this.now + ms, fn });
    return id;
  };
  clearTimeout = (handle: unknown): void => {
    this.jobs.delete(handle as number);
  };
  get pending(): number {
    return this.jobs.size;
  }
  /** Advances the clock, fires due timers and lets queued promise work finish. */
  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.jobs.entries()].filter(([, j]) => j.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.jobs.delete(due[0]);
      this.now = Math.max(this.now, due[1].at);
      due[1].fn();
      await settle();
    }
    this.now = target;
    await settle();
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

function setup(options: Partial<ConstructorParameters<typeof PlexCardManager>[0]> = {}) {
  const store = new MemoryStore();
  const gateway = new FakeGateway();
  const timers = new FakeTimers();
  const logs: string[] = [];
  const make = (): PlexCardManager => new PlexCardManager({
    store,
    gateway,
    timers,
    now: () => timers.now,
    debounceMs: 4000,
    postSpacingMs: 0,
    editSpacingMs: 0,
    maxWaitMs: 15_000,
    retryMs: 30_000,
    log: (_level, msg) => logs.push(msg),
    ...options,
  });
  return { store, gateway, timers, logs, manager: make(), make };
}

test('first events post exactly one card; later events edit that same message', async () => {
  const { manager, gateway, timers, store } = setup();
  manager.handleEvent(CHANNEL, ev('play', timers.now));
  await timers.advance(4000);
  assert.equal(gateway.posts.length, 1);
  const messageId = store.load(CHANNEL, 'magguu')?.messageId;
  assert.ok(messageId);

  manager.handleEvent(CHANNEL, ev('pause', timers.now));
  await timers.advance(4000);
  manager.handleEvent(CHANNEL, ev('resume', timers.now));
  await timers.advance(4000);
  manager.handleEvent(CHANNEL, ev('stop', timers.now));
  await timers.advance(4000);

  assert.equal(gateway.posts.length, 1, 'never a second post');
  assert.equal(gateway.edits.length, 3);
  assert.ok(gateway.edits.every((e) => e.messageId === messageId));
});

test('a burst of events inside the debounce window becomes a single edit', async () => {
  const { manager, gateway, timers } = setup();
  manager.handleEvent(CHANNEL, ev('play', timers.now));
  await timers.advance(4000);
  for (let i = 0; i < 10; i++) {
    manager.handleEvent(CHANNEL, ev(i % 2 === 0 ? 'pause' : 'resume', timers.now + i));
    await timers.advance(500);
  }
  assert.equal(gateway.edits.length, 0, 'still debouncing');
  await timers.advance(4000);
  assert.equal(gateway.posts.length, 1);
  assert.ok(gateway.edits.length <= 1);
});

test('a steady stream of events is flushed after maxWait', async () => {
  const { manager, gateway, timers } = setup({ maxWaitMs: 10_000 });
  manager.handleEvent(CHANNEL, ev('play', timers.now));
  await timers.advance(4000);
  assert.equal(gateway.posts.length, 1);
  for (let i = 0; i < 30; i++) {
    manager.handleEvent(CHANNEL, ev('play', timers.now, { title: `Folge ${i}` }));
    await timers.advance(1000);
  }
  assert.ok(gateway.edits.length >= 2, 'maxWait forces edits during a long burst');
  assert.equal(gateway.posts.length, 1);
});

test('an unchanged card is neither edited nor posted again', async () => {
  const { manager, gateway, timers } = setup();
  manager.handleEvent(CHANNEL, ev('play', timers.now));
  await timers.advance(4000);
  assert.deepEqual(await manager.flush(CHANNEL), ['unchanged']);
  assert.equal(manager.handleEvent(CHANNEL, ev('play', timers.now + 1)), false, 'duplicate play is a no-op');
  assert.equal(manager.handleEvent(CHANNEL, ev('resume', timers.now + 2)), false);
  assert.equal(timers.pending, 0, 'no timer armed for a no-op event');
  // pause immediately followed by resume inside the debounce: net content unchanged
  manager.handleEvent(CHANNEL, ev('pause', timers.now + 3));
  manager.handleEvent(CHANNEL, ev('resume', timers.now + 4));
  await timers.advance(5000);
  assert.equal(gateway.posts.length, 1);
  assert.equal(gateway.edits.length, 0);
});

test('after a restart the stored message id is edited, not re-posted', async () => {
  const { manager, gateway, timers, store, make } = setup();
  manager.handleEvent(CHANNEL, ev('play', timers.now));
  await timers.advance(4000);
  const messageId = store.load(CHANNEL, 'magguu')?.messageId;

  const restarted = make();
  assert.equal(restarted.getState(CHANNEL, 'magguu').sessions.length, 1, 'state survived the restart');
  restarted.handleEvent(CHANNEL, ev('stop', timers.now));
  await timers.advance(4000);
  assert.equal(gateway.posts.length, 1);
  assert.equal(gateway.edits.length, 1);
  assert.equal(gateway.edits[0]?.messageId, messageId);
  // Boot tick on an unchanged card does nothing either.
  assert.deepEqual(await make().tick(CHANNEL), ['unchanged']);
});

test('Unknown Message (10008) posts a replacement and stores its id', async () => {
  const { manager, gateway, timers, store } = setup();
  manager.handleEvent(CHANNEL, ev('play', timers.now));
  await timers.advance(4000);
  const oldId = store.load(CHANNEL, 'magguu')?.messageId;

  gateway.editError = Object.assign(new Error('Unknown Message'), { code: 10_008 });
  await timers.advance(120_000);
  manager.handleEvent(CHANNEL, ev('pause', timers.now));
  await timers.advance(4000);
  assert.equal(gateway.posts.length, 2);
  const newId = store.load(CHANNEL, 'magguu')?.messageId;
  assert.notEqual(newId, oldId);

  gateway.editError = null;
  manager.handleEvent(CHANNEL, ev('resume', timers.now));
  await timers.advance(4000);
  assert.equal(gateway.edits.at(-1)?.messageId, newId);
  assert.equal(gateway.posts.length, 2);
});

test('a message we cannot edit (50005) is replaced, a transient error is not', () => {
  assert.equal(isMessageGone({ code: 10_008 }), true);
  assert.equal(isMessageGone({ code: 50_005 }), true);
  assert.equal(isMessageGone({ code: 50_013 }), false);
  assert.equal(isMessageGone(new Error('socket hang up')), false);
  assert.equal(isMessageGone(null), false);
});

test('transient edit errors retry without posting; only repeated failure reposts, once per cooldown', async () => {
  const { manager, gateway, timers, store, logs } = setup({ maxEditFailures: 3, repostCooldownMs: 600_000 });
  manager.handleEvent(CHANNEL, ev('play', timers.now));
  await timers.advance(4000);
  const firstId = store.load(CHANNEL, 'magguu')?.messageId;

  gateway.editError = new Error('503 Service Unavailable');
  await timers.advance(11 * 60_000); // cooldown since the first post is over
  manager.handleEvent(CHANNEL, ev('pause', timers.now));
  await timers.advance(4000); // failure 1
  assert.equal(gateway.posts.length, 1);
  assert.equal(store.load(CHANNEL, 'magguu')?.messageId, firstId);
  await timers.advance(30_000); // failure 2 (retry timer after the 30 s backoff)
  assert.equal(gateway.posts.length, 1);
  await timers.advance(30_000); // inside the 60 s backoff: no attempt, not counted
  assert.equal(gateway.posts.length, 1);
  await timers.advance(30_000); // failure 3 -> repost
  assert.equal(gateway.posts.length, 2);
  assert.ok(logs.includes('Plex card edit failed'));

  // The new message keeps failing: no further repost within the cooldown.
  manager.handleEvent(CHANNEL, ev('resume', timers.now));
  await timers.advance(4000);
  await timers.advance(60_000);
  await timers.advance(60_000);
  await timers.advance(60_000);
  assert.equal(gateway.posts.length, 2, 'repost cooldown holds');
});

test('a failing post does not lose the state and is retried without duplicates', async () => {
  const { manager, gateway, timers, store } = setup();
  gateway.postError = new Error('Missing Access');
  manager.handleEvent(CHANNEL, ev('play', timers.now));
  await timers.advance(4000);
  assert.equal(gateway.posts.length, 0);
  assert.equal(store.load(CHANNEL, 'magguu')?.messageId, null);
  gateway.postError = null;
  await timers.advance(30_000);
  assert.equal(gateway.posts.length, 1);
  await timers.advance(120_000);
  assert.equal(gateway.posts.length, 1);
});

test('parallel events and flushes never double-post (queue/mutex)', async () => {
  const { manager, gateway, timers } = setup();
  gateway.postDelayMs = 20;
  manager.handleEvent(CHANNEL, ev('play', timers.now));
  const results = await Promise.all([
    manager.flushCard(CHANNEL, 'magguu'),
    manager.flushCard(CHANNEL, 'magguu'),
    manager.flushCard(CHANNEL, 'magguu'),
    manager.tick(CHANNEL).then((r) => r[0] ?? 'unchanged'),
  ]);
  assert.equal(gateway.posts.length, 1);
  assert.deepEqual(results.filter((r) => r === 'posted').length, 1);
  assert.ok(results.every((r) => r === 'posted' || r === 'unchanged'));

  // Events arriving while a flush is in flight are kept and flushed afterwards.
  manager.handleEvent(CHANNEL, ev('pause', timers.now));
  const inFlight = manager.flushCard(CHANNEL, 'magguu');
  manager.handleEvent(CHANNEL, ev('stop', timers.now + 1));
  await inFlight;
  await manager.flushCard(CHANNEL, 'magguu');
  assert.equal(gateway.posts.length, 1);
  assert.equal(manager.getState(CHANNEL, 'magguu').sessions.length, 0);
  const last = gateway.edits.at(-1);
  assert.ok(last);
  assert.ok(String(last.embed.data.title).includes('nicht aktiv'));
});

test('no empty card is posted, and the TTL tick drops sessions that never got a stop', async () => {
  const { manager, gateway, timers, store } = setup();
  assert.deepEqual(await manager.flush(CHANNEL), []);
  assert.equal(gateway.posts.length, 0);

  manager.handleEvent(CHANNEL, ev('play', timers.now));
  await timers.advance(4000);
  assert.equal(manager.getState(CHANNEL, 'magguu').sessions.length, 1);
  await timers.advance(PLEX_CARD_SESSION_TTL_MS + 1000);
  assert.deepEqual(await manager.tick(CHANNEL), ['edited']);
  assert.equal(manager.getState(CHANNEL, 'magguu').sessions.length, 0);
  assert.equal(gateway.posts.length, 1);
  assert.ok(store.load(CHANNEL, 'magguu')?.messageId);
});

test('flushAllPending sends the outstanding debounced change on shutdown', async () => {
  const { manager, gateway, timers } = setup();
  manager.handleEvent(CHANNEL, ev('play', timers.now));
  await manager.flushAllPending();
  assert.equal(gateway.posts.length, 1);
  assert.equal(timers.pending, 0);
});

test('each channel keeps its own card', async () => {
  const { manager, gateway, timers } = setup();
  manager.handleEvent('111', ev('play', timers.now));
  manager.handleEvent('222', ev('play', timers.now));
  await timers.advance(4000);
  assert.equal(gateway.posts.length, 2);
  assert.deepEqual(gateway.posts.map((p) => p.channelId).sort(), ['111', '222']);
});
