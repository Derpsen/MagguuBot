import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Config/DB are pulled in by the command modules; throwaway env, no network (Tautulli/*arr are faked below).
const dir = mkdtempSync(join(tmpdir(), 'magguu-neu-'));
process.env.DISCORD_TOKEN ??= 'test-token-not-used';
process.env.DISCORD_CLIENT_ID ??= '1498095100000000001';
process.env.DISCORD_GUILD_ID ??= '1400000000000000099';
process.env.WEBHOOK_SECRET ??= 'test-secret-0123456789abcdef';
process.env.DATABASE_PATH = join(dir, 'bot.db');
process.env.TAUTULLI_URL = 'http://tautulli.invalid:8181';
process.env.TAUTULLI_API_KEY = 'SECRET-TAUTULLI-KEY';

const utils = await import('../src/utils/plex-new.ts');
const {
  prepareNeuItems, neuPage, buildNeuEmbed, buildNeuComponents, encodeNeuId, decodeNeuId, safePosterUrl,
  clampNeuDays, NEU_PAGE_SIZE, NEU_ERROR_TEXT, NEU_FETCH_COUNT,
} = utils;
const { PlexNewService, renderNeu, neuCooldownLeft, resetNeuCooldown, buildPosterMap, neuButtonCooldownLeft } = await import('../src/discord/plex-new.ts');
const { getRecentlyAdded } = await import('../src/services/tautulli.ts');
const { handleNeuButton } = await import('../src/discord/interactions/neu-buttons.ts');
const { commands } = await import('../src/discord/commands/index.ts');
type Raw = import('../src/services/tautulli.ts').TautulliRecentRaw;

// Fixtures follow the Tautulli v2 shape of get_recently_added; hand-written, not recorded from a live server.
const NOW = Date.UTC(2026, 9, 24, 10, 0, 0);
const sec = (daysAgo: number, extraSeconds = 0): number => Math.floor(NOW / 1000) - daysAgo * 86_400 - extraSeconds;
// Plex thumb paths + a token are present on purpose: the feature must never surface them.
const THUMB = '/library/metadata/1/thumb/2?X-Plex-Token=PLEXSECRET';

const MOVIES: Raw[] = [
  { media_type: 'movie', title: 'Dune', year: 2021, added_at: sec(1), rating_key: 1, thumb: THUMB } as Raw,
  { media_type: 'movie', title: 'Heat _1995_', year: '1995', added_at: String(sec(3)), rating_key: 2 },
  { media_type: 'movie', title: 'Alt', year: 1999, added_at: sec(20), rating_key: 3 },
  { media_type: 'movie', title: 'Kaputt', year: 2000, added_at: 'x', rating_key: 4 },
];
const SHOWS: Raw[] = [
  { media_type: 'season', title: 'Season 2', grandparent_title: 'Severance', parent_title: 'Season 2', media_index: 2, added_at: sec(2) },
  { media_type: 'episode', title: 'Pilot', grandparent_title: 'Andor', parent_media_index: 1, media_index: 5, added_at: sec(1, 60) },
  { media_type: 'episode', title: 'Two', grandparent_title: 'Andor', parent_media_index: 1, media_index: 6, added_at: sec(1, 30) },
  { media_type: 'episode', title: 'Solo', grandparent_title: 'Fargo', parent_media_index: 3, media_index: 4, added_at: sec(4) },
  { media_type: 'show', title: 'Shōgun', year: 2024, added_at: sec(5) },
  { media_type: 'episode', title: 'Old', grandparent_title: 'Lost', parent_media_index: 1, media_index: 1, added_at: sec(25) },
  { media_type: 'track', title: 'Song', added_at: sec(1) },
];

test('prepareNeuItems: aggregates, filters window and type, newest first', () => {
  const all = prepareNeuItems([...MOVIES, ...SHOWS], { now: NOW, days: 7, type: 'all' });
  assert.deepEqual(all.map((i) => i.title), ['Dune', 'Andor', 'Severance', 'Heat _1995_', 'Fargo', 'Shōgun']);
  const byTitle = Object.fromEntries(all.map((i) => [i.title, i]));
  assert.equal(byTitle['Dune']!.year, '2021');
  assert.equal(byTitle['Andor']!.detail, 'S01 · 2 Folgen');
  assert.equal(byTitle['Severance']!.detail, 'Staffel 2');
  assert.equal(byTitle['Fargo']!.detail, 'S03E04');
  assert.equal(byTitle['Shōgun']!.year, '2024');
  assert.equal(all.some((i) => i.title === 'Alt' || i.title === 'Kaputt' || i.title === 'Song' || i.title === 'Lost'), false);

  assert.deepEqual(prepareNeuItems([...MOVIES, ...SHOWS], { now: NOW, days: 7, type: 'movies' }).map((i) => i.kind), ['movie', 'movie']);
  assert.equal(prepareNeuItems([...MOVIES, ...SHOWS], { now: NOW, days: 7, type: 'shows' }).every((i) => i.kind === 'show'), true);
  assert.equal(prepareNeuItems([...MOVIES, ...SHOWS], { now: NOW, days: 30, type: 'all' }).length, 8);
  assert.equal(prepareNeuItems([...MOVIES, ...SHOWS], { now: NOW, days: 1, type: 'all' }).length, 1); // exactly-1-day-old entries are inside, +60 s older ones are not
});

test('clampNeuDays keeps 1..30 and defaults to 7', () => {
  assert.equal(clampNeuDays(null), 7);
  assert.equal(clampNeuDays(0), 1);
  assert.equal(clampNeuDays(99), 30);
  assert.equal(clampNeuDays(12.9), 12);
  assert.equal(clampNeuDays(Number.NaN), 7);
});

test('pagination: slices, clamps pages, buttons reflect position', () => {
  const items = Array.from({ length: 19 }, (_, i) => i);
  assert.equal(neuPage(items, 0).pages, Math.ceil(19 / NEU_PAGE_SIZE));
  assert.deepEqual(neuPage(items, 2).items, [16, 17, 18]);
  assert.equal(neuPage(items, 99).page, 2);
  assert.equal(neuPage(items, -4).page, 0);
  assert.equal(neuPage([], 0).pages, 1);

  const view = { page: 0, days: 7, type: 'all' as const, userId: '123456789012345678' };
  assert.deepEqual(buildNeuComponents(view, 1), []);
  const first = buildNeuComponents(view, 3)[0]!.toJSON().components as Array<{ disabled?: boolean; custom_id: string }>;
  assert.equal(first[0]!.disabled, true);
  assert.equal(first[2]!.disabled, false);
  assert.equal(first[2]!.custom_id, 'neu:1:7:a:123456789012345678');
  const last = buildNeuComponents({ ...view, page: 2 }, 3)[0]!.toJSON().components as Array<{ disabled?: boolean }>;
  assert.equal(last[0]!.disabled, false);
  assert.equal(last[2]!.disabled, true);
});

test('customId round-trips and rejects garbage', () => {
  const view = { page: 3, days: 14, type: 'shows' as const, userId: '123456789012345678' };
  assert.deepEqual(decodeNeuId(encodeNeuId(view)), view);
  for (const bad of ['neu:1:7:x:123456789012345678', 'neu:1:0:a:123456789012345678', 'neu:1:31:a:123456789012345678', 'neu:a:7:a:1', 'neu:1:7:a:12', 'seerr:1']) {
    assert.equal(decodeNeuId(bad), null, bad);
  }
  assert.ok(encodeNeuId(view).length <= 100);
});

test('embed: lines, escaping, empty state, truncated note, footer', () => {
  const items = prepareNeuItems([...MOVIES, ...SHOWS], { now: NOW, days: 7, type: 'all' });
  const { embed, pages } = buildNeuEmbed({ items, page: 0, days: 7, type: 'all' });
  assert.equal(pages, 1);
  const json = embed.toJSON();
  assert.match(json.description ?? '', /🎬 \*\*Dune\*\* \(2021\) · <t:\d+:R>/);
  assert.match(json.description ?? '', /📺 \*\*Andor\*\* · S01 · 2 Folgen/);
  assert.match(json.description ?? '', /Heat \\_1995\\_/);
  assert.match(json.footer?.text ?? '', /Seite 1\/1\s+·\s+6 Titel/);
  assert.equal(json.thumbnail, undefined);
  assert.ok((json.description ?? '').length < 4096);

  const empty = buildNeuEmbed({ items: [], page: 0, days: 1, type: 'movies' }).embed.toJSON();
  assert.match(empty.description ?? '', /Keine neuen Filme in den letzten 1 Tag\./);
  assert.match(buildNeuEmbed({ items, page: 0, days: 7, type: 'all', truncated: true }).embed.toJSON().description ?? '', /ältere Einträge können fehlen/);
});

test('poster guard: only token-free public artwork hosts', () => {
  assert.equal(safePosterUrl('https://image.tmdb.org/t/p/w500/abc.jpg'), 'https://image.tmdb.org/t/p/w500/abc.jpg');
  assert.equal(safePosterUrl('https://artworks.thetvdb.com/banners/posters/1-1.jpg'), 'https://artworks.thetvdb.com/banners/posters/1-1.jpg');
  for (const bad of [
    'http://image.tmdb.org/t/p/w500/abc.jpg',
    'https://image.tmdb.org/a.jpg?X-Plex-Token=PLEXSECRET',
    'https://plex.example:32400/photo/:/transcode?url=/library/x&X-Plex-Token=PLEXSECRET',
    'http://tautulli.invalid:8181/pms_image_proxy?img=/library/metadata/1/thumb&apikey=K',
    'https://user:pw@image.tmdb.org/a.jpg',
    '/MediaCover/1/poster.jpg',
    'https://evil.example/a.jpg',
    '',
  ]) assert.equal(safePosterUrl(bad), null, bad);
  const embed = buildNeuEmbed({ items: [], page: 0, days: 7, type: 'all', posterUrl: 'https://plex.example/p?X-Plex-Token=PLEXSECRET' }).embed.toJSON();
  assert.equal(embed.thumbnail, undefined);
  const ok = buildNeuEmbed({ items: [], page: 0, days: 7, type: 'all', posterUrl: 'https://image.tmdb.org/t/p/w500/abc.jpg' }).embed.toJSON();
  assert.equal(ok.thumbnail?.url, 'https://image.tmdb.org/t/p/w500/abc.jpg');
});

function makeService(overrides: Partial<ConstructorParameters<typeof PlexNewService>[0]> = {}) {
  const clock = { t: NOW };
  const calls: string[] = [];
  const svc = new PlexNewService({
    configured: () => true,
    fetchRecent: async (mediaType) => {
      calls.push(mediaType);
      return mediaType === 'movie' ? MOVIES : SHOWS;
    },
    now: () => clock.t,
    ...overrides,
  });
  return { svc, clock, calls };
}

test('service: 5 min cache, dedupes parallel calls, only fetches the needed type', async () => {
  const { svc, clock, calls } = makeService();
  const [a, b] = await Promise.all([svc.get('all', 7), svc.get('all', 30)]);
  assert.equal(a.ok && a.items.length, 6);
  assert.equal(b.ok && b.items.length, 8);
  assert.deepEqual(calls.sort(), ['movie', 'show']);
  await svc.get('movies', 7);
  assert.equal(calls.length, 2, 'served from cache');
  clock.t += 5 * 60_000 + 1;
  await svc.get('movies', 7);
  assert.deepEqual(calls.slice(2), ['movie'], 'expired entry refetched, shows untouched');
});

test('service: errors are quiet results, not cached, stale data survives', async () => {
  let fail = true;
  const { svc, clock, calls } = makeService({
    fetchRecent: async () => {
      if (fail) return null;
      return MOVIES;
    },
  });
  assert.deepEqual(await svc.get('movies', 7), { ok: false, reason: 'unavailable' });
  assert.deepEqual(await svc.get('movies', 7), { ok: false, reason: 'unavailable' });
  fail = false;
  clock.t += 46_000; // negative cache (45 s) is over: the next request retries and succeeds
  assert.equal((await svc.get('movies', 7)).ok, true);
  clock.t += 6 * 60_000;
  fail = true;
  const stale = await svc.get('movies', 7);
  assert.equal(stale.ok, true, 'stale success is used when refresh fails');
  void calls;

  const thrower = makeService({ fetchRecent: async () => { throw new Error('boom'); } });
  assert.deepEqual(await thrower.svc.get('shows', 7), { ok: false, reason: 'unavailable' });
  assert.deepEqual(await makeService({ configured: () => false }).svc.get('all', 7), { ok: false, reason: 'not-configured' });
});

test('service: truncated flag when Tautulli hit the fetch cap', async () => {
  const many: Raw[] = Array.from({ length: NEU_FETCH_COUNT }, (_, i) => ({ media_type: 'movie', title: `M${i}`, year: 2020, added_at: sec(1, i) }));
  const { svc } = makeService({ fetchRecent: async () => many });
  const res = await svc.get('movies', 7);
  assert.equal(res.ok && res.truncated, true);
  assert.equal(res.ok && res.items.length, NEU_FETCH_COUNT);
});

test('poster lookup: matches Radarr/Sonarr artwork, drops unsafe urls, failures are silent', async () => {
  const movies = buildPosterMap([
    { title: 'Dune', year: 2021, images: [{ coverType: 'poster', remoteUrl: 'https://image.tmdb.org/t/p/w500/dune.jpg' }] },
    { title: 'Heat', year: 1995, images: [{ coverType: 'poster', remoteUrl: 'https://image.tmdb.org/t/p/w500/heat.jpg?api_key=K' }] },
  ]);
  const shows = buildPosterMap([{ title: 'Andor', year: 2022, images: [{ coverType: 'poster', remoteUrl: 'https://artworks.thetvdb.com/banners/andor.jpg' }] }]);
  const { svc } = makeService({ loadPosterIndex: async () => ({ movies, shows }) });
  const items = prepareNeuItems([...MOVIES, ...SHOWS], { now: NOW, days: 7, type: 'all' });
  assert.equal(await svc.posterFor(items.find((i) => i.title === 'Dune')), 'https://image.tmdb.org/t/p/w500/dune.jpg');
  assert.equal(await svc.posterFor(items.find((i) => i.title === 'Andor')), 'https://artworks.thetvdb.com/banners/andor.jpg');
  assert.equal(await svc.posterFor(items.find((i) => i.title.startsWith('Heat'))), null);
  assert.equal(await svc.posterFor(undefined), null);
  const broken = makeService({ loadPosterIndex: async () => { throw new Error('radarr down'); } });
  assert.equal(await broken.svc.posterFor(items[0]), null);
  assert.equal(await makeService().svc.posterFor(items[0]), null);
});

test('renderNeu: page embed + buttons; friendly errors; no token leak anywhere', async () => {
  const bulk: Raw[] = Array.from({ length: 12 }, (_, i) => ({ media_type: 'movie', title: `Bulk ${i}`, year: 2020, added_at: sec(2, i) }));
  const { svc } = makeService({
    fetchRecent: async (m) => (m === 'movie' ? [...MOVIES, ...bulk] : SHOWS),
    loadPosterIndex: async () => ({
      movies: buildPosterMap([{ title: 'Dune', year: 2021, images: [{ coverType: 'poster', remoteUrl: 'https://image.tmdb.org/t/p/w500/dune.jpg' }] }]),
      shows: new Map(),
    }),
  });
  const view = { page: 0, days: 7, type: 'all' as const, userId: '123456789012345678' };
  const r = await renderNeu(svc, view);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.pages, 3);
  const dump = JSON.stringify([r.embeds.map((e) => e.toJSON()), r.components.map((c) => c.toJSON())]);
  for (const secret of ['PLEXSECRET', 'X-Plex-Token', 'SECRET-TAUTULLI-KEY', 'apikey', '/library/metadata']) assert.equal(dump.includes(secret), false, secret);
  assert.match(dump, /image\.tmdb\.org/);
  const p2 = await renderNeu(svc, { ...view, page: 1 });
  assert.ok(p2.ok && p2.page === 1);

  const down = await renderNeu(makeService({ fetchRecent: async () => null }).svc, view);
  assert.deepEqual(down, { ok: false, content: NEU_ERROR_TEXT });
  const off = await renderNeu(makeService({ configured: () => false }).svc, view);
  assert.equal(off.ok, false);
  assert.equal(JSON.stringify(off).includes('SECRET'), false);
});

test('getRecentlyAdded (faked fetch): parses data, quiet null on failure, apikey only in the request', async () => {
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  try {
    globalThis.fetch = (async (url: string | URL | Request) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ response: { result: 'success', data: { recently_added: MOVIES } } }), { status: 200 });
    }) as typeof fetch;
    const list = await getRecentlyAdded('movie', 150);
    assert.equal(list?.length, MOVIES.length);
    assert.match(seen[0]!, /cmd=get_recently_added/);
    assert.match(seen[0]!, /media_type=movie/);
    assert.match(seen[0]!, /count=150/);

    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    assert.equal(await getRecentlyAdded('show', 10), null);
    globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
    assert.equal(await getRecentlyAdded('show', 10), null);
    globalThis.fetch = (async () => new Response(JSON.stringify({ response: { result: 'success', data: {} } }), { status: 200 })) as typeof fetch;
    assert.equal(await getRecentlyAdded('show', 10), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('cooldown: blocks quick repeats per user only', () => {
  resetNeuCooldown();
  assert.equal(neuCooldownLeft('u1', 1000), 0);
  assert.equal(neuCooldownLeft('u1', 3000), 3000);
  assert.equal(neuCooldownLeft('u2', 3000), 0);
  assert.equal(neuCooldownLeft('u1', 6001), 0);
  resetNeuCooldown();
});

interface FakeButton {
  customId: string;
  user: { id: string };
  replies: Array<Record<string, unknown>>;
  edits: Array<Record<string, unknown>>;
  deferred: boolean;
  reply(o: Record<string, unknown>): Promise<void>;
  deferUpdate(): Promise<void>;
  editReply(o: Record<string, unknown>): Promise<void>;
}
function fakeButton(customId: string, userId: string): FakeButton {
  const b: FakeButton = {
    customId, user: { id: userId }, replies: [], edits: [], deferred: false,
    async reply(o) { b.replies.push(o); },
    async deferUpdate() { b.deferred = true; },
    async editReply(o) { b.edits.push(o); },
  };
  return b;
}

test('button handler (fake interaction): owner only, unknown ids rejected', async () => {
  const owner = '123456789012345678';
  const foreign = fakeButton(`neu:1:7:a:${owner}`, '999999999999999999');
  await handleNeuButton(foreign as never);
  assert.equal(foreign.deferred, false);
  assert.match(String(foreign.replies[0]!.content), /nicht deine Ansicht/);

  const bad = fakeButton('neu:zzz', owner);
  await handleNeuButton(bad as never);
  assert.match(String(bad.replies[0]!.content), /nicht mehr unterstützt/);

  // The real singleton talks to the (unreachable, .invalid) Tautulli host: friendly text, no secrets, no throw.
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => { throw new Error('getaddrinfo ENOTFOUND tautulli.invalid'); }) as typeof fetch;
    const mine = fakeButton(`neu:1:7:a:${owner}`, owner);
    await handleNeuButton(mine as never);
    assert.equal(mine.deferred, true);
    assert.equal(mine.edits[0]!.content, NEU_ERROR_TEXT);
    assert.equal(JSON.stringify(mine.edits).includes('SECRET'), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('command registration: /neu is an unrestricted downloads command with bounded options', () => {
  const cmd = commands.get('neu');
  assert.ok(cmd);
  assert.equal(cmd.category, 'downloads');
  const json = cmd.data.toJSON() as { default_member_permissions?: string | null; options?: Array<{ name: string; min_value?: number; max_value?: number; choices?: Array<{ value: string }> }> };
  assert.equal(json.default_member_permissions ?? null, null);
  const days = json.options!.find((o) => o.name === 'tage')!;
  assert.deepEqual([days.min_value, days.max_value], [1, 30]);
  assert.deepEqual(json.options!.find((o) => o.name === 'typ')!.choices!.map((c) => c.value), ['movies', 'shows', 'all']);
});

test('negative cache: a Tautulli outage costs one request per 45 s, not one per click; recovery and stale data work', async () => {
  let mode: 'fail' | 'null' | 'ok' = 'fail';
  const { svc, clock, calls } = makeService({
    fetchRecent: async (mediaType) => {
      calls.push(`fetch:${mediaType}`);
      if (mode === 'fail') throw new Error('connect ECONNREFUSED');
      if (mode === 'null') return null;
      return MOVIES;
    },
  });
  for (let i = 0; i < 20; i += 1) {
    assert.deepEqual(await svc.get('movies', 7), { ok: false, reason: 'unavailable' });
    clock.t += 1_000;
  }
  assert.equal(calls.filter((c) => c === 'fetch:movie').length, 1, '20 clicks within 20 s = a single upstream request');
  clock.t += 30_000; // 50 s since the failure
  assert.deepEqual(await svc.get('movies', 7), { ok: false, reason: 'unavailable' });
  assert.equal(calls.filter((c) => c === 'fetch:movie').length, 2, 'retry after the negative TTL');
  mode = 'ok';
  clock.t += 46_000;
  assert.equal((await svc.get('movies', 7)).ok, true);
  assert.equal(calls.filter((c) => c === 'fetch:movie').length, 3);
  // stale success + outage: stale data is served and the outage is also negative-cached
  clock.t += 6 * 60_000;
  mode = 'null';
  for (let i = 0; i < 5; i += 1) assert.equal((await svc.get('movies', 7)).ok, true);
  assert.equal(calls.filter((c) => c === 'fetch:movie').length, 4, 'one refresh attempt, then stale data without upstream calls');
});

test('button cooldown: rapid clicks of one user are ignored (page kept), other users unaffected', async () => {
  resetNeuCooldown();
  const owner = '223456789012345678';
  let fetches = 0;
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => { fetches += 1; throw new Error('ENOTFOUND tautulli.invalid'); }) as typeof fetch;
    const first = fakeButton(`neu:1:7:a:${owner}`, owner);
    await handleNeuButton(first as never);
    const second = fakeButton(`neu:1:7:a:${owner}`, owner);
    await handleNeuButton(second as never);
    assert.equal(first.edits.length, 1);
    assert.equal(second.deferred, true, 'acknowledged so Discord shows no error');
    assert.equal(second.edits.length, 0, 'but no new render');
    assert.ok(fetches <= 2, `at most one fetch per media type, got ${fetches}`);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(neuButtonCooldownLeft('someone-else', 10_000) === 0);
  assert.ok(neuButtonCooldownLeft('someone-else', 10_500) > 0);
  assert.equal(neuButtonCooldownLeft('someone-else', 12_000), 0);
});

test('/neu command honours the per-user cooldown (fake interaction)', async () => {
  resetNeuCooldown();
  const cmd = commands.get('neu')!;
  const make = (userId: string) => {
    const r = { replies: [] as Array<{ content?: unknown }>, deferred: false, edits: [] as Array<{ content?: unknown }> };
    const interaction = {
      user: { id: userId },
      options: { getInteger: () => null, getString: () => null },
      reply: async (o: { content?: unknown }) => { r.replies.push(o); },
      deferReply: async () => { r.deferred = true; },
      editReply: async (o: { content?: unknown }) => { r.edits.push(o); },
    };
    return { r, interaction };
  };
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => { throw new Error('ENOTFOUND tautulli.invalid'); }) as typeof fetch;
    const a = make('323456789012345678');
    await cmd.execute(a.interaction as never);
    assert.equal(a.r.deferred, true);
    const again = make('323456789012345678');
    await cmd.execute(again.interaction as never);
    assert.equal(again.r.deferred, false);
    assert.match(String(again.r.replies[0]!.content), /Bitte warte \d+ s/);
    const other = make('423456789012345678');
    await cmd.execute(other.interaction as never);
    assert.equal(other.r.deferred, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});
