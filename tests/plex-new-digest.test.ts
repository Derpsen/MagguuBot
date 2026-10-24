import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { EmbedBuilder } from 'discord.js';

// Config/DB are pulled in by the wiring module; throwaway env, no network (Tautulli, Discord and the clock are fakes).
const dir = mkdtempSync(join(tmpdir(), 'magguu-newdigest-'));
process.env.DISCORD_TOKEN ??= 'test-token-not-used';
process.env.DISCORD_CLIENT_ID ??= '1498095100000000001';
process.env.DISCORD_GUILD_ID ??= '1400000000000000099';
process.env.WEBHOOK_SECRET ??= 'test-secret-0123456789abcdef';
process.env.DATABASE_PATH = join(dir, 'bot.db');

const util = await import('../src/utils/plex-new-digest.ts');
const { PlexNewDigestManager } = await import('../src/discord/plex-new-digest-manager.ts');
const { PlexNewService } = await import('../src/discord/plex-new.ts');
const { prepareNeuItems } = await import('../src/utils/plex-new.ts');
const { classifyBotEmbed } = await import('../src/utils/routing.ts');
const { ensureSchema } = await import('../src/db/client.ts');
const { plexNewDigestStore } = await import('../src/discord/plex-new-digest.ts');
type Record_ = import('../src/discord/plex-new-digest-manager.ts').PlexNewDigestRecord;
type Raw = import('../src/services/tautulli.ts').TautulliRecentRaw;
type SinceResult = import('../src/discord/plex-new.ts').PlexNewSinceResult;
type NeuItem = import('../src/utils/plex-new.ts').NeuItem;

const TZ = 'Europe/Berlin';
const DAY = 86_400_000;
// Friday 2026-10-23 18:00 CEST (UTC+2) = 16:00Z, the default slot (day 5, hour 18).
const SLOT = Date.UTC(2026, 9, 23, 16, 0, 0);
// Next Friday 18:00 is after the DST end (CET, UTC+1) = 17:00Z, i.e. 7 days + 1 hour later.
const NEXT_SLOT = Date.UTC(2026, 9, 30, 17, 0, 0);

function movie(title: string, addedAt: number, year = '2025'): Raw {
  return { media_type: 'movie', title, year, added_at: Math.floor(addedAt / 1000) };
}
function episode(show: string, season: number, ep: number, addedAt: number): Raw {
  return {
    media_type: 'episode', title: `E${ep}`, grandparent_title: show,
    parent_media_index: season, media_index: ep, added_at: Math.floor(addedAt / 1000),
  };
}
function items(raw: Raw[], now: number, days = 7): NeuItem[] {
  return prepareNeuItems(raw, { now, days, type: 'all' });
}
function descr(embed: EmbedBuilder): string {
  return embed.toJSON().description ?? '';
}

// ---- schedule slot ------------------------------------------------------------------------------------

test('lastScheduledRun: Friday 18:00 Berlin in summer and winter time (DST aware)', () => {
  assert.equal(util.lastScheduledRun(SLOT, TZ, 5, 18), SLOT);
  assert.equal(util.lastScheduledRun(SLOT + 2 * DAY, TZ, 5, 18), SLOT);
  assert.equal(util.lastScheduledRun(SLOT - 1, TZ, 5, 18), SLOT - 7 * DAY);
  // 2026-10-25 02:00-03:00 is repeated; the following Friday 18:00 is CET (UTC+1) = 17:00Z.
  assert.equal(util.lastScheduledRun(Date.UTC(2026, 9, 31, 18, 0, 0), TZ, 5, 18), Date.UTC(2026, 9, 30, 17, 0, 0));
  assert.equal(util.lastScheduledRun(Date.UTC(2026, 9, 31, 12, 0, 0), TZ, 5, 18), Date.UTC(2026, 9, 30, 17, 0, 0));
});

test('lastScheduledRun: repeated hour at DST end counts once, skipped hour at DST start fires after the gap', () => {
  // Sunday 2026-10-25, hour 2: first 02:00 is CEST = 00:00Z, the repeated 02:00 CET (01:00Z) is the same slot.
  const first = Date.UTC(2026, 9, 25, 0, 0, 0);
  assert.equal(util.lastScheduledRun(first, TZ, 0, 2), first);
  assert.equal(util.lastScheduledRun(first + 3_600_000, TZ, 0, 2), first);
  assert.equal(util.decideDigest(first + 3_600_000, first, first), 'done');
  // Sunday 2027-03-28: 02:00 does not exist, the slot starts at 03:00 CEST = 01:00Z.
  const gap = Date.UTC(2027, 2, 28, 1, 0, 0);
  assert.equal(util.lastScheduledRun(gap, TZ, 0, 2), gap);
  assert.equal(util.lastScheduledRun(gap - 15 * 60_000, TZ, 0, 2), Date.UTC(2027, 2, 21, 1, 0, 0));
});

test('decideDigest: run in the slot and within 15 minutes, done after it was handled, stale later', () => {
  assert.equal(util.decideDigest(SLOT, SLOT, null), 'run');
  assert.equal(util.decideDigest(SLOT + 15 * 60_000, SLOT, null), 'run');
  assert.equal(util.decideDigest(SLOT + 15 * 60_000 + 1, SLOT, null), 'stale');
  assert.equal(util.decideDigest(SLOT + 60_000, SLOT, SLOT), 'done');
  assert.equal(util.decideDigest(SLOT + 60_000, SLOT, SLOT - 7 * DAY), 'run');
  assert.equal(util.decideDigest(SLOT, null, null), 'none');
});

// ---- embed: grouping, clipping, escaping ---------------------------------------------------------------

test('digest embed: series grouped by title, counts, one embed with movies and series sections', () => {
  const now = SLOT;
  const raw = [
    movie('Dune', now - DAY),
    episode('Severance', 2, 1, now - 2 * DAY),
    episode('Severance', 2, 2, now - 2 * DAY + 1000),
    episode('Severance', 2, 3, now - 2 * DAY + 2000),
    episode('Andor', 1, 1, now - 3 * DAY),
  ];
  const embed = util.buildDigestEmbed({ items: items(raw, now), sinceMs: now - 7 * DAY });
  const text = descr(embed);
  assert.match(text, /\*\*1\*\* Film und \*\*2\*\* Serien/);
  assert.match(text, /\*\*🎬 Filme\*\*\n• \*\*Dune\*\* \(2025\)/);
  assert.match(text, /\*\*📺 Serien\*\*/);
  assert.equal(text.match(/Severance/g)?.length, 1, 'one line per series');
  assert.doesNotMatch(text, /weitere/);
  assert.equal(embed.toJSON().footer?.text, util.DIGEST_FOOTER);
  assert.deepEqual(classifyBotEmbed({ title: embed.toJSON().title, footer: util.DIGEST_FOOTER }), ['newOnPlex', 'weeklyDigest']);
});

test('digest embed: at most 15 titles with "+N weitere", fair split between movies and series', () => {
  const now = SLOT;
  const raw: Raw[] = [];
  for (let i = 0; i < 30; i += 1) raw.push(movie(`Film ${i}`, now - 1000 * (i + 1)));
  for (let i = 0; i < 10; i += 1) raw.push(episode(`Serie ${i}`, 1, 1, now - 5000 - 1000 * i));
  const all = items(raw, now);
  assert.equal(all.length, 40);
  const embed = util.buildDigestEmbed({ items: all, sinceMs: now - 7 * DAY });
  const lines = descr(embed).split('\n').filter((l) => l.startsWith('• '));
  assert.equal(lines.length, 15);
  assert.ok(lines.some((l) => l.includes('Serie ')), 'series are not crowded out');
  assert.match(descr(embed), /\+25 weitere/);
  const sel = util.selectDigestItems(all);
  assert.equal(sel.movies.length + sel.shows.length + sel.more, 40);
  // only series: still capped
  const onlyShows = util.selectDigestItems(all.filter((i) => i.kind === 'show'), 4);
  assert.equal(onlyShows.shows.length, 4);
  assert.equal(onlyShows.more, 6);
});

test('digest embed: long titles are clipped, markdown and mentions are neutralised, truncation hint shown', () => {
  const now = SLOT;
  const raw = [
    movie('@everyone <@123456789012345678> **fett** [Link](http://x.invalid) `code` ' + 'A'.repeat(300), now - 1000),
    movie('_kursiv_ ~~weg~~ @here', now - 2000),
  ];
  const embed = util.buildDigestEmbed({ items: items(raw, now), sinceMs: now - DAY, truncated: true });
  const text = descr(embed);
  // every special character carries a backslash, so no live mention or markup is left
  assert.doesNotMatch(text, /(?<!\\)@/);
  assert.match(text, /\\@everyone/);
  assert.doesNotMatch(text, /(?<!\\)\*\*fett/);
  assert.doesNotMatch(text, /(?<!\\)\[Link\]/);
  assert.doesNotMatch(text, /A{120}/, 'clipped');
  assert.match(text, /ältere Einträge können fehlen/);
  assert.ok(text.length < 4000);
});

test('digest embed: poster only from a safe https URL', () => {
  const base = { items: items([movie('Dune', SLOT - 1000)], SLOT), sinceMs: SLOT - DAY };
  assert.equal(util.buildDigestEmbed({ ...base, posterUrl: 'https://image.tmdb.org/t/p/w500/x.jpg' }).toJSON().thumbnail?.url, 'https://image.tmdb.org/t/p/w500/x.jpg');
  assert.equal(util.buildDigestEmbed({ ...base, posterUrl: 'http://192.168.1.5:32400/library/poster?X-Plex-Token=SECRET' }).toJSON().thumbnail, undefined);
});

// ---- window ------------------------------------------------------------------------------------------

test('filterRawSince keeps only strictly newer entries; daysForWindow rounds up', () => {
  const raw = [movie('Old', SLOT - 8 * DAY), movie('Edge', SLOT - 7 * DAY), movie('New', SLOT - DAY)];
  assert.deepEqual(util.filterRawSince(raw, SLOT - 7 * DAY).map((e) => e.title), ['New']);
  assert.equal(util.daysForWindow(SLOT, SLOT - 7 * DAY), 7);
  assert.equal(util.daysForWindow(SLOT, SLOT - 7 * DAY - 1), 8);
  assert.equal(util.daysForWindow(SLOT, SLOT - 60_000), 1);
});

test('PlexNewService.getSince: new items since the last digest, series grouped, stale fallback counts as unavailable', async () => {
  let now = SLOT;
  let fail = false;
  const service = new PlexNewService({
    configured: () => true,
    fetchRecent: async (type) => {
      if (fail) return null;
      return type === 'movie'
        ? [movie('Neu', SLOT - 1000), movie('Alt', SLOT - 9 * DAY)]
        : [episode('Show', 1, 1, SLOT - 2000), episode('Show', 1, 2, SLOT - 3000), episode('Show', 1, 3, SLOT - 6 * DAY)];
    },
    now: () => now,
    ttlMs: 5 * 60_000,
    failTtlMs: 1000,
  });
  const res = await service.getSince(SLOT - 7 * DAY);
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.deepEqual(res.items.map((i) => i.title).sort(), ['Neu', 'Show']);
  assert.equal(res.fetchedAt, SLOT);
  assert.equal((await service.getSince(SLOT - 500)).ok && true, true);
  // Later: data is old and the refetch fails → stale fallback beyond the max age is not used.
  now = SLOT + 20 * 60_000;
  fail = true;
  const failed = await service.getSince(SLOT - 7 * DAY);
  assert.deepEqual(failed, { ok: false, reason: 'unavailable' });
  const unconfigured = new PlexNewService({ configured: () => false, fetchRecent: async () => [], now: () => now });
  assert.deepEqual(await unconfigured.getSince(0), { ok: false, reason: 'not-configured' });
});

// ---- manager -----------------------------------------------------------------------------------------

interface Harness {
  clock: { now: number };
  posts: Array<{ channelId: string; embed: EmbedBuilder }>;
  logs: Array<{ level: string; msg: string; data?: Record<string, unknown> }>;
  fetches: number[];
  saved: Record_[];
  state: { record: Record_ | null; failSave: boolean };
  post: { error: unknown };
  data: { items: NeuItem[]; ok: boolean; fetchedAtOffset: number };
  channel: { id: string | undefined };
  make: (over?: { pauseMs?: number }) => InstanceType<typeof PlexNewDigestManager>;
}

function harness(now = SLOT): Harness {
  const h: Harness = {
    clock: { now },
    posts: [],
    logs: [],
    fetches: [],
    saved: [],
    state: { record: null, failSave: false },
    post: { error: null },
    data: { items: items([movie('Dune', now - 1000)], now), ok: true, fetchedAtOffset: 0 },
    channel: { id: '1400000000000000555' },
    make(over) {
      return new PlexNewDigestManager({
        store: {
          load: () => h.state.record,
          save: (r) => {
            if (h.state.failSave) throw new Error('disk full');
            h.state.record = r;
            h.saved.push(r);
          },
        },
        post: async (channelId, embed) => {
          if (h.post.error) throw h.post.error;
          h.posts.push({ channelId, embed });
          return `msg-${h.posts.length}`;
        },
        fetchSince: async (since): Promise<SinceResult> => {
          h.fetches.push(since);
          return h.data.ok
            ? { ok: true, items: h.data.items, truncated: false, fetchedAt: h.clock.now + h.data.fetchedAtOffset }
            : { ok: false, reason: 'unavailable' };
        },
        posterFor: async () => null,
        channelId: () => h.channel.id,
        timeZone: TZ,
        day: 5,
        hour: 18,
        now: () => h.clock.now,
        pauseMs: over?.pauseMs,
        log: (level, msg, data) => h.logs.push({ level, msg, data }),
      });
    },
  };
  return h;
}

test('manager: posts exactly one embed at the slot and records it; first window is 7 days', async () => {
  const h = harness();
  const m = h.make();
  assert.equal(await m.tick(), 'posted');
  assert.equal(h.posts.length, 1);
  assert.equal(h.posts[0]?.channelId, '1400000000000000555');
  assert.equal(h.fetches[0], SLOT - 7 * DAY);
  assert.equal(h.state.record?.lastScheduledAt, SLOT);
  assert.equal(h.state.record?.lastRunAt, SLOT);
  assert.equal(h.state.record?.lastMessageId, 'msg-1');
  // Same slot again (next 5-min tick): nothing more, no second fetch.
  h.clock.now = SLOT + 5 * 60_000;
  assert.equal(await m.tick(), 'done');
  assert.equal(h.posts.length, 1);
  assert.equal(h.fetches.length, 1);
});

test('manager: the next slot starts its window at the previous data time', async () => {
  const h = harness();
  const m = h.make();
  await m.tick();
  h.clock.now = NEXT_SLOT + 60_000;
  h.fetches.length = 0;
  assert.equal(await m.tick(), 'posted');
  assert.equal(h.fetches[0], SLOT);
  assert.equal(h.posts.length, 2);
});

test('manager: nothing new posts nothing, but the slot is recorded (no retries, window moves on)', async () => {
  const h = harness();
  h.data.items = [];
  const m = h.make();
  assert.equal(await m.tick(), 'empty');
  assert.equal(h.posts.length, 0);
  assert.equal(h.state.record?.lastScheduledAt, SLOT);
  assert.equal(h.state.record?.lastPostedAt, null);
  h.clock.now = SLOT + 5 * 60_000;
  assert.equal(await m.tick(), 'done');
  assert.equal(h.fetches.length, 1);
});

test('manager: restart dedupe, a new process with the persisted state does not post the slot again', async () => {
  const h = harness();
  assert.equal(await h.make().tick(), 'posted');
  h.clock.now = SLOT + 3 * 60_000;
  const restarted = h.make();
  assert.equal(await restarted.tick(), 'done');
  assert.equal(h.posts.length, 1);
});

test('manager: failed state save after a post still never double-posts within this process', async () => {
  const h = harness();
  h.state.failSave = true;
  const m = h.make();
  assert.equal(await m.tick(), 'posted');
  assert.ok(h.logs.some((l) => l.level === 'warn' && /could not be saved/.test(l.msg)));
  h.clock.now = SLOT + 5 * 60_000;
  assert.equal(await m.tick(), 'done');
  assert.equal(h.posts.length, 1);
});

test('manager: catch-up after a restart only within 15 minutes of the slot', async () => {
  const late = harness(SLOT + 14 * 60_000);
  assert.equal(await late.make().tick(), 'posted');
  const tooLate = harness(SLOT + 16 * 60_000);
  assert.equal(await tooLate.make().tick(), 'stale');
  assert.equal(tooLate.posts.length, 0);
  assert.equal(tooLate.fetches.length, 0);
  assert.equal(tooLate.state.record, null, 'a skipped slot is not recorded; the next digest covers the longer window');
  // The following week the window starts at the last real run.
  const h = harness(SLOT + 3 * DAY);
  h.state.record = { lastScheduledAt: SLOT - 7 * DAY, lastRunAt: SLOT - 7 * DAY, lastPostedAt: null, lastMessageId: null, pausedUntil: null };
  assert.equal(await h.make().tick(), 'stale');
  h.clock.now = NEXT_SLOT;
  assert.equal(await h.make().tick(), 'posted');
  assert.equal(h.fetches[0], SLOT - 7 * DAY);
});

test('manager: not due outside any slot window (Saturday) does nothing', async () => {
  const h = harness(SLOT + DAY);
  assert.equal(await h.make().tick(), 'stale');
  assert.equal(h.posts.length + h.fetches.length, 0);
});

test('manager: Tautulli unavailable is not recorded and retried on the next tick inside the grace window', async () => {
  const h = harness();
  h.data.ok = false;
  const m = h.make();
  assert.equal(await m.tick(), 'unavailable');
  assert.equal(h.state.record, null);
  assert.ok(h.logs.some((l) => l.level === 'warn'));
  h.data.ok = true;
  h.clock.now = SLOT + 5 * 60_000;
  assert.equal(await m.tick(), 'posted');
  assert.equal(h.posts.length, 1);
});

test('manager: a transient Discord error is retried, not recorded', async () => {
  const h = harness();
  h.post.error = Object.assign(new Error('rate limited'), { code: 429 });
  const m = h.make();
  assert.equal(await m.tick(), 'error');
  assert.equal(h.state.record, null);
  assert.equal(h.logs.at(-1)?.level, 'warn');
  h.post.error = null;
  h.clock.now = SLOT + 5 * 60_000;
  assert.equal(await m.tick(), 'posted');
});

for (const code of [10003, 50001, 50013]) {
  test(`manager: permanent Discord error ${code} pauses for 30 minutes with a warn log and no alarm`, async () => {
    const h = harness();
    h.post.error = Object.assign(new Error(`Discord ${code}`), { code });
    const m = h.make();
    assert.equal(await m.tick(), 'paused');
    assert.equal(h.state.record?.pausedUntil, SLOT + 30 * 60_000);
    assert.equal(h.state.record?.lastScheduledAt ?? null, null, 'slot is not consumed');
    const warn = h.logs.find((l) => l.level === 'warn' && /paused/.test(l.msg));
    assert.ok(warn, 'warn log');
    assert.equal(warn?.data?.code, code);
    assert.ok(warn?.data?.err instanceof Error, 'error passed under the err key for the serializer');
    assert.equal(h.logs.filter((l) => l.level !== 'debug' && l.level !== 'warn').length, 0, 'no other levels (no alarm path)');
    // During the pause nothing is attempted, even with a working gateway.
    h.post.error = null;
    h.clock.now = SLOT + 5 * 60_000;
    assert.equal(await m.tick(), 'paused');
    assert.equal(h.posts.length, 0);
  });
}

test('manager: after the pause ends (and still inside the grace window) the digest is delivered', async () => {
  const h = harness();
  h.post.error = Object.assign(new Error('missing perms'), { code: 50013 });
  const m = h.make({ pauseMs: 5 * 60_000 });
  assert.equal(await m.tick(), 'paused');
  h.post.error = null;
  h.clock.now = SLOT + 6 * 60_000;
  assert.equal(await m.tick(), 'posted');
  assert.equal(h.state.record?.pausedUntil, null);
});

test('manager: default 30 minute pause outlasts the 15 minute grace, the slot is skipped quietly', async () => {
  const h = harness();
  h.post.error = Object.assign(new Error('gone'), { code: 10003 });
  const m = h.make();
  await m.tick();
  h.post.error = null;
  h.clock.now = SLOT + 31 * 60_000;
  assert.equal(await m.tick(), 'stale');
  assert.equal(h.posts.length, 0);
});

test('manager: no channel configured skips quietly without fetching', async () => {
  const h = harness();
  h.channel.id = undefined;
  assert.equal(await h.make().tick(), 'no-channel');
  assert.equal(h.fetches.length, 0);
  assert.equal(h.logs.filter((l) => l.level === 'warn').length, 0);
});

test('manager: concurrent ticks do not double-post', async () => {
  const h = harness();
  const m = h.make();
  const [a, b] = await Promise.all([m.tick(), m.tick()]);
  assert.deepEqual([a, b].sort(), ['not-due', 'posted']);
  assert.equal(h.posts.length, 1);
});

// ---- window: snapshot time as the upper bound (no loss, no duplicates) ---------------------------------

test('filterRawSince with untilMs: entries after the snapshot time are left for the next digest', () => {
  const raw = [movie('Old', SLOT - DAY), movie('At', SLOT), movie('After', SLOT + 1000)];
  assert.deepEqual(util.filterRawSince(raw, SLOT - 2 * DAY, SLOT).map((e) => e.title), ['Old', 'At']);
  assert.deepEqual(util.filterRawSince(raw, SLOT, SLOT + 60_000).map((e) => e.title), ['After']);
  assert.deepEqual(util.filterRawSince(raw, SLOT - 2 * DAY).map((e) => e.title), ['Old', 'At', 'After'], 'unbounded without untilMs');
});

test('PlexNewService.getSince: movie and series lists fetched at different times - the next window loses nothing and repeats nothing', async () => {
  let now = SLOT;
  const lists: { movie: Raw[]; show: Raw[] } = {
    movie: [movie('Film A', SLOT - 5 * 60_000)],
    show: [episode('Serie A', 1, 1, SLOT - 6 * 60_000)],
  };
  const service = new PlexNewService({
    configured: () => true,
    fetchRecent: async (type) => structuredClone(lists[type]),
    now: () => now,
    ttlMs: 5 * 60_000,
  });
  // Movies are fetched at SLOT, the series list 4 minutes later; a late episode lands in between.
  await service.get('movies', 7);
  now = SLOT + 4 * 60_000;
  lists.show.push(episode('Serie B', 1, 1, SLOT + 2 * 60_000));
  await service.get('shows', 7);
  now = SLOT + 4.5 * 60_000;
  const first = await service.getSince(SLOT - 7 * DAY);
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.fetchedAt, SLOT, 'the older snapshot defines the data time');
  assert.deepEqual(first.items.map((i) => i.title).sort(), ['Film A', 'Serie A'], 'Serie B (after the snapshot time) is held back');

  // Next digest: window starts at the stored data time (what the manager persists as lastRunAt).
  lists.movie.push(movie('Film B', SLOT + 3 * 60_000));
  now = NEXT_SLOT;
  const second = await service.getSince(first.fetchedAt);
  assert.ok(second.ok);
  if (!second.ok) return;
  assert.deepEqual(second.items.map((i) => i.title).sort(), ['Film B', 'Serie B'], 'nothing lost, nothing reported twice');
  // Using "now" (SLOT + 4.5 min) as lastRunAt instead would lose Film B (added SLOT + 3 min, not yet in the movie snapshot).
});

// ---- catch-up until Sunday 23:59 ----------------------------------------------------------------------

const PRIOR: Record_ = {
  lastScheduledAt: SLOT - 7 * DAY, lastRunAt: SLOT - 7 * DAY, lastPostedAt: SLOT - 7 * DAY, lastMessageId: 'old', pausedUntil: null,
};
// Monday 2026-10-26 00:00 CET (after the DST end on Sunday 25th) = Sunday 23:00Z.
const WEEK_END = Date.UTC(2026, 9, 25, 23, 0, 0);

test('catchUpDeadline: start of the next local Monday, DST aware', () => {
  assert.equal(util.catchUpDeadline(SLOT, TZ), WEEK_END, 'Friday slot, week with the autumn DST change on Sunday');
  // Friday 2027-03-26 18:00 CET = 17:00Z; Monday 2027-03-29 00:00 CEST = Sunday 22:00Z (spring forward on the Sunday).
  assert.equal(util.catchUpDeadline(Date.UTC(2027, 2, 26, 17, 0, 0), TZ), Date.UTC(2027, 2, 28, 22, 0, 0));
  // A Sunday slot may be caught up until that evening's end; a Monday slot until the following Monday.
  assert.equal(util.catchUpDeadline(Date.UTC(2026, 9, 25, 16, 0, 0), TZ), WEEK_END);
  assert.equal(util.catchUpDeadline(Date.UTC(2026, 9, 26, 7, 0, 0), TZ), Date.UTC(2026, 10, 1, 23, 0, 0));
  // Other zone: Friday 18:00 in Tokyo -> Monday 00:00 JST = Sunday 15:00Z.
  assert.equal(util.catchUpDeadline(Date.UTC(2026, 9, 23, 9, 0, 0), 'Asia/Tokyo'), Date.UTC(2026, 9, 25, 15, 0, 0));
});

test('decideDigest with catch-up: run until the deadline, stale from it on, done wins', () => {
  assert.equal(util.decideDigest(SLOT + DAY, SLOT, null, WEEK_END), 'run');
  assert.equal(util.decideDigest(WEEK_END - 1, SLOT, null, WEEK_END), 'run');
  assert.equal(util.decideDigest(WEEK_END, SLOT, null, WEEK_END), 'stale');
  assert.equal(util.decideDigest(SLOT + DAY, SLOT, SLOT, WEEK_END), 'done');
  assert.equal(util.decideDigest(SLOT + DAY, SLOT, null), 'stale', 'without a deadline only the grace window counts');
});

test('manager: an outage over the slot is caught up on Saturday, once, and the window starts at the previous run', async () => {
  const h = harness(SLOT + 20 * 3_600_000); // Saturday 12:00 CEST
  h.state.record = { ...PRIOR };
  const m = h.make();
  assert.equal(await m.tick(), 'posted');
  assert.equal(h.fetches[0], SLOT - 7 * DAY);
  assert.equal(h.state.record?.lastScheduledAt, SLOT, 'persisted slot is the scheduled one, not the late time');
  assert.ok(h.logs.some((l) => l.level === 'info' && /late/.test(l.msg)));
  for (const later of [5 * 60_000, 3_600_000, DAY]) {
    h.clock.now += later;
    assert.equal(await m.tick(), 'done');
  }
  assert.equal(await h.make().tick(), 'done', 'a restart (persisted slot) does not post it again either');
  assert.equal(h.posts.length, 1);
  // The following week is a normal slot with its own window.
  h.clock.now = NEXT_SLOT + 60_000;
  h.fetches.length = 0;
  assert.equal(await h.make().tick(), 'posted');
  assert.equal(h.fetches[0], SLOT + 20 * 3_600_000, 'window starts at the data time of the catch-up run');
});

test('manager: catch-up ends Sunday 23:59 local (Monday 00:00 CET is too late)', async () => {
  const lastMinute = harness(WEEK_END - 60_000);
  lastMinute.state.record = { ...PRIOR };
  assert.equal(await lastMinute.make().tick(), 'posted');
  const tooLate = harness(WEEK_END);
  tooLate.state.record = { ...PRIOR };
  assert.equal(await tooLate.make().tick(), 'stale');
  assert.equal(tooLate.posts.length + tooLate.fetches.length, 0);
});

test('manager: the very first digest keeps the strict 15 minute window (no surprise post after deploy or a schedule change)', async () => {
  const h = harness(SLOT + 20 * 3_600_000);
  assert.equal(await h.make().tick(), 'stale');
  assert.equal(h.posts.length + h.fetches.length, 0);
});

test('manager: Tautulli down for days is warned about once per slot, then the digest arrives when it is back', async () => {
  const h = harness(SLOT + 16 * 60_000);
  h.state.record = { ...PRIOR };
  h.data.ok = false;
  const m = h.make();
  for (let i = 0; i < 40; i += 1) {
    assert.equal(await m.tick(), 'unavailable');
    h.clock.now += 5 * 60_000;
  }
  assert.equal(h.logs.filter((l) => l.level === 'warn').length, 1, 'one warning, not one per tick');
  assert.ok(h.logs.filter((l) => l.level === 'debug').length >= 39);
  assert.equal(h.logs.filter((l) => l.level === 'error').length, 0, 'never an alarm');
  h.data.ok = true;
  assert.equal(await m.tick(), 'posted');
});

test('manager: a permanent Discord error pause (30 min) no longer costs the week once a digest has run before', async () => {
  const h = harness();
  h.state.record = { ...PRIOR };
  h.post.error = Object.assign(new Error('missing perms'), { code: 50013 });
  const m = h.make();
  assert.equal(await m.tick(), 'paused');
  h.post.error = null;
  h.clock.now = SLOT + 31 * 60_000;
  assert.equal(await m.tick(), 'posted');
  assert.equal(h.logs.filter((l) => l.level === 'warn').length, 1);
});

test('manager: a Saturday slot after DST-free weeks and a Sunday slot are each delivered once (day 0)', async () => {
  const slot = Date.UTC(2026, 9, 25, 17, 0, 0); // Sunday 18:00 CET
  const h = harness(slot + 3_600_000);
  const m = new PlexNewDigestManager({
    store: { load: () => h.state.record, save: (r) => { h.state.record = r; } },
    post: async (channelId, embed) => { h.posts.push({ channelId, embed }); return 'm'; },
    fetchSince: async (): Promise<SinceResult> => ({ ok: true, items: h.data.items, truncated: false, fetchedAt: h.clock.now }),
    posterFor: async () => null,
    channelId: () => 'c',
    timeZone: TZ,
    day: 0,
    hour: 18,
    now: () => h.clock.now,
  });
  h.state.record = { ...PRIOR, lastScheduledAt: slot - 7 * DAY, lastRunAt: slot - 7 * DAY };
  assert.equal(await m.tick(), 'posted');
  h.clock.now = slot + 5 * 3_600_000; // still Sunday 23:00 CET
  assert.equal(await m.tick(), 'done');
});

// ---- persistence ---------------------------------------------------------------------------------------

test('SQLite store: table is created idempotently and the record survives a reload', () => {
  assert.doesNotThrow(() => { ensureSchema(); ensureSchema(); });
  assert.equal(plexNewDigestStore.load(), null);
  const rec = { lastScheduledAt: SLOT, lastRunAt: SLOT + 5, lastPostedAt: SLOT + 9, lastMessageId: '1400000000000000777', pausedUntil: null };
  plexNewDigestStore.save(rec);
  assert.deepEqual(plexNewDigestStore.load(), rec);
  plexNewDigestStore.save({ ...rec, pausedUntil: SLOT + 1800_000 });
  assert.equal(plexNewDigestStore.load()?.pausedUntil, SLOT + 1800_000);
  assert.doesNotThrow(() => ensureSchema());
  assert.equal(plexNewDigestStore.load()?.lastMessageId, '1400000000000000777');
});
