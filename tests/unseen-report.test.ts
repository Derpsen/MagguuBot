import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'unseen-report-'));
after(() => rmSync(dir, { recursive: true, force: true }));
Object.assign(process.env, {
  DATABASE_PATH: join(dir, 'bot.db'),
  DISCORD_TOKEN: 'test-token-not-used',
  DISCORD_CLIENT_ID: '1498095100000000001',
  DISCORD_GUILD_ID: '1400000000000000099',
  WEBHOOK_SECRET: 'test-secret-0123456789abcdef',
  STATUS_API_TOKEN: 'status-token-0123456789abcdef',
  TAUTULLI_URL: 'http://tautulli.invalid:8181',
  TAUTULLI_API_KEY: 'tautulli-secret-key-should-never-leak',
});

const pure = await import('../src/utils/unseen-report.ts');
const svc = await import('../src/services/unseen-report.ts');
const { config } = await import('../src/config.ts');
const { sqliteHandle } = await import('../src/db/client.ts');
const { buildStatusSnapshot } = await import('../src/embeds/status.ts');

const DAY = 86_400;
const NOW = Date.parse('2026-10-25T10:00:00Z');
const nowS = NOW / 1000;
const O = { library: 'Filme', type: 'movie' as const, now: NOW, minAgeDays: 90, staleDays: 365 };

const row = (over: Record<string, unknown> = {}) => ({
  title: 'Big Movie', year: '2019', file_size: 50_000_000_000, added_at: String(nowS - 400 * DAY), last_played: '', play_count: '', media_type: 'movie', ...over,
});

beforeEach(() => {
  svc.resetUnseenReportCache();
  sqliteHandle.exec('DELETE FROM bot_settings');
  (config as Record<string, unknown>).PLEX_UNSEEN_REPORT_ENABLED = true;
});

// ─── pure classification ───

test('classifyRow: never played + old enough = unseen with null lastPlayedAt; size and year kept', () => {
  const it = pure.classifyRow(row(), O)!;
  assert.equal(it.title, 'Big Movie (2019)');
  assert.equal(it.sizeBytes, 50_000_000_000);
  assert.equal(it.lastPlayedAt, null);
  assert.equal(it.library, 'Filme');
  assert.ok(it.addedAt);
  assert.deepEqual(Object.keys(it).sort(), ['addedAt', 'lastPlayedAt', 'library', 'sizeBytes', 'title', 'type']);
});

test('classifyRow: recently added, recently played, no size, no title and unknown add date are all left out', () => {
  assert.equal(pure.classifyRow(row({ added_at: String(nowS - 10 * DAY) }), O), null, 'new addition is not unseen yet');
  assert.equal(pure.classifyRow(row({ last_played: String(nowS - 30 * DAY) }), O), null, 'played recently');
  assert.equal(pure.classifyRow(row({ file_size: '' }), O), null);
  assert.equal(pure.classifyRow(row({ file_size: 0 }), O), null);
  assert.equal(pure.classifyRow(row({ title: '  ' }), O), null);
  assert.equal(pure.classifyRow(row({ added_at: '' }), O), null, 'cannot prove it is old');
  assert.equal(pure.classifyRow(row({ added_at: 'abc' }), O), null);
});

test('classifyRow: long-unwatched counts with its last play date; numeric strings and numbers both work', () => {
  const it = pure.classifyRow(row({ last_played: nowS - 500 * DAY, file_size: '123456', added_at: nowS - 900 * DAY }), O)!;
  assert.equal(it.lastPlayedAt, new Date((nowS - 500 * DAY) * 1000).toISOString());
  assert.equal(it.sizeBytes, 123456);
});

test('cleanTitle: control/bidi/zero-width stripped, clipped, year not duplicated', () => {
  assert.equal(pure.cleanTitle('A\u202eB\u200bC\n\td', 60), 'A B C d');
  assert.equal(pure.cleanTitle('x'.repeat(100), 60).length, 60);
  assert.match(pure.cleanTitle('x'.repeat(100), 60), /…$/);
  assert.equal(pure.cleanTitle(42, 60), '');
  assert.equal(pure.classifyRow(row({ title: 'Heat (1995)', year: 1995 }), O)!.title, 'Heat (1995)');
});

test('selectTop: biggest first, stable ties, capped', () => {
  const mk = (title: string, sizeBytes: number) => ({ title, library: 'L', type: 'movie' as const, sizeBytes, lastPlayedAt: null, addedAt: null });
  const top = pure.selectTop([mk('b', 5), mk('a', 5), mk('c', 9), mk('d', 1)], 3);
  assert.deepEqual(top.map((i) => i.title), ['c', 'a', 'b']);
  assert.equal(pure.selectTop(Array.from({ length: 40 }, (_, i) => mk(`t${i}`, i))).length, 25);
});

test('parseStoredReport rejects garbage and keeps a valid block; reportIsFresh needs age < 24h and same settings', () => {
  assert.equal(pure.parseStoredReport(null), null);
  assert.equal(pure.parseStoredReport('{not json'), null);
  assert.equal(pure.parseStoredReport('{"generatedAt":"x","items":[]}'), null);
  assert.equal(pure.parseStoredReport(JSON.stringify({ generatedAt: '2026-10-25T00:00:00Z', items: [{ title: 1 }] })), null);
  const block = { generatedAt: new Date(NOW - 3_600_000).toISOString(), topN: 25, minAgeDays: 90, staleDays: 365, partial: false, libraries: 1, items: [] };
  const parsed = pure.parseStoredReport(JSON.stringify(block))!;
  assert.equal(parsed.minAgeDays, 90);
  assert.equal(pure.reportIsFresh(parsed, NOW, 90, 365), true);
  assert.equal(pure.reportIsFresh(parsed, NOW, 60, 365), false, 'other settings -> recompute');
  assert.equal(pure.reportIsFresh(parsed, NOW + 25 * 3_600_000, 90, 365), false, 'older than 24h');
  assert.equal(pure.reportIsFresh(null, NOW, 90, 365), false);
});

// ─── scan ───

function deps(over: Partial<import('../src/services/unseen-report.ts').UnseenReportDeps> & { pages?: Record<string, Array<Record<string, unknown>>> } = {}) {
  const calls: Array<{ section: string; type: string; start: number; length: number }> = [];
  const pages = over.pages ?? {};
  const d = {
    getLibraries: async () => [
      { section_id: '1', section_name: 'Filme', section_type: 'movie' },
      { section_id: '2', section_name: 'Serien', section_type: 'show' },
      { section_id: '3', section_name: 'Musik', section_type: 'artist' },
      { section_id: '4', section_name: 'Fotos', section_type: 'photo' },
    ],
    getPage: async (section: string, type: 'movie' | 'show', start: number, length: number) => {
      calls.push({ section, type, start, length });
      const all = pages[section] ?? [];
      return { recordsTotal: all.length, data: all.slice(start, start + length) };
    },
    now: () => NOW,
    sleep: async () => {},
    minAgeDays: 90,
    staleDays: 365,
    ...over,
  };
  delete (d as Record<string, unknown>).pages;
  return { d: d as import('../src/services/unseen-report.ts').UnseenReportDeps, calls };
}

test('computeUnseenReport: movie+show libraries only, merged by size, per-library early stop, read-only parameters', async () => {
  const { d, calls } = deps({
    pages: {
      '1': [row({ title: 'M1', file_size: 90 }), row({ title: 'M2 seen', file_size: 80, last_played: String(nowS - DAY) }), row({ title: 'M3', file_size: 10 })],
      '2': [row({ title: 'S1', file_size: 100, media_type: 'show' }), row({ title: 'S2', file_size: 5 })],
    },
    topN: 3,
  });
  const r = (await svc.computeUnseenReport(d))!;
  assert.deepEqual(r.items.map((i) => i.title), ['S1 (2019)', 'M1 (2019)', 'M3 (2019)']);
  assert.equal(r.libraries, 2);
  assert.equal(r.partial, false);
  assert.deepEqual([...new Set(calls.map((c) => c.section))].sort(), ['1', '2'], 'music/photo libraries are never queried');
  assert.ok(calls.every((c) => c.length === svc.UNSEEN_PAGE_SIZE));
});

test('computeUnseenReport: pages through a library until N found, and stops early when the top N is full', async () => {
  const many = Array.from({ length: 450 }, (_, i) => row({ title: `m${i}`, file_size: 1000 - i, last_played: String(nowS - DAY) }));
  many[420] = row({ title: 'late-unseen', file_size: 580 }); // only qualifying row, on page 3
  const p = deps({ pages: { '1': many }, topN: 25 });
  const r = (await svc.computeUnseenReport(p.d))!;
  assert.deepEqual(r.items.map((i) => i.title), ['late-unseen (2019)']);
  assert.deepEqual(p.calls.filter((c) => c.section === '1').map((c) => c.start), [0, 200, 400]);

  const unseen = Array.from({ length: 450 }, (_, i) => row({ title: `u${i}`, file_size: 1000 - i }));
  const q = deps({ pages: { '1': unseen }, topN: 25 });
  const r2 = (await svc.computeUnseenReport(q.d))!;
  assert.equal(r2.items.length, 25);
  assert.equal(q.calls.filter((c) => c.section === '1').length, 1, 'first page already had 25 -> no more calls');
});

test('computeUnseenReport: the page limit bounds the load and marks the report partial', async () => {
  const seen = Array.from({ length: svc.UNSEEN_PAGE_SIZE * (svc.UNSEEN_MAX_PAGES + 2) }, (_, i) => row({ title: `s${i}`, file_size: 99999 - i, last_played: String(nowS - DAY) }));
  const p = deps({ pages: { '1': seen } });
  const r = (await svc.computeUnseenReport(p.d))!;
  assert.equal(r.partial, true);
  assert.equal(p.calls.filter((c) => c.section === '1').length, svc.UNSEEN_MAX_PAGES);
});

test('computeUnseenReport: Tautulli failure (libraries or a page) = null, nothing half-reported; empty libs = empty report', async () => {
  assert.equal(await svc.computeUnseenReport(deps({ getLibraries: async () => null }).d), null);
  assert.equal(await svc.computeUnseenReport(deps({ getPage: async () => null }).d), null);
  const empty = (await svc.computeUnseenReport(deps({ getLibraries: async () => [] }).d))!;
  assert.deepEqual(empty.items, []);
});

test('the Tautulli service never asks for a refresh and has no write command (static check of the request builder)', () => {
  const src = readFileSync(new URL('../src/services/tautulli.ts', import.meta.url), 'utf8');
  const part = src.slice(src.indexOf('export async function getLibraryMediaInfoPage'));
  assert.doesNotMatch(part, /refresh/);
  const mod = readFileSync(new URL('../src/services/unseen-report.ts', import.meta.url), 'utf8');
  const code = mod.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\.delete\(|DELETE|unlink|rm\(|delete_|refresh|method:\s*'(POST|PUT|DELETE)'/);
  const cmds = [...src.matchAll(/\(\s*'([a-z_]+)'\s*[,)]/g)].map((m) => m[1]!).filter((c) => c.includes('_'));
  assert.ok(cmds.includes('get_libraries') && cmds.includes('get_library_media_info'), `check is vacuous: ${cmds.join(',')}`);
  assert.ok(cmds.every((c) => c.startsWith('get_') || c === 'terminate_session'), `unexpected Tautulli commands: ${cmds.join(',')}`);
});

// ─── tick / cache ───

test('tick: computes, persists, then serves from cache; a fresh cache means no Tautulli call at all (also after a "restart")', async () => {
  const p = deps({ pages: { '1': [row({ title: 'Only', file_size: 7 })] } });
  assert.equal(svc.currentUnseenReport(), null, 'nothing yet');
  assert.equal(await svc.runUnseenReportTick(p.d), 'updated');
  assert.equal(svc.currentUnseenReport()!.items[0]!.title, 'Only (2019)');
  const calls = p.calls.length;
  assert.equal(await svc.runUnseenReportTick(p.d), 'fresh');
  svc.resetUnseenReportCache(); // restart: memory gone, bot_settings stays
  assert.equal(svc.currentUnseenReport()!.items.length, 1, 'restored from bot_settings');
  assert.equal(await svc.runUnseenReportTick(p.d), 'fresh');
  assert.equal(p.calls.length, calls, 'no further Tautulli calls');
  // 25 h later -> recompute
  const later = { ...p.d, now: () => NOW + 25 * 3_600_000 };
  assert.equal(await svc.runUnseenReportTick(later), 'updated');
});

test('tick: a failing run keeps the previous report and says failed; disabled / no Tautulli config = skipped without any call', async () => {
  const p = deps({ pages: { '1': [row({ title: 'Keep', file_size: 7 })] } });
  await svc.runUnseenReportTick(p.d);
  const later = { ...p.d, now: () => NOW + 25 * 3_600_000, getLibraries: async () => null };
  assert.equal(await svc.runUnseenReportTick(later), 'failed');
  assert.equal(svc.currentUnseenReport()!.items[0]!.title, 'Keep (2019)');

  let called = false;
  const spy = { ...p.d, getLibraries: async () => { called = true; return []; } };
  assert.equal(await svc.runUnseenReportTick(spy, () => false), 'skipped');
  assert.equal(called, false);
  const prevUrl = config.TAUTULLI_URL;
  (config as Record<string, unknown>).TAUTULLI_URL = undefined;
  assert.equal(await svc.runUnseenReportTick(spy), 'skipped');
  (config as Record<string, unknown>).TAUTULLI_URL = prevUrl;
  assert.equal(called, false);
});

test('tick: changed settings invalidate the cache; a corrupt stored cache is ignored', async () => {
  const p = deps({ pages: { '1': [row({ title: 'X', file_size: 7 })] } });
  await svc.runUnseenReportTick(p.d);
  assert.equal(await svc.runUnseenReportTick({ ...p.d, minAgeDays: 30 }), 'updated');
  sqliteHandle.prepare("UPDATE bot_settings SET value = '{broken' WHERE key = 'unseenReport'").run();
  svc.resetUnseenReportCache();
  assert.equal(svc.currentUnseenReport(), null);
  assert.equal(await svc.runUnseenReportTick(p.d), 'updated');
});

test('PLEX_UNSEEN_REPORT_ENABLED=false hides the report from /api/status', async () => {
  const p = deps({ pages: { '1': [row({ title: 'X', file_size: 7 })] } });
  await svc.runUnseenReportTick(p.d);
  assert.ok(svc.currentUnseenReport());
  (config as Record<string, unknown>).PLEX_UNSEEN_REPORT_ENABLED = false;
  assert.equal(svc.currentUnseenReport(), null);
});

// ─── /api/status ───

test('status snapshot carries the unseen block (null by default); no user fields, no secrets, bounded size', async () => {
  const base = { uptimeSeconds: 1, build: { sha: null, date: null }, lastWebhookAt: new Map(), staleHours: 24, now: new Date(NOW) } as never;
  assert.equal(buildStatusSnapshot(base).unseen, null);
  const items = Array.from({ length: 25 }, (_, i) => row({ title: `Title ${i} ${'x'.repeat(80)}`, file_size: 9_000_000_000 - i }));
  const p = deps({ pages: { '1': items } });
  const block = (await svc.computeUnseenReport(p.d))!;
  const snap = buildStatusSnapshot({ ...(base as object), unseen: block } as never);
  const json = JSON.stringify(snap.unseen);
  assert.equal(snap.unseen!.items.length, 25);
  assert.ok(json.length < 8_000, `unseen block is ${json.length} bytes`);
  assert.doesNotMatch(json, /tautulli|apikey|token|secret|user|friendly|ip_address/i);
});

test('GET /api/status: Bearer-gated, the unseen field comes from the cache and the Tautulli key never appears', async () => {
  const p = deps({ pages: { '1': [row({ title: 'Report Item', file_size: 7 })] } });
  await svc.runUnseenReportTick(p.d);
  const { buildApp } = await import('../src/server/app.ts');
  const app = buildApp();
  const noAuth = await app.request('/api/status');
  assert.equal(noAuth.status, 401);
  const ok = await app.request('/api/status', { headers: { authorization: `Bearer ${process.env.STATUS_API_TOKEN}` } });
  assert.equal(ok.status, 200);
  const text = await ok.text();
  const body = JSON.parse(text) as { unseen: { items: Array<{ title: string }> } };
  assert.equal(body.unseen.items[0]!.title, 'Report Item (2019)');
  assert.ok(!text.includes('tautulli-secret-key-should-never-leak'));
});

test('size budget: a worst-case report (25 long non-ASCII titles) is clipped to the 6 KB budget at the end, smallest items first; a small report is served unchanged', async () => {
  const wide = '漢'.repeat(80);
  const items = Array.from({ length: 25 }, (_, i) => row({ title: `${i}${wide}`, file_size: 9_000_000_000 - i * 1000 }));
  const full = (await svc.computeUnseenReport(deps({ pages: { '1': items } }).d))!;
  assert.equal(full.items.length, 25);
  assert.ok(pure.unseenBlockBytes(full) > pure.UNSEEN_MAX_BYTES, 'precondition: the worst case really is over budget');

  const clipped = pure.clipUnseenBlock(full);
  assert.ok(pure.unseenBlockBytes(clipped) <= pure.UNSEEN_MAX_BYTES, `clipped to ${pure.unseenBlockBytes(clipped)} bytes`);
  assert.equal(clipped.clipped, true);
  assert.ok(clipped.items.length > 0 && clipped.items.length < 25);
  assert.deepEqual(clipped.items, full.items.slice(0, clipped.items.length), 'the biggest items stay, order unchanged');
  assert.equal(full.clipped, undefined, 'the input is not mutated');
  assert.equal(full.items.length, 25);

  const small = (await svc.computeUnseenReport(deps({ pages: { '1': [row()] } }).d))!;
  assert.equal(pure.clipUnseenBlock(small), small, 'fits: same object, no clipped flag');
  assert.equal(small.clipped, undefined);
  // a tiny budget empties the list but still returns a valid block
  const none = pure.clipUnseenBlock(full, 200);
  assert.deepEqual([none.items.length, none.clipped], [0, true]);

  // the same budget applies to what /api/status serves (cache -> snapshot field)
  await svc.runUnseenReportTick(deps({ pages: { '1': items } }).d);
  const { currentUnseenStatus } = await import('../src/server/status-snapshot.ts');
  const served = currentUnseenStatus()!;
  assert.ok(pure.unseenBlockBytes(served) <= pure.UNSEEN_MAX_BYTES);
  assert.equal(served.clipped, true);
  const { buildApp } = await import('../src/server/app.ts');
  const res = await buildApp().request('/api/status', { headers: { authorization: `Bearer ${process.env.STATUS_API_TOKEN}` } });
  const body = JSON.parse(await res.text()) as { unseen: { items: unknown[]; clipped?: boolean } };
  assert.equal(body.unseen.clipped, true);
  assert.ok(Buffer.byteLength(JSON.stringify(body.unseen), 'utf8') <= pure.UNSEEN_MAX_BYTES);
});
