import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { EmbedBuilder } from 'discord.js';

// Wiring of the new-added digest: env/config -> manager, channel order, enable switch, scheduler timer.
// Throwaway env + DB; Discord, Tautulli and the clock are fakes, and no real timer is ever started.
const dir = mkdtempSync(join(tmpdir(), 'magguu-newdigest-wiring-'));
const BASE_ENV = {
  DISCORD_TOKEN: 'test-token-not-used',
  DISCORD_CLIENT_ID: '1498095100000000001',
  DISCORD_GUILD_ID: '1400000000000000099',
  WEBHOOK_SECRET: 'test-secret-0123456789abcdef',
  DATABASE_PATH: join(dir, 'bot.db'),
};
Object.assign(process.env, BASE_ENV);
for (const k of ['PLEX_NEW_DIGEST_ENABLED', 'PLEX_NEW_DIGEST_DAY', 'PLEX_NEW_DIGEST_HOUR', 'DISCORD_CHANNEL_NEW_ADDED',
  'DISCORD_CHANNEL_NEW_ON_PLEX', 'DISCORD_CHANNEL_WEEKLY_DIGEST', 'ADDON_RELEASE_POLL_MINUTES', 'MAGGUUUI_READ_TOKEN']) {
  delete process.env[k];
}

const { config } = await import('../src/config.ts');
const { ensureSchema } = await import('../src/db/client.ts');
const { saveChannel } = await import('../src/discord/channel-store.ts');
const digest = await import('../src/discord/plex-new-digest.ts');
const { PlexNewDigestManager } = await import('../src/discord/plex-new-digest-manager.ts');
const scheduler = await import('../src/discord/scheduler.ts');
type Record_ = import('../src/discord/plex-new-digest-manager.ts').PlexNewDigestRecord;
type SinceResult = import('../src/discord/plex-new.ts').PlexNewSinceResult;

ensureSchema();
const TZ = 'Europe/Berlin';
const mutable = config as unknown as Record<string, unknown>;

after(() => {
  digest.setPlexNewDigestForTests(null);
});

// ---- env -> config --------------------------------------------------------------------------------------

test('defaults: enabled, Friday 18:00, no explicit channel', () => {
  assert.equal(config.PLEX_NEW_DIGEST_ENABLED, true);
  assert.equal(config.PLEX_NEW_DIGEST_DAY, 5);
  assert.equal(config.PLEX_NEW_DIGEST_HOUR, 18);
  assert.equal(config.DISCORD_CHANNEL_NEW_ADDED, undefined);
});

function configFromEnv(extra: Record<string, string>): { enabled: boolean; day: number; hour: number; channel?: string } {
  const out = execFileSync(
    process.execPath,
    ['--import', 'tsx', '-e',
      "import('./src/config.ts').then(({config:c})=>console.log(JSON.stringify({enabled:c.PLEX_NEW_DIGEST_ENABLED,day:c.PLEX_NEW_DIGEST_DAY,hour:c.PLEX_NEW_DIGEST_HOUR,channel:c.DISCORD_CHANNEL_NEW_ADDED})))"],
    { env: { ...process.env, ...extra }, encoding: 'utf8' },
  );
  return JSON.parse(out.trim().split('\n').at(-1) ?? '{}') as { enabled: boolean; day: number; hour: number; channel?: string };
}

test('env: PLEX_NEW_DIGEST_DAY / _HOUR / _ENABLED / DISCORD_CHANNEL_NEW_ADDED are read; invalid values are rejected', () => {
  assert.deepEqual(
    configFromEnv({ PLEX_NEW_DIGEST_DAY: '2', PLEX_NEW_DIGEST_HOUR: '7', PLEX_NEW_DIGEST_ENABLED: 'false', DISCORD_CHANNEL_NEW_ADDED: '1400000000000000321' }),
    { enabled: false, day: 2, hour: 7, channel: '1400000000000000321' },
  );
  assert.equal(configFromEnv({ PLEX_NEW_DIGEST_ENABLED: '0' }).enabled, false);
  assert.equal(configFromEnv({ PLEX_NEW_DIGEST_ENABLED: 'true' }).enabled, true);
  assert.throws(() => configFromEnv({ PLEX_NEW_DIGEST_DAY: '7' }), /./);
  assert.throws(() => configFromEnv({ PLEX_NEW_DIGEST_HOUR: '24' }), /./);
});

// ---- channel order ----------------------------------------------------------------------------------------

test('channel order: DISCORD_CHANNEL_NEW_ADDED, then newOnPlex, then weeklyDigest', () => {
  assert.equal(digest.plexNewDigestChannelId(), undefined, 'nothing configured');
  saveChannel('weeklyDigest', '1400000000000000003');
  assert.equal(digest.plexNewDigestChannelId(), '1400000000000000003');
  saveChannel('newOnPlex', '1400000000000000002');
  assert.equal(digest.plexNewDigestChannelId(), '1400000000000000002');
  mutable.DISCORD_CHANNEL_NEW_ADDED = '1400000000000000001';
  assert.equal(digest.plexNewDigestChannelId(), '1400000000000000001');
  mutable.DISCORD_CHANNEL_NEW_ADDED = '';
  assert.equal(digest.plexNewDigestChannelId(), '1400000000000000002', 'empty override falls through');
  mutable.DISCORD_CHANNEL_NEW_ADDED = undefined;
});

// ---- day/hour reach the manager ---------------------------------------------------------------------------

function memoryDeps(now: () => number, channel = '1400000000000000555') {
  const posts: Array<{ channelId: string; embed: EmbedBuilder }> = [];
  let record: Record_ | null = null;
  return {
    posts,
    deps: {
      store: { load: () => record, save: (r: Record_) => { record = r; } },
      post: async (channelId: string, embed: EmbedBuilder) => { posts.push({ channelId, embed }); return 'm1'; },
      fetchSince: async (): Promise<SinceResult> => ({
        ok: true,
        items: [{ kind: 'movie', title: 'Dune', year: '2025', detail: '', addedAt: now() - 1000 } as never],
        truncated: false,
        fetchedAt: now(),
      }),
      posterFor: async () => null,
      channelId: () => channel,
      now,
    },
  };
}

test('config day/hour drive the production deps: default Friday 18:00, then Wednesday 09:00 Berlin', async () => {
  const fridaySlot = Date.UTC(2026, 9, 23, 16, 0, 0); // Fri 18:00 CEST
  const wedSlot = Date.UTC(2026, 9, 21, 7, 0, 0); // Wed 09:00 CEST

  const defaults = digest.plexNewDigestDeps();
  assert.equal(defaults.day, 5);
  assert.equal(defaults.hour, 18);
  assert.equal(defaults.timeZone, config.TIME_ZONE);
  assert.equal(defaults.channelId, digest.plexNewDigestChannelId);

  let now = fridaySlot;
  const a = memoryDeps(() => now);
  const friday = new PlexNewDigestManager(digest.plexNewDigestDeps({ ...a.deps, timeZone: TZ }));
  assert.equal(await friday.tick(), 'posted');
  now = wedSlot;
  const b = memoryDeps(() => now);
  assert.equal(await new PlexNewDigestManager(digest.plexNewDigestDeps({ ...b.deps, timeZone: TZ })).tick(), 'stale', 'Wednesday is not a Friday slot');

  mutable.PLEX_NEW_DIGEST_DAY = 3;
  mutable.PLEX_NEW_DIGEST_HOUR = 9;
  try {
    const custom = digest.plexNewDigestDeps();
    assert.equal(custom.day, 3);
    assert.equal(custom.hour, 9);
    now = wedSlot;
    const c = memoryDeps(() => now);
    assert.equal(await new PlexNewDigestManager(digest.plexNewDigestDeps({ ...c.deps, timeZone: TZ })).tick(), 'posted');
    assert.equal(c.posts.length, 1);
    now = fridaySlot;
    const d = memoryDeps(() => now);
    assert.equal(await new PlexNewDigestManager(digest.plexNewDigestDeps({ ...d.deps, timeZone: TZ })).tick(), 'stale');
  } finally {
    mutable.PLEX_NEW_DIGEST_DAY = 5;
    mutable.PLEX_NEW_DIGEST_HOUR = 18;
  }
});

// ---- enable switch ----------------------------------------------------------------------------------------

test('PLEX_NEW_DIGEST_ENABLED=false: the tick never reaches the manager; true: it does', async () => {
  let ticks = 0;
  digest.setPlexNewDigestForTests({ tick: async () => { ticks += 1; return 'not-due'; } });
  mutable.PLEX_NEW_DIGEST_ENABLED = false;
  try {
    await digest.runPlexNewDigestTick();
    await digest.runPlexNewDigestTick();
    assert.equal(ticks, 0);
    mutable.PLEX_NEW_DIGEST_ENABLED = true;
    await digest.runPlexNewDigestTick();
    assert.equal(ticks, 1);
  } finally {
    mutable.PLEX_NEW_DIGEST_ENABLED = true;
    digest.setPlexNewDigestForTests(null);
  }
});

// ---- scheduler: interval start / stop ---------------------------------------------------------------------

test('scheduler: one 5 minute interval drives the digest tick; stopScheduler clears every timer; start is idempotent', async () => {
  const intervals: Array<{ handle: object; fn: () => void; ms: number }> = [];
  const cleared: object[] = [];
  const immediates: Array<() => void> = [];
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  const realSetImmediate = globalThis.setImmediate;
  const patch = globalThis as unknown as Record<string, unknown>;
  patch.setInterval = (fn: () => void, ms: number) => {
    const handle = { unref() { return this; }, ref() { return this; } };
    intervals.push({ handle, fn, ms });
    return handle;
  };
  patch.clearInterval = (handle: object) => { cleared.push(handle); };
  patch.setImmediate = (fn: () => void) => { immediates.push(fn); return {}; };

  let ticks = 0;
  let release: (() => void) | null = null;
  digest.setPlexNewDigestForTests({
    tick: () => {
      ticks += 1;
      return new Promise((resolve) => { release = () => resolve('not-due'); });
    },
  });
  try {
    scheduler.startScheduler();
    const digestTimers = intervals.filter((i) => i.ms === 5 * 60_000);
    assert.equal(digestTimers.length, 1, 'exactly one 5 minute interval (digest), well below the 15 minute catch-up grace');
    const total = intervals.length;
    assert.ok(total > 10);
    assert.equal(immediates.length, 1, 'one boot tick is scheduled');

    // The interval callback runs the digest tick; an overlapping callback is skipped while the first still runs.
    digestTimers[0]?.fn();
    assert.equal(ticks, 1);
    digestTimers[0]?.fn();
    assert.equal(ticks, 1, 'overlap guard');
    (release as (() => void) | null)?.();
    await new Promise((r) => realSetImmediate(r));
    await new Promise((r) => realSetImmediate(r));
    digestTimers[0]?.fn();
    assert.equal(ticks, 2, 'next tick after the previous finished');
    (release as (() => void) | null)?.();

    scheduler.startScheduler();
    assert.equal(intervals.length, total, 'a second start does not add timers');

    scheduler.stopScheduler();
    assert.ok(cleared.includes(digestTimers[0]?.handle as object), 'digest timer cleared');
    assert.equal(new Set(cleared).size, total, 'every interval handle was cleared');

    scheduler.startScheduler();
    assert.equal(intervals.length, total * 2, 'restart creates a fresh set');
    scheduler.stopScheduler();
    assert.equal(new Set(cleared).size, total * 2);
  } finally {
    scheduler.stopScheduler();
    patch.setInterval = realSetInterval;
    patch.clearInterval = realClearInterval;
    patch.setImmediate = realSetImmediate;
    digest.setPlexNewDigestForTests(null);
  }
});
