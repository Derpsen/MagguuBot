import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EmbedBuilder } from 'discord.js';
import type { PlexCardGateway } from '../src/discord/plex-card-manager.ts';
import {
  PlexWeeklyManager,
  type PlexWeeklyRecord,
  type PlexWeeklyStore,
} from '../src/discord/plex-weekly-manager.ts';
import {
  aggregatePlexWeekly,
  buildPlexWeeklyEmbed,
  duePlexWeeklyPeriod,
  formatWatchTime,
  nextWeeklyRun,
  plexWeeklyHash,
  PLEX_WEEKLY_FOOTER,
  type PlexWeeklyRaw,
} from '../src/utils/plex-weekly.ts';
import { classifyBotEmbed } from '../src/utils/routing.ts';
import { weeklyPeriodKey } from '../src/utils/schedule.ts';

// Fixtures follow the Tautulli v2 shape (get_home_stats / get_plays_by_date); they are hand-written,
// not recorded from a live server.
const HOME: PlexWeeklyRaw['home'] = [
  {
    stat_id: 'top_movies',
    rows: [
      { title: 'Dune', year: 2021, total_plays: 2, total_duration: 18_000 },
      { title: 'Heat', year: 1995, total_plays: 5, total_duration: 52_000 },
      { title: 'Nie gesehen', total_plays: 0, total_duration: 0 },
      { total_plays: 1, total_duration: 3_600 },
    ],
  },
  {
    stat_id: 'top_tv',
    rows: [
      { title: 'Severance', total_plays: 9, total_duration: 25_200 },
      { title: 'Andor', total_plays: 9, total_duration: 30_000 },
    ],
  },
  {
    stat_id: 'top_users',
    rows: [
      { friendly_name: 'Anna', user: 'anna01', total_plays: 8, total_duration: 40_000 },
      { user: 'ben', total_plays: 11, total_duration: 60_000 },
    ],
  },
  { stat_id: 'popular_tv', rows: [{ title: 'ignored' }] },
];
const PLAYS = {
  categories: ['2026-10-18', '2026-10-19'],
  series: [
    { name: 'TV', data: [3, '4', null] },
    { name: 'Movies', data: [1, 2] },
  ],
};
const DURATION = {
  categories: ['2026-10-18', '2026-10-19'],
  series: [
    { name: 'TV', data: [7_200, 3_600] },
    { name: 'Movies', data: [5_400, 1_800] },
  ],
};
const RAW: PlexWeeklyRaw = { home: HOME, plays: PLAYS, duration: DURATION };
const TZ = 'Europe/Berlin';
const NOW = Date.UTC(2026, 9, 26, 6, 0, 0); // Mon 26.10.2026 07:00 Berlin

test('aggregate: top lists sorted, empty/zero rows dropped, totals from the per-day history', () => {
  const s = aggregatePlexWeekly(RAW);
  assert.deepEqual(s.movies.map((m) => m.name), ['Heat', 'Dune', 'Unbekannt']);
  assert.equal(s.movies[0]?.year, '1995');
  // equal plays → more watch time first
  assert.deepEqual(s.shows.map((m) => m.name), ['Andor', 'Severance']);
  assert.deepEqual(s.users.map((u) => u.name), ['ben', 'Anna']);
  assert.equal(s.totalPlays, 10);
  assert.equal(s.totalSeconds, 18_000);
  assert.equal(s.totalsSource, 'history');
  assert.equal(s.userCount, 2);
  assert.equal(s.userCountCapped, false);
});

test('aggregate: without history series the totals fall back to the user ranking', () => {
  const s = aggregatePlexWeekly({ home: HOME, plays: null, duration: null });
  assert.equal(s.totalsSource, 'users');
  assert.equal(s.totalPlays, 19);
  assert.equal(s.totalSeconds, 100_000);
  // only one of the two series present → still the fallback (never mixed sources)
  assert.equal(aggregatePlexWeekly({ home: HOME, plays: PLAYS, duration: null }).totalsSource, 'users');
});

test('aggregate: garbage payloads degrade to an empty week, never throw', () => {
  const s = aggregatePlexWeekly({
    home: [{ stat_id: 'top_movies', rows: 'nope' as never }, { stat_id: 'top_users', rows: [{ total_plays: 'x' as never }] }],
    plays: { series: 'bad' as never },
    duration: {},
  });
  assert.equal(s.totalPlays, 0);
  assert.equal(s.movies.length, 0);
  assert.equal(s.users.length, 0);
  const capped = aggregatePlexWeekly({
    home: [{ stat_id: 'top_users', rows: Array.from({ length: 25 }, (_, i) => ({ user: `u${i}`, total_plays: 1 })) }],
  });
  assert.equal(capped.userCountCapped, true);
  assert.equal(capped.users.length, 5);
});

test('embed: one card with totals, three lists, stable footer; empty week has its own text', () => {
  const embed = buildPlexWeeklyEmbed(aggregatePlexWeekly(RAW), new Date(NOW), TZ).toJSON();
  assert.equal(embed.title, '📊  Plex-Wochenstatistik');
  assert.equal(embed.footer?.text, PLEX_WEEKLY_FOOTER);
  assert.match(embed.description ?? '', /19\.10\.2026 – 26\.10\.2026/);
  assert.match(embed.description ?? '', /\*\*10\*\* Plays/);
  assert.match(embed.description ?? '', /\*\*5 h\*\* Wiedergabe/);
  assert.deepEqual(embed.fields?.map((f) => f.name), ['🎬 Top Filme', '📺 Top Serien', '🏆 Aktivste Nutzer']);
  assert.match(embed.fields?.[0]?.value ?? '', /🥇 \*\*Heat\*\* \(1995\) — 5 Plays · 14 h 27 min/);
  const empty = buildPlexWeeklyEmbed(aggregatePlexWeekly({ home: [] }), new Date(NOW), TZ).toJSON();
  assert.match(empty.description ?? '', /Keine Wiedergaben/);
  assert.equal(empty.fields?.length ?? 0, 0);
  assert.equal(formatWatchTime(0), '0 h');
  assert.equal(formatWatchTime(90 * 60), '1 h 30 min');
  assert.equal(formatWatchTime(5 * 60), '5 min');
});

test('hash ignores the timestamp but changes with content; embed is routed to the digest channel', () => {
  const stats = aggregatePlexWeekly(RAW);
  const a = buildPlexWeeklyEmbed(stats, new Date(NOW), TZ);
  const b = buildPlexWeeklyEmbed(stats, new Date(NOW), TZ).setTimestamp(new Date(NOW + 1000));
  assert.equal(plexWeeklyHash(a), plexWeeklyHash(b));
  const changed = buildPlexWeeklyEmbed(aggregatePlexWeekly({ ...RAW, plays: null }), new Date(NOW), TZ);
  assert.notEqual(plexWeeklyHash(a), plexWeeklyHash(changed));
  assert.deepEqual(classifyBotEmbed({ footer: PLEX_WEEKLY_FOOTER }), ['weeklyDigest']);
});

// ─── cron ───────────────────────────────────────────────────────────────────

test('cron: next run is Monday 08:00 Berlin, across the DST switch and exactly on the boundary', () => {
  // Sat 24.10.2026 (CEST, UTC+2) → Mon 26.10.2026 08:00 CET (UTC+1) = 07:00Z
  assert.equal(nextWeeklyRun(new Date('2026-10-24T10:00:00Z'), TZ, 1, 8)?.toISOString(), '2026-10-26T07:00:00.000Z');
  // summer: Mon 06.07.2026 08:00 CEST = 06:00Z
  assert.equal(nextWeeklyRun(new Date('2026-07-01T00:00:00Z'), TZ, 1, 8)?.toISOString(), '2026-07-06T06:00:00.000Z');
  // strictly after: at the run instant the next one is a week later
  assert.equal(nextWeeklyRun(new Date('2026-07-06T06:00:00Z'), TZ, 1, 8)?.toISOString(), '2026-07-13T06:00:00.000Z');
  assert.equal(nextWeeklyRun(new Date('2026-07-06T05:59:00Z'), TZ, 1, 8)?.toISOString(), '2026-07-06T06:00:00.000Z');
  // configurable: Sunday 23:00
  assert.equal(nextWeeklyRun(new Date('2026-10-24T10:00:00Z'), TZ, 0, 23)?.toISOString(), '2026-10-25T22:00:00.000Z');
});

test('cron: schedule period key and due check run once per week', () => {
  const key = (iso: string) => weeklyPeriodKey(new Date(iso), TZ, 1, 8);
  assert.equal(key('2026-10-26T06:59:00Z'), null); // Mon 07:59 Berlin: before the slot
  assert.equal(key('2026-10-26T07:00:00Z'), '2026-10-26'); // Mon 08:00 Berlin
  assert.equal(key('2026-10-31T12:00:00Z'), '2026-10-26'); // Saturday of the same week
  assert.equal(key('2026-11-02T07:00:00Z'), '2026-11-02');
  assert.equal(duePlexWeeklyPeriod('2026-10-26', undefined), '2026-10-26');
  assert.equal(duePlexWeeklyPeriod('2026-10-26', '2026-10-19'), '2026-10-26');
  assert.equal(duePlexWeeklyPeriod('2026-10-26', '2026-10-26'), null);
  assert.equal(duePlexWeeklyPeriod(null, '2026-10-19'), null);
});

// ─── manager (fakes: in-memory store and a recording gateway, no Discord, no Tautulli) ───

function codeError(code: number): Error {
  return Object.assign(new Error(`discord ${code}`), { code });
}

function setup(raw: () => Promise<PlexWeeklyRaw | null> | PlexWeeklyRaw | null = () => RAW) {
  const rows = new Map<string, PlexWeeklyRecord>();
  const store: PlexWeeklyStore = {
    load: (c) => rows.get(c) ?? null,
    save: (r) => void rows.set(r.channelId, { ...r }),
  };
  const calls: string[] = [];
  let seq = 0;
  const fail: { post?: Error; edit?: Error } = {};
  const gateway: PlexCardGateway = {
    async post(channelId, _embed: EmbedBuilder) {
      if (fail.post) throw fail.post;
      calls.push(`post:${channelId}`);
      seq += 1;
      return `m${seq}`;
    },
    async edit(channelId, messageId) {
      if (fail.edit) throw fail.edit;
      calls.push(`edit:${channelId}:${messageId}`);
    },
  };
  let now = NOW;
  let fetches = 0;
  const logs: string[] = [];
  const manager = new PlexWeeklyManager({
    store,
    gateway,
    timeZone: TZ,
    now: () => now,
    fetchRaw: async () => {
      fetches += 1;
      return raw();
    },
    log: (_level, msg) => logs.push(msg),
  });
  return {
    manager, rows, calls, fail, logs,
    fetches: () => fetches,
    advance: (ms: number) => { now += ms; },
  };
}

test('manager: first run posts, same content is not edited, changed content edits the same message', async () => {
  let raw: PlexWeeklyRaw = RAW;
  const t = setup(() => raw);
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'posted');
  assert.equal(t.rows.get('c1')?.messageId, 'm1');
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'unchanged');
  assert.deepEqual(t.calls, ['post:c1']);

  raw = { ...RAW, plays: { series: [{ data: [50] }] }, duration: { series: [{ data: [7_200] }] } };
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'edited');
  assert.deepEqual(t.calls, ['post:c1', 'edit:c1:m1']);
  assert.equal(t.rows.get('c1')?.messageId, 'm1');
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'unchanged');
  assert.equal(t.calls.length, 2);
});

test('manager: a restart (new manager, same store) edits the stored message instead of posting', async () => {
  const t = setup();
  await t.manager.refresh('c1', { maxAgeMs: 0 });
  t.advance(2 * 24 * 3600_000); // different date label ⇒ different hash
  const second = new PlexWeeklyManager({
    store: { load: (c) => t.rows.get(c) ?? null, save: (r) => void t.rows.set(r.channelId, { ...r }) },
    gateway: { post: async () => 'new', edit: async (c, m) => void t.calls.push(`edit2:${c}:${m}`) },
    timeZone: TZ,
    now: () => NOW + 2 * 24 * 3600_000,
    fetchRaw: async () => RAW,
  });
  assert.equal(await second.refresh('c1', { maxAgeMs: 0 }), 'edited');
  assert.deepEqual(t.calls, ['post:c1', 'edit2:c1:m1']);
});

test('manager: deleted message (10008 / 50005) → repost once; other edit errors never repost', async () => {
  const t = setup();
  await t.manager.refresh('c1', { maxAgeMs: 0 });
  t.advance(24 * 3600_000);
  t.fail.edit = codeError(10_008);
  // the failing edit must not be treated as success; gateway.post still works
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'reposted');
  assert.equal(t.rows.get('c1')?.messageId, 'm2');
  assert.ok(t.logs.some((m) => /gone/.test(m)));

  t.advance(24 * 3600_000);
  t.fail.edit = codeError(50_005);
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'reposted');
  assert.equal(t.rows.get('c1')?.messageId, 'm3');

  t.advance(24 * 3600_000);
  t.fail.edit = codeError(50_013); // missing permissions: not "gone"
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'error');
  t.fail.edit = new Error('network');
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'error');
  assert.deepEqual(t.calls, ['post:c1', 'post:c1', 'post:c1']);
  assert.equal(t.rows.get('c1')?.messageId, 'm3'); // untouched
});

test('manager: Tautulli down / throwing → quiet error, nothing posted or changed', async () => {
  let mode: 'null' | 'throw' | 'ok' = 'null';
  const t = setup(() => {
    if (mode === 'throw') throw new Error('ECONNREFUSED');
    return mode === 'null' ? null : RAW;
  });
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'error');
  mode = 'throw';
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'error');
  assert.equal(t.calls.length, 0);
  assert.equal(t.rows.size, 0);
  mode = 'ok';
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'posted');
});

test('manager: post failure is an error and is retried (no message id stored)', async () => {
  const t = setup();
  t.fail.post = new Error('403');
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'error');
  assert.equal(t.rows.size, 0);
  t.fail.post = undefined;
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'posted');
});

test('manager: cache protects Tautulli, serialised calls never double-post, new channel gets its own card', async () => {
  const t = setup();
  const [a, b, c] = await Promise.all([
    t.manager.refresh('c1'),
    t.manager.refresh('c1'),
    t.manager.refresh('c1'),
  ]);
  assert.deepEqual([a, b, c], ['posted', 'unchanged', 'unchanged']);
  assert.equal(t.fetches(), 1); // 10 min default cache
  assert.deepEqual(t.calls, ['post:c1']);
  t.advance(11 * 60_000);
  await t.manager.refresh('c1');
  assert.equal(t.fetches(), 2);
  await t.manager.refresh('c1', { maxAgeMs: 0 });
  assert.equal(t.fetches(), 3);

  assert.equal(await t.manager.refresh('c2'), 'posted'); // channel changed: old message is left alone
  assert.deepEqual(t.calls.filter((x) => x.startsWith('post')), ['post:c1', 'post:c2']);
  assert.equal(t.rows.get('c1')?.messageId, 'm1');
});
