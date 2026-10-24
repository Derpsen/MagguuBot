import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { mock } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'rio-roles-'));
after(() => rmSync(dir, { recursive: true, force: true }));
Object.assign(process.env, {
  DATABASE_PATH: join(dir, 'bot.db'),
  DISCORD_TOKEN: 'test-token-not-used',
  DISCORD_CLIENT_ID: '1498095100000000001',
  DISCORD_GUILD_ID: '1400000000000000099',
  WEBHOOK_SECRET: 'test-secret-0123456789abcdef',
});

// the command registry first: importing the event module before it hits an existing import cycle in the client wiring
const { commands } = await import('../src/discord/commands/index.ts');
const { guildMemberRemoveEvent } = await import('../src/discord/events/guild-member-remove.ts');
const pure = await import('../src/utils/rio-roles.ts');
const client = await import('../src/services/raiderio.ts');
const svc = await import('../src/discord/rio-roles.ts');
const { config } = await import('../src/config.ts');
const { logger } = await import('../src/utils/logger.ts');
const { sqliteHandle } = await import('../src/db/client.ts');
const { rioLinkCommand, rioUnlinkCommand, rioConfigCommand } = await import('../src/discord/commands/rio.ts');

const GUILD = '1400000000000000099';
const USER = '1500000000000000001';
const R1 = '1600000000000000001'; // 1000
const R2 = '1600000000000000002'; // 2000
const R3 = '1600000000000000003'; // 3000
const OTHER = '1600000000000000009'; // unrelated role the member holds
const TIERS = [{ minScore: 1000, roleId: R1 }, { minScore: 2000, roleId: R2 }, { minScore: 3000, roleId: R3 }];

// ─── pure: thresholds ──────────────────────────────────────────────────────────

test('thresholds: short form and JSON parse equally, sort ascending, last duplicate wins, invalid entries are reported and dropped', () => {
  const short = pure.parseRioThresholds(`2000=${R2}, 1000=${R1} ,3000=${R3}`);
  const json = pure.parseRioThresholds(JSON.stringify([{ minScore: 3000, roleId: R3 }, { minScore: 1000, roleId: R1 }, { minScore: '2000', roleId: R2 }]));
  assert.deepEqual(short.tiers, TIERS);
  assert.deepEqual(json.tiers, TIERS);
  assert.deepEqual(short.problems, []);

  const dup = pure.parseRioThresholds(`1000=${R1},1000=${R2}`);
  assert.deepEqual(dup.tiers, [{ minScore: 1000, roleId: R2 }]);

  const bad = pure.parseRioThresholds(`abc=${R1},1000=notarole,500,-5=${R1},99999=${R1},1500=${R2}`);
  assert.deepEqual(bad.tiers, [{ minScore: 1500, roleId: R2 }]);
  assert.equal(bad.problems.length, 5);

  assert.deepEqual(pure.parseRioThresholds('').tiers, []);
  assert.deepEqual(pure.parseRioThresholds('   ').tiers, []);
  assert.match(pure.parseRioThresholds('[{').problems[0]!, /JSON/);
  assert.match(pure.parseRioThresholds('{"a":1}').problems[0]!, /Liste/);
  assert.equal(pure.parseRioThresholds(pure.serializeRioThresholds(TIERS)).tiers.length, 3, 'round trip');
});

test('thresholds: more than the cap are cut with a note', () => {
  const many = Array.from({ length: 20 }, (_, i) => `${i * 100}=${R1}`).join(',');
  const parsed = pure.parseRioThresholds(many);
  assert.equal(parsed.tiers.length, pure.RIO_MAX_TIERS);
  assert.ok(parsed.problems.some((p) => /mehr als/.test(p)));
});

test('tierForScore: highest reached tier, exact boundary counts, below the lowest = none', () => {
  assert.equal(pure.tierForScore(TIERS, 0), null);
  assert.equal(pure.tierForScore(TIERS, 999.9), null);
  assert.equal(pure.tierForScore(TIERS, 1000)?.roleId, R1);
  assert.equal(pure.tierForScore(TIERS, 1999.9)?.roleId, R1);
  assert.equal(pure.tierForScore(TIERS, 2000)?.roleId, R2);
  assert.equal(pure.tierForScore(TIERS, 9999)?.roleId, R3);
  assert.equal(pure.tierForScore([], 5000), null);
});

test('planRoleChange: only the role the bot gave may be removed; a foreign hold is never claimed', () => {
  const held = (...ids: string[]) => new Set(ids);
  // first link
  assert.deepEqual(pure.planRoleChange({ tiers: TIERS, score: 2500, memberRoleIds: held(OTHER), lastRoleId: null }), { target: R2, add: R2, remove: null, botRole: R2 });
  // moving up: old bot role goes
  assert.deepEqual(pure.planRoleChange({ tiers: TIERS, score: 3100, memberRoleIds: held(R2, OTHER), lastRoleId: R2 }), { target: R3, add: R3, remove: R2, botRole: R3 });
  // moving down
  assert.deepEqual(pure.planRoleChange({ tiers: TIERS, score: 1100, memberRoleIds: held(R3), lastRoleId: R3 }), { target: R1, add: R1, remove: R3, botRole: R1 });
  // below everything: remove the bot role, nothing added
  assert.deepEqual(pure.planRoleChange({ tiers: TIERS, score: 10, memberRoleIds: held(R1), lastRoleId: R1 }), { target: null, add: null, remove: R1, botRole: null });
  // a lower tier role the member holds but the bot did not give stays untouched
  assert.deepEqual(pure.planRoleChange({ tiers: TIERS, score: 2500, memberRoleIds: held(R1), lastRoleId: null }), { target: R2, add: R2, remove: null, botRole: R2 });
  // target already held without the bot having given it: not added, not claimed (unlink will not remove it)
  assert.deepEqual(pure.planRoleChange({ tiers: TIERS, score: 1500, memberRoleIds: held(R1), lastRoleId: null }), { target: R1, add: null, remove: null, botRole: null });
  // unchanged tier, bot role still held: nothing to do, still the bot's
  assert.deepEqual(pure.planRoleChange({ tiers: TIERS, score: 1500, memberRoleIds: held(R1), lastRoleId: R1 }), { target: R1, add: null, remove: null, botRole: R1 });
  // bot role was removed manually by the member: gets re-added
  assert.deepEqual(pure.planRoleChange({ tiers: TIERS, score: 1500, memberRoleIds: held(), lastRoleId: R1 }), { target: R1, add: R1, remove: null, botRole: R1 });
  // the bot role is gone from the member already: nothing to remove
  assert.deepEqual(pure.planRoleChange({ tiers: TIERS, score: 2500, memberRoleIds: held(), lastRoleId: R1 }), { target: R2, add: R2, remove: null, botRole: R2 });
});

test('input normalisation: region, name and realm are validated', () => {
  assert.deepEqual(pure.normaliseRioInput(' Anna ', 'Tarren  Mill', 'EU'), { ok: true, value: { name: 'Anna', realm: 'Tarren Mill', region: 'eu' } });
  assert.equal(pure.normaliseRioInput('Ünal', 'Blackrock', 'us').ok, true);
  assert.equal(pure.normaliseRioInput('A', 'Blackrock', 'eu').ok, false);
  assert.equal(pure.normaliseRioInput('Anna1', 'Blackrock', 'eu').ok, false);
  assert.equal(pure.normaliseRioInput('Anna', 'x', 'eu').ok, false);
  assert.equal(pure.normaliseRioInput('Anna', 'a&b=c', 'eu').ok, false);
  assert.equal(pure.normaliseRioInput('Anna', 'Blackrock', 'xx').ok, false);
  assert.equal(pure.normaliseRioInput('Anna', 'Blackrock', 'eu/../x').ok, false);
});

// ─── Raider.IO client ──────────────────────────────────────────────────────────

const INPUT = { name: 'Anna', realm: 'Blackrock', region: 'eu' as const };
const profile = (score: number, extra: Record<string, unknown> = {}) => ({
  name: 'Anna', realm: 'Blackrock', region: 'eu', profile_url: 'https://raider.io/characters/eu/blackrock/Anna',
  mythic_plus_scores_by_season: [{ season: 'season-x-1', scores: { all: score, dps: score } }], ...extra,
});
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function fakeFetch(handler: (url: URL) => Response | Promise<Response>) {
  const calls: URL[] = [];
  const fn = (async (input: URL | string) => { const u = new URL(String(input)); calls.push(u); return handler(u); }) as unknown as typeof fetch;
  return { fn, calls };
}

beforeEach(() => { client.resetRioClient(); svc.resetRioGuards(); });

test('client: documented endpoint and fields, parses the score of the current season, short cache', async () => {
  let t = 1_000_000;
  const f = fakeFetch(() => json(200, profile(2345.6)));
  const a = await client.fetchRioScore(INPUT, { fetchFn: f.fn, now: () => t });
  assert.deepEqual(a.ok && [a.score, a.season, a.cached], [2345.6, 'season-x-1', false]);
  const u = f.calls[0]!;
  assert.equal(`${u.origin}${u.pathname}`, 'https://raider.io/api/v1/characters/profile');
  assert.equal(u.searchParams.get('fields'), 'mythic_plus_scores_by_season:current');
  assert.deepEqual([u.searchParams.get('region'), u.searchParams.get('realm'), u.searchParams.get('name')], ['eu', 'Blackrock', 'Anna']);
  t += 30_000;
  const b = await client.fetchRioScore(INPUT, { fetchFn: f.fn, now: () => t });
  assert.equal(b.ok && b.cached, true);
  assert.equal(f.calls.length, 1);
  t += client.RIO_CACHE_TTL_MS;
  await client.fetchRioScore(INPUT, { fetchFn: f.fn, now: () => t });
  assert.equal(f.calls.length, 2, 'cache expired');
});

test('client: no season entry counts as score 0; malformed bodies are bad-response', async () => {
  const none = await client.fetchRioScore(INPUT, { fetchFn: fakeFetch(() => json(200, profile(0, { mythic_plus_scores_by_season: [] }))).fn });
  assert.deepEqual(none.ok && [none.score, none.season], [0, null]);
  for (const body of [{ nope: 1 }, profile(1, { mythic_plus_scores_by_season: [{ season: 's', scores: { all: 'x' } }] }), profile(-4), 'str', null]) {
    client.resetRioClient();
    const r = await client.fetchRioScore(INPUT, { fetchFn: fakeFetch(() => json(200, body)).fn });
    assert.deepEqual(r.ok ? null : r.kind, 'bad-response', JSON.stringify(body));
  }
  client.resetRioClient();
  const html = await client.fetchRioScore(INPUT, { fetchFn: fakeFetch(() => new Response('<html>', { status: 200 })).fn });
  assert.equal(html.ok ? null : html.kind, 'bad-response');
});

test('client: 400 "Could not find requested character" and 404 are not-found, other 400 is invalid-input', async () => {
  const nf = await client.fetchRioScore(INPUT, { fetchFn: fakeFetch(() => json(400, { statusCode: 400, error: 'Bad Request', message: 'Could not find requested character' })).fn });
  assert.equal(nf.ok ? null : nf.kind, 'not-found');
  client.resetRioClient();
  const nf2 = await client.fetchRioScore(INPUT, { fetchFn: fakeFetch(() => json(404, {})).fn });
  assert.equal(nf2.ok ? null : nf2.kind, 'not-found');
  client.resetRioClient();
  const inv = await client.fetchRioScore(INPUT, { fetchFn: fakeFetch(() => json(400, { message: 'Invalid request query input' })).fn });
  assert.equal(inv.ok ? null : inv.kind, 'invalid-input');
});

test('client: 429 honours Retry-After (seconds and date), blocks further calls until then; 5xx / timeout / network errors map to clear kinds', async () => {
  let t = 5_000_000;
  const f = fakeFetch(() => json(429, {}, { 'retry-after': '42' }));
  const r = await client.fetchRioScore(INPUT, { fetchFn: f.fn, now: () => t });
  assert.deepEqual(r, { ok: false, kind: 'rate-limited', retryAfterSec: 42 });
  t += 10_000;
  const blocked = await client.fetchRioScore({ ...INPUT, name: 'Bella' }, { fetchFn: f.fn, now: () => t });
  assert.deepEqual(blocked.ok ? null : [blocked.kind, (blocked as { retryAfterSec: number }).retryAfterSec], ['rate-limited', 32]);
  assert.equal(f.calls.length, 1, 'no call while blocked');
  t += 33_000;
  const f2 = fakeFetch(() => json(200, profile(10)));
  assert.equal((await client.fetchRioScore({ ...INPUT, name: 'Bella' }, { fetchFn: f2.fn, now: () => t })).ok, true);

  assert.equal(client.parseRetryAfter(null, 0), 60);
  assert.equal(client.parseRetryAfter('abc', 0), 60);
  assert.equal(client.parseRetryAfter('0', 0), 1);
  assert.equal(client.parseRetryAfter('99999', 0), client.RIO_MAX_RETRY_AFTER_SEC);
  assert.equal(client.parseRetryAfter(new Date(90_000).toUTCString(), 30_000), 60);

  client.resetRioClient();
  const e5 = await client.fetchRioScore(INPUT, { fetchFn: fakeFetch(() => json(503, {})).fn });
  assert.equal(e5.ok ? null : e5.kind, 'unavailable');
  client.resetRioClient();
  const net = await client.fetchRioScore(INPUT, { fetchFn: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
  assert.equal(net.ok ? null : net.kind, 'unavailable');
  client.resetRioClient();
  const abort = await client.fetchRioScore(INPUT, { fetchFn: (async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); }) as unknown as typeof fetch });
  assert.equal(abort.ok ? null : abort.kind, 'timeout');
  client.resetRioClient();
  const odd = await client.fetchRioScore(INPUT, { fetchFn: fakeFetch(() => json(418, {})).fn });
  assert.equal(odd.ok ? null : odd.kind, 'bad-response');
});

test('client: a real timeout aborts a hanging request', async () => {
  const hang = (async (_u: unknown, init?: { signal?: AbortSignal }) => new Promise<Response>((_res, rej) => {
    init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  })) as unknown as typeof fetch;
  const started = Date.now();
  const r = await client.fetchRioScore(INPUT, { fetchFn: hang, timeoutMs: 50 });
  assert.equal(r.ok ? null : r.kind, 'timeout');
  assert.ok(Date.now() - started >= 40 && Date.now() - started < 2000);
  assert.equal(client.RIO_TIMEOUT_MS, 8_000, 'production timeout');
});

test('client: own global ceiling per minute (all users together) answers rate-limited without calling', async () => {
  const t = 9_000_000;
  const f = fakeFetch(() => json(200, profile(1)));
  for (let i = 0; i < client.RIO_GLOBAL_LIMIT; i += 1) {
    const r = await client.fetchRioScore({ ...INPUT, name: `Name${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}` }, { fetchFn: f.fn, now: () => t });
    assert.equal(r.ok, true, `call ${i}`);
  }
  const over = await client.fetchRioScore({ ...INPUT, name: 'Zzzz' }, { fetchFn: f.fn, now: () => t + 1000 });
  assert.equal(over.ok ? null : over.kind, 'rate-limited');
  assert.equal(f.calls.length, client.RIO_GLOBAL_LIMIT);
  const later = await client.fetchRioScore({ ...INPUT, name: 'Zzzz' }, { fetchFn: f.fn, now: () => t + client.RIO_GLOBAL_WINDOW_MS + 1 });
  assert.equal(later.ok, true);
});

// ─── Discord side with fakes ───────────────────────────────────────────────────

interface FakeRole { id: string; name: string; managed: boolean; editable: boolean; permissions: unknown }
function rig(opts: { held?: string[]; roles?: Partial<Record<string, Partial<FakeRole>>>; missing?: string[]; manageRoles?: boolean; addError?: number; removeError?: number; memberMissing?: boolean } = {}) {
  const held = new Set(opts.held ?? []);
  const log: string[] = [];
  const fail = (code: number) => Object.assign(new Error(`discord ${code}`), { code });
  const member = {
    roles: {
      cache: { has: (id: string) => held.has(id), keys: () => held.keys() },
      async add(id: string) { if (opts.addError) throw fail(opts.addError); held.add(id); log.push(`add ${id}`); },
      async remove(id: string) { if (opts.removeError) throw fail(opts.removeError); held.delete(id); log.push(`remove ${id}`); },
    },
  };
  const guild = {
    id: GUILD,
    members: {
      me: opts.manageRoles === false ? { permissions: { has: () => false } } : { permissions: { has: (f: bigint) => f === PermissionFlagsBits.ManageRoles } },
      async fetch() { if (opts.memberMissing) throw fail(10_007); return member; },
    },
    roles: {
      async fetch(id: string) {
        if (opts.missing?.includes(id)) return null;
        return { id, name: `Rolle-${id.slice(-1)}`, managed: false, editable: true, permissions: '0', ...(opts.roles?.[id] ?? {}) } as FakeRole;
      },
    },
  };
  return { guild, held, log };
}
const scoreOf = (score: number) => async () => ({ ok: true as const, score, season: 'season-x-1', name: 'Anna', realm: 'Blackrock', region: 'eu', profileUrl: null, cached: false });
class MemStore implements svc.RioStore {
  rows = new Map<string, svc.RioLinkRow>();
  get(g: string, u: string) { return this.rows.get(`${g}/${u}`) ?? null; }
  upsert(r: svc.RioLinkRow) { this.rows.set(`${r.guildId}/${r.userId}`, { ...r }); }
  delete(g: string, u: string) { return this.rows.delete(`${g}/${u}`); }
}
const link = (r: ReturnType<typeof rig>, store: MemStore, score: number, tiers = TIERS) =>
  svc.linkRioCharacter({ guild: r.guild as never, userId: USER, input: INPUT, tiers, store, fetchScore: scoreOf(score), now: () => 123 });

test('link: not configured answers with a hint, no API call, nothing changed', async () => {
  const r = rig();
  let calls = 0;
  const out = await svc.linkRioCharacter({ guild: r.guild as never, userId: USER, input: INPUT, tiers: [], store: new MemStore(), fetchScore: async () => { calls += 1; return scoreOf(1)(); } });
  assert.deepEqual(out, { kind: 'not-configured' });
  assert.equal(calls, 0);
  assert.match(svc.rioLinkMessage(out, ''), /noch nicht eingerichtet/);
});

test('link: gives the matching role, stores the mapping, later re-link moves between tiers and only removes the bot-given role', async () => {
  const store = new MemStore();
  const r = rig({ held: [OTHER, R1 /* held before, not given by the bot */] });
  const first = await link(r, store, 2500);
  assert.equal(first.kind === 'linked' && first.roleId, R2);
  assert.deepEqual([...r.held].sort(), [R1, R2, OTHER].sort(), 'R1 (foreign) untouched, R2 added');
  assert.deepEqual(store.get(GUILD, USER), { guildId: GUILD, userId: USER, characterName: 'Anna', realm: 'Blackrock', region: 'eu', lastScore: 2500, lastRoleId: R2, updatedAt: 123 });
  const up = await link(r, store, 3200);
  assert.equal(up.kind === 'linked' && up.removedRoleId, R2);
  assert.deepEqual([...r.held].sort(), [R1, R3, OTHER].sort());
  assert.equal(store.get(GUILD, USER)?.lastRoleId, R3);
  const down = await link(r, store, 50);
  assert.equal(down.kind === 'linked' && down.roleId, null);
  assert.deepEqual([...r.held].sort(), [R1, OTHER].sort(), 'only the bot-given R3 went');
  assert.equal(store.get(GUILD, USER)?.lastRoleId, null);
  assert.match(svc.rioLinkMessage(down, ''), /unter der niedrigsten Schwelle/);
});

test('link: reply mentions the role without pinging (text), shows season label and next tier', async () => {
  const store = new MemStore();
  const out = await link(rig(), store, 1200);
  const text = svc.rioLinkMessage(out, 'Season 2');
  assert.match(text, /\*\*1200\*\*/);
  assert.match(text, /Season 2/);
  assert.ok(text.includes(`<@&${R1}>`));
  assert.match(text, /ab 2000 Punkten/);
  assert.match(svc.rioLinkMessage(out, ''), /season-x-1/);
});

test('link: missing Manage Roles, missing role, hierarchy and managed role give clear messages and change NOTHING (no mapping, no role)', async () => {
  const cases: Array<[string, ReturnType<typeof rig>, RegExp]> = [
    ['manage roles', rig({ manageRoles: false }), /Rollen verwalten/],
    ['role missing', rig({ missing: [R2] }), /gibt es nicht mehr/],
    ['hierarchy', rig({ roles: { [R2]: { editable: false } } }), /über meiner eigenen Rolle/],
    ['managed', rig({ roles: { [R2]: { managed: true } } }), /Integration/],
    ['discord 50013', rig({ addError: 50_013 }), /fehlende Rechte/],
  ];
  for (const [label, r, re] of cases) {
    const store = new MemStore();
    const out = await link(r, store, 2500);
    assert.match(svc.rioLinkMessage(out, ''), re, label);
    assert.equal(r.log.length, 0, `${label}: no role call`);
    assert.equal(store.rows.size, 0, `${label}: no mapping`);
  }
  // the role to REMOVE is above the bot: also refused before anything changes
  const store = new MemStore();
  store.upsert({ guildId: GUILD, userId: USER, characterName: 'Anna', realm: 'Blackrock', region: 'eu', lastScore: 1100, lastRoleId: R1, updatedAt: 1 });
  const r = rig({ held: [R1], roles: { [R1]: { editable: false } } });
  const out = await link(r, store, 2500);
  assert.equal(out.kind, 'role-hierarchy');
  assert.deepEqual(r.log, []);
  assert.equal(store.get(GUILD, USER)?.lastScore, 1100, 'mapping untouched');
  // the role the bot gave was deleted from the server meanwhile: nothing to remove, link still works
  const r2 = rig({ held: [], missing: [R1] });
  const out2 = await link(r2, store, 2500);
  assert.equal(out2.kind, 'linked');
  assert.deepEqual(r2.log, [`add ${R2}`]);
});

test('link: API errors (not found, rate limit, timeout, 5xx) are reported without touching roles or the mapping', async () => {
  const kinds: Array<[Parameters<typeof svc.rioLinkMessage>[0], RegExp]> = [];
  for (const [failure, re] of [
    [{ ok: false as const, kind: 'not-found' as const }, /kennt diesen Charakter nicht/],
    [{ ok: false as const, kind: 'rate-limited' as const, retryAfterSec: 42 }, /42 Sekunden/],
    [{ ok: false as const, kind: 'timeout' as const }, /nicht rechtzeitig/],
    [{ ok: false as const, kind: 'unavailable' as const }, /nicht erreichbar/],
    [{ ok: false as const, kind: 'bad-response' as const }, /unerwartete Antwort/],
    [{ ok: false as const, kind: 'invalid-input' as const }, /abgelehnt/],
  ] as const) {
    const r = rig();
    const store = new MemStore();
    const out = await svc.linkRioCharacter({ guild: r.guild as never, userId: USER, input: INPUT, tiers: TIERS, store, fetchScore: async () => failure });
    assert.equal(out.kind, 'api-error');
    assert.match(svc.rioLinkMessage(out, ''), re);
    assert.equal(r.log.length, 0);
    assert.equal(store.rows.size, 0);
    kinds.push([out, re]);
  }
  assert.equal(kinds.length, 6);
});

test('unlink: removes only the bot-given role and the mapping; without mapping a hint; role problems still delete the mapping', async () => {
  const store = new MemStore();
  assert.deepEqual(await svc.unlinkRioCharacter({ guild: rig().guild as never, userId: USER, store }), { kind: 'not-linked' });

  const r = rig({ held: [OTHER, R1] });
  await link(r, store, 2500); // gives R2, R1 foreign
  const out = await svc.unlinkRioCharacter({ guild: r.guild as never, userId: USER, store });
  assert.deepEqual(out, { kind: 'unlinked', removedRoleId: R2, roleProblem: false });
  assert.deepEqual([...r.held].sort(), [R1, OTHER].sort());
  assert.equal(store.rows.size, 0);

  // bot role above the bot: mapping gone anyway, member told
  const store2 = new MemStore();
  store2.upsert({ guildId: GUILD, userId: USER, characterName: 'Anna', realm: 'Blackrock', region: 'eu', lastScore: 1, lastRoleId: R3, updatedAt: 1 });
  const r2 = rig({ held: [R3], roles: { [R3]: { editable: false } } });
  const o2 = await svc.unlinkRioCharacter({ guild: r2.guild as never, userId: USER, store: store2 });
  assert.deepEqual(o2, { kind: 'unlinked', removedRoleId: null, roleProblem: true });
  assert.equal(store2.rows.size, 0);
  assert.deepEqual(r2.log, []);
  assert.match(svc.rioUnlinkMessage(o2), /Moderator/);

  // member already left (10007): mapping removed, no problem
  const store3 = new MemStore();
  store3.upsert({ guildId: GUILD, userId: USER, characterName: 'Anna', realm: 'Blackrock', region: 'eu', lastScore: 1, lastRoleId: R3, updatedAt: 1 });
  const o3 = await svc.unlinkRioCharacter({ guild: rig({ memberMissing: true }).guild as never, userId: USER, store: store3 });
  assert.deepEqual(o3, { kind: 'unlinked', removedRoleId: null, roleProblem: false });

  // a mapping without a bot role (target was foreign): nothing removed
  const store4 = new MemStore();
  store4.upsert({ guildId: GUILD, userId: USER, characterName: 'Anna', realm: 'Blackrock', region: 'eu', lastScore: 1500, lastRoleId: null, updatedAt: 1 });
  const r4 = rig({ held: [R1] });
  assert.equal((await svc.unlinkRioCharacter({ guild: r4.guild as never, userId: USER, store: store4 })).kind, 'unlinked');
  assert.deepEqual(r4.log, []);
  assert.ok(r4.held.has(R1));
});

test('real SQLite: mapping round trip, upsert, delete; leaving the server deletes it (guildMemberRemove)', async () => {
  const s = svc.rioSqliteStore;
  assert.equal(s.get(GUILD, USER), null);
  const row = { guildId: GUILD, userId: USER, characterName: 'Anna', realm: 'Blackrock', region: 'eu', lastScore: 1234.5, lastRoleId: R1, updatedAt: 1_700_000_000_000 };
  s.upsert(row);
  s.upsert({ ...row, lastScore: 2000, lastRoleId: R2 });
  assert.deepEqual(s.get(GUILD, USER), { ...row, lastScore: 2000, lastRoleId: R2 });
  assert.equal((sqliteHandle.prepare('SELECT COUNT(*) c FROM rio_link').get() as { c: number }).c, 1);
  const columns = (sqliteHandle.prepare('PRAGMA table_info(rio_link)').all() as Array<{ name: string }>).map((c) => c.name).sort();
  assert.deepEqual(columns, ['character_name', 'guild_id', 'last_role_id', 'last_score', 'realm', 'region', 'updated_at', 'user_id']);

  const member = { id: USER, guild: { id: GUILD, channels: { fetch: async () => null } }, user: null, joinedTimestamp: null };
  await guildMemberRemoveEvent.execute(member as never);
  assert.equal(s.get(GUILD, USER), null, 'mapping deleted on leave');
  assert.equal(s.delete(GUILD, USER), false);
});

test('cooldowns: link 60 s and unlink 10 s per user, independent per user, and a request in flight blocks a second one', () => {
  const t = 1_000_000;
  assert.equal(svc.takeRioCooldown('link', 'a', t), 0);
  assert.equal(svc.takeRioCooldown('link', 'a', t + 20_000), 40);
  assert.equal(svc.takeRioCooldown('link', 'b', t + 20_000), 0);
  assert.equal(svc.takeRioCooldown('link', 'a', t + 60_000), 0);
  assert.equal(svc.takeRioCooldown('unlink', 'a', t), 0);
  assert.equal(svc.takeRioCooldown('unlink', 'a', t + 3_000), 7);
  assert.equal(svc.tryBeginRio('a'), true);
  assert.equal(svc.tryBeginRio('a'), false);
  svc.endRio('a');
  assert.equal(svc.tryBeginRio('a'), true);
});

// ─── commands with fake interactions ───────────────────────────────────────────

function fakeInteraction(over: Record<string, unknown> = {}, opts: Record<string, unknown> = {}, sub = 'anzeigen') {
  const replies: Array<Record<string, unknown>> = [];
  const i = {
    guildId: GUILD,
    inGuild: () => true,
    user: { id: USER },
    guild: null as unknown,
    memberPermissions: { has: () => true },
    replied: false,
    options: {
      getString: (n: string) => (opts[n] as string | undefined) ?? null,
      getNumber: (n: string) => (opts[n] as number | undefined) ?? null,
      getRole: (n: string) => (opts[n] as unknown) ?? null,
      getSubcommand: () => sub,
    },
    async reply(p: Record<string, unknown>) { replies.push(p); },
    async deferReply(p: Record<string, unknown>) { replies.push({ deferred: true, ...p }); },
    async editReply(p: Record<string, unknown>) { replies.push(p); },
    ...over,
  };
  return { i: i as never, replies };
}

test('commands: registered, region choices, Magguu-server only, strict allowed_mentions, not set up = plain hint', async () => {
  for (const n of ['rio-link', 'rio-unlink', 'rio-config']) assert.ok(commands.has(n), n);
  const linkJson = commands.get('rio-link')!.data.toJSON() as unknown as { options: Array<{ name: string; choices?: Array<{ value: string }> }>; default_member_permissions?: string | null };
  assert.deepEqual(linkJson.options.find((o) => o.name === 'region')?.choices?.map((c) => c.value), ['eu', 'us', 'kr', 'tw', 'cn']);
  assert.ok(!linkJson.default_member_permissions, 'members may use it');
  assert.equal(BigInt((commands.get('rio-config')!.data.toJSON() as { default_member_permissions: string }).default_member_permissions), PermissionFlagsBits.ManageGuild);

  const foreign = fakeInteraction({ guildId: '999' }, { charakter: 'Anna', realm: 'Blackrock', region: 'eu' });
  await rioLinkCommand.execute(foreign.i);
  assert.match(String(foreign.replies[0]!.content), /Magguu-Server/);
  assert.deepEqual((foreign.replies[0]!.allowedMentions as { parse: unknown[] }).parse, []);

  const was = config.RIO_ROLE_THRESHOLDS;
  try {
    config.RIO_ROLE_THRESHOLDS = '';
    const bare = fakeInteraction({}, { charakter: 'Anna', realm: 'Blackrock', region: 'eu' });
    await rioLinkCommand.execute(bare.i);
    assert.equal(bare.replies.length, 1);
    assert.match(String(bare.replies[0]!.content), /noch nicht eingerichtet/);
    assert.deepEqual(bare.replies[0]!.flags, 64);
  } finally { config.RIO_ROLE_THRESHOLDS = was; }

  const bad = fakeInteraction({}, { charakter: 'A1', realm: 'Blackrock', region: 'eu' });
  config.RIO_ROLE_THRESHOLDS = `1000=${R1}`;
  try {
    await rioLinkCommand.execute(bad.i);
    assert.match(String(bad.replies[0]!.content), /Charaktername/);
  } finally { config.RIO_ROLE_THRESHOLDS = was; }
});

test('commands: /rio-link end to end with a fake guild and the Raider.IO call stubbed at fetch; cooldown on the second call', async () => {
  const was = config.RIO_ROLE_THRESHOLDS;
  const realFetch = globalThis.fetch;
  config.RIO_ROLE_THRESHOLDS = pure.serializeRioThresholds(TIERS);
  globalThis.fetch = (async () => json(200, profile(2100))) as unknown as typeof fetch;
  try {
    const r = rig();
    const a = fakeInteraction({ guild: r.guild }, { charakter: 'Anna', realm: 'Blackrock', region: 'eu' });
    await rioLinkCommand.execute(a.i);
    assert.equal(a.replies[0]!.deferred, true);
    assert.ok(String(a.replies[1]!.content).includes(`<@&${R2}>`));
    assert.deepEqual((a.replies[1]!.allowedMentions as { parse: unknown[] }).parse, []);
    assert.ok(r.held.has(R2));
    assert.equal(svc.rioSqliteStore.get(GUILD, USER)?.lastRoleId, R2);

    const again = fakeInteraction({ guild: r.guild }, { charakter: 'Anna', realm: 'Blackrock', region: 'eu' });
    await rioLinkCommand.execute(again.i);
    assert.match(String(again.replies[0]!.content), /Bitte warte noch/);

    const u = fakeInteraction({ guild: r.guild });
    await rioUnlinkCommand.execute(u.i);
    assert.match(String(u.replies[1]!.content), /gelöscht/);
    assert.ok(!r.held.has(R2));
    assert.equal(svc.rioSqliteStore.get(GUILD, USER), null);
  } finally {
    globalThis.fetch = realFetch;
    config.RIO_ROLE_THRESHOLDS = was;
    sqliteHandle.prepare('DELETE FROM rio_link').run();
  }
});

test('/rio-config: needs ManageGuild, sets/removes thresholds and the season label, reset falls back to the env', async () => {
  const was = config.RIO_ROLE_THRESHOLDS;
  try {
    config.RIO_ROLE_THRESHOLDS = '';
    const denied = fakeInteraction({ memberPermissions: { has: () => false } });
    await rioConfigCommand.execute(denied.i);
    assert.match(String(denied.replies[0]!.content), /Server verwalten/);

    const set = fakeInteraction({}, { score: 1500 }, 'setzen');
    (set.i as unknown as { options: { getRole: () => unknown } }).options.getRole = () => ({ id: R1, managed: false, editable: true, permissions: '0' });
    await rioConfigCommand.execute(set.i);
    assert.equal(svc.getRioTiers().tiers.length, 1);
    assert.deepEqual(svc.getRioTiers().tiers[0], { minScore: 1500, roleId: R1 });
    assert.deepEqual((set.replies[0]!.allowedMentions as { parse: unknown[] }).parse, []);

    const managed = fakeInteraction({}, { score: 2500 }, 'setzen');
    (managed.i as unknown as { options: { getRole: () => unknown } }).options.getRole = () => ({ id: R2, managed: true });
    await rioConfigCommand.execute(managed.i);
    assert.match(String(managed.replies[0]!.content), /nicht als Score-Rolle/);
    assert.equal(svc.getRioTiers().tiers.length, 1);

    await rioConfigCommand.execute(fakeInteraction({}, { label: ' Season 3 ' }, 'season').i);
    assert.equal(svc.getRioSeasonLabel(), 'Season 3');
    const show = fakeInteraction({}, {}, 'anzeigen');
    await rioConfigCommand.execute(show.i);
    assert.match(String(show.replies[0]!.content), /1500/);
    assert.match(String(show.replies[0]!.content), /Season 3/);

    await rioConfigCommand.execute(fakeInteraction({}, { score: 1500 }, 'entfernen').i);
    assert.deepEqual(svc.getRioTiers().tiers, []);
    assert.deepEqual(svc.getRioTiers().tiers, [], 'stored empty list overrides the env');
    config.RIO_ROLE_THRESHOLDS = `700=${R3}`;
    assert.deepEqual(svc.getRioTiers().tiers, [], 'still the stored (empty) override');
    await rioConfigCommand.execute(fakeInteraction({}, {}, 'zuruecksetzen').i);
    assert.deepEqual(svc.getRioTiers().tiers, [{ minScore: 700, roleId: R3 }], 'reset: env again');
    assert.equal(svc.getRioSeasonLabel(), '');
  } finally {
    config.RIO_ROLE_THRESHOLDS = was;
    svc.resetRioConfig();
  }
});

// ─── Finding 1: score roles must be display roles without rights ───────────────

const SAFE_BITS = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.AddReactions | PermissionFlagsBits.ChangeNickname;

test('role safety (pure): every forbidden bit alone is refused, the list covers the dangerous ones, ordinary bits pass', () => {
  for (const must of ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageMessages', 'KickMembers', 'BanMembers', 'ModerateMembers', 'MentionEveryone', 'ManageWebhooks', 'ManageNicknames', 'ManageEvents', 'ManageThreads', 'ManageGuildExpressions', 'ViewAuditLog', 'ViewGuildInsights']) {
    assert.ok((pure.RIO_FORBIDDEN_PERMISSION_NAMES as readonly string[]).includes(must), `${must} is on the list`);
  }
  for (const name of pure.RIO_FORBIDDEN_PERMISSION_NAMES) {
    const bit = PermissionFlagsBits[name];
    assert.equal(typeof bit, 'bigint', `${name} exists in this discord.js (typo guard)`);
    const verdict = pure.checkScoreRole({ id: R1, managed: false, permissions: String(bit | SAFE_BITS) }, GUILD);
    assert.equal(verdict.ok, false, name);
    assert.deepEqual(verdict.ok ? null : [verdict.category, verdict.permissions.includes(name)], ['dangerous', true], name);
  }
  assert.equal(pure.checkScoreRole({ id: R1, managed: false, permissions: String(SAFE_BITS) }, GUILD).ok, true);
  assert.equal(pure.checkScoreRole({ id: R1, managed: false, permissions: '0' }, GUILD).ok, true);
  // all three shapes of a bitfield
  assert.equal(pure.checkScoreRole({ id: R1, managed: false, permissions: new PermissionsBitField(SAFE_BITS) }, GUILD).ok, true);
  assert.equal(pure.checkScoreRole({ id: R1, managed: false, permissions: new PermissionsBitField(PermissionFlagsBits.BanMembers) }, GUILD).ok, false);
  assert.equal(pure.checkScoreRole({ id: R1, managed: false, permissions: PermissionFlagsBits.Administrator }, GUILD).ok, false);
  // @everyone, managed (bot / integration / booster) and unreadable permissions are refused
  assert.deepEqual(pure.checkScoreRole({ id: GUILD, managed: false, permissions: '0' }, GUILD), { ok: false, category: 'everyone', permissions: [] });
  assert.equal((pure.checkScoreRole({ id: R1, managed: true, permissions: '0' }, GUILD) as { category: string }).category, 'managed');
  for (const odd of [undefined, null, 'abc', {}, -1, '']) {
    assert.equal((pure.checkScoreRole({ id: R1, managed: false, permissions: odd }, GUILD) as { category?: string }).category, 'unreadable', String(odd));
  }
  assert.match(pure.scoreRoleRefusal({ ok: false, category: 'dangerous', permissions: ['BanMembers'] }, true), /BanMembers/);
  assert.doesNotMatch(pure.scoreRoleRefusal({ ok: false, category: 'dangerous', permissions: ['BanMembers'] }, false), /BanMembers/);
});

test('(a) /rio-config setzen refuses dangerous, @everyone, managed and unreadable roles and saves nothing; a harmless role is saved', async () => {
  const was = config.RIO_ROLE_THRESHOLDS;
  try {
    config.RIO_ROLE_THRESHOLDS = '';
    svc.resetRioConfig();
    const attempts: Array<[string, Record<string, unknown>, RegExp]> = [
      ['administrator', { id: R2, managed: false, editable: true, permissions: new PermissionsBitField(PermissionFlagsBits.Administrator) }, /Moderations-\/Admin-Rechte \(Administrator\)/],
      ['manage roles (string)', { id: R2, managed: false, editable: true, permissions: String(PermissionFlagsBits.ManageRoles) }, /ManageRoles/],
      ['ban members', { id: R2, managed: false, editable: true, permissions: String(PermissionFlagsBits.BanMembers | SAFE_BITS) }, /BanMembers/],
      ['@everyone', { id: GUILD, managed: false, editable: true, permissions: '0' }, /@everyone/],
      ['managed', { id: R2, managed: true, editable: true, permissions: '0' }, /verwaltet/],
      ['unreadable', { id: R2, managed: false, editable: true }, /nicht lesen/],
    ];
    for (const [label, role, re] of attempts) {
      const set = fakeInteraction({}, { score: 2500 }, 'setzen');
      (set.i as unknown as { options: { getRole: () => unknown } }).options.getRole = () => role;
      await rioConfigCommand.execute(set.i);
      assert.match(String(set.replies[0]!.content), /nicht als Score-Rolle/, label);
      assert.match(String(set.replies[0]!.content), re, label);
      assert.match(String(set.replies[0]!.content), /ohne Rechte/, label);
      assert.deepEqual(svc.getRioTiers().tiers, [], `${label}: nothing saved`);
    }
    const ok = fakeInteraction({}, { score: 2500 }, 'setzen');
    (ok.i as unknown as { options: { getRole: () => unknown } }).options.getRole = () => ({ id: R2, managed: false, editable: true, permissions: new PermissionsBitField(SAFE_BITS) });
    await rioConfigCommand.execute(ok.i);
    assert.deepEqual(svc.getRioTiers().tiers, [{ minScore: 2500, roleId: R2 }]);
  } finally {
    config.RIO_ROLE_THRESHOLDS = was;
    svc.resetRioConfig();
  }
});

test('(b) startup audit: env/stored tier roles with dangerous bits, @everyone or managed are dropped with a warning (role id + category only); invalid entries are dropped and logged', async () => {
  const DANGEROUS = '1600000000000000011';
  const MANAGED = '1600000000000000012';
  const FINE = '1600000000000000013';
  const GONE = '1600000000000000014';
  const was = config.RIO_ROLE_THRESHOLDS;
  const warns: unknown[][] = [];
  const spy = mock.method(logger, 'warn', (...args: unknown[]) => { warns.push(args); });
  try {
    config.RIO_ROLE_THRESHOLDS = `1000=${FINE},2000=${DANGEROUS},3000=${MANAGED},4000=${GUILD},5000=${GONE},bogus=${FINE},6000=nope`;
    svc.resetRioConfig();
    const roles: Record<string, Record<string, unknown>> = {
      [FINE]: { id: FINE, name: 'Fine', managed: false, editable: true, permissions: '0' },
      [DANGEROUS]: { id: DANGEROUS, name: 'Mod', managed: false, editable: true, permissions: String(PermissionFlagsBits.KickMembers) },
      [MANAGED]: { id: MANAGED, name: 'Bot', managed: true, editable: false, permissions: '0' },
      [GUILD]: { id: GUILD, name: '@everyone', managed: false, editable: false, permissions: '0' },
    };
    const guild = { id: GUILD, roles: { async fetch(id: string) { return roles[id] ?? null; } } };
    const result = await svc.auditRioTiers(guild as never);
    assert.deepEqual(result.refused.map((r) => [r.roleId, r.category]).sort(), [[DANGEROUS, 'dangerous'], [MANAGED, 'managed'], [GUILD, 'everyone']].sort());
    assert.deepEqual(svc.getRioTiers().tiers.map((t) => t.roleId), [FINE, GONE], 'refused ones are gone; the missing role is left to the live check');
    assert.ok(svc.getRioTiers().problems.some((p) => p.includes(DANGEROUS)));
    const logged = JSON.stringify(warns);
    assert.ok(logged.includes(DANGEROUS) && logged.includes('dangerous'), 'role id + category are logged');
    assert.ok(warns.some((w) => JSON.stringify(w).includes('invalid score role thresholds')), 'invalid entries are logged too');
    assert.ok(!logged.includes('KickMembers'), 'no permission details in the log');

    // an assignment can no longer happen through a refused role even if the live check would be skipped: the tier is gone
    assert.ok(!svc.getRioTiers().tiers.some((t) => t.roleId === DANGEROUS));
    // a fresh audit forgets the old verdicts
    roles[DANGEROUS] = { ...roles[DANGEROUS]!, permissions: '0' };
    await svc.auditRioTiers(guild as never);
    assert.ok(svc.getRioTiers().tiers.some((t) => t.roleId === DANGEROUS));
    // a fetch error is not a verdict (the live check at assignment decides)
    const broken = { id: GUILD, roles: { async fetch(): Promise<never> { throw new Error('boom'); } } };
    const res = await svc.auditRioTiers(broken as never);
    assert.deepEqual(res.refused, []);
  } finally {
    spy.mock.restore();
    config.RIO_ROLE_THRESHOLDS = was;
    svc.resetRioRefusedRoles();
    svc.resetRioConfig();
  }
});

test('(c) /rio-link fails closed live: dangerous, managed, @everyone, unreadable or vanished tier roles are not assigned, nothing changes, clear message', async () => {
  const cases: Array<[string, ReturnType<typeof rig>, RegExp]> = [
    ['dangerous (config is stale)', rig({ roles: { [R2]: { permissions: String(PermissionFlagsBits.Administrator) } } }), /Moderations-\/Admin-Rechte/],
    ['manage guild', rig({ roles: { [R2]: { permissions: String(PermissionFlagsBits.ManageGuild | SAFE_BITS) } } }), /Moderations-\/Admin-Rechte/],
    ['managed', rig({ roles: { [R2]: { managed: true } } }), /Integration, einem Bot/],
    ['@everyone', rig({ roles: { [R2]: { id: GUILD } } }), /@everyone/],
    ['unreadable permissions', rig({ roles: { [R2]: { permissions: undefined } } }), /nicht lesen/],
    ['vanished', rig({ missing: [R2] }), /gibt es nicht mehr/],
  ];
  for (const [label, r, re] of cases) {
    const store = new MemStore();
    const out = await link(r, store, 2500);
    const text = svc.rioLinkMessage(out, '');
    assert.match(text, re, label);
    if (label !== 'vanished') assert.match(text, /reine Anzeige-Rollen ohne Rechte/, label);
    assert.equal(out.kind, label === 'vanished' ? 'role-missing' : 'role-unsafe', label);
    assert.deepEqual(r.log, [], `${label}: no role call`);
    assert.equal(store.rows.size, 0, `${label}: no mapping`);
    assert.doesNotMatch(text, /Administrator|ManageGuild/, 'members do not get the permission list');
  }
  // the member already holds the (now dangerous) target: still refused, the previous bot role stays untouched
  const store = new MemStore();
  store.upsert({ guildId: GUILD, userId: USER, characterName: 'Anna', realm: 'Blackrock', region: 'eu', lastScore: 1100, lastRoleId: R1, updatedAt: 1 });
  const held = rig({ held: [R1, R2], roles: { [R2]: { permissions: String(PermissionFlagsBits.BanMembers) } } });
  const out = await link(held, store, 2500);
  assert.equal(out.kind, 'role-unsafe');
  assert.deepEqual(held.log, []);
  assert.equal(store.get(GUILD, USER)?.lastRoleId, R1);
  assert.equal(store.get(GUILD, USER)?.lastScore, 1100);
  // a harmless role in the same setup works (positive control)
  const fine = await link(rig({ held: [R1] }), new MemStore(), 2500);
  assert.equal(fine.kind, 'linked');
});

test('(c) end to end: /rio-link with a tier role that became dangerous answers ephemeral and assigns nothing', async () => {
  const was = config.RIO_ROLE_THRESHOLDS;
  const realFetch = globalThis.fetch;
  config.RIO_ROLE_THRESHOLDS = pure.serializeRioThresholds(TIERS);
  globalThis.fetch = (async () => json(200, profile(2100))) as unknown as typeof fetch;
  try {
    const r = rig({ roles: { [R2]: { permissions: String(PermissionFlagsBits.ModerateMembers) } } });
    const a = fakeInteraction({ guild: r.guild }, { charakter: 'Anna', realm: 'Blackrock', region: 'eu' });
    await rioLinkCommand.execute(a.i);
    assert.match(String(a.replies[1]!.content), /vergebe ich nicht/);
    assert.deepEqual((a.replies[1]!.allowedMentions as { parse: unknown[] }).parse, []);
    assert.deepEqual(r.log, []);
    assert.equal(svc.rioSqliteStore.get(GUILD, USER), null);
  } finally {
    globalThis.fetch = realFetch;
    config.RIO_ROLE_THRESHOLDS = was;
    sqliteHandle.prepare('DELETE FROM rio_link').run();
  }
});

test('wiring: the startup audit runs on clientReady', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/discord/client.ts', import.meta.url), 'utf8');
  assert.match(src, /c\.once\('clientReady'[\s\S]{0,200}auditRioTiers/);
});

// ─── Finding 3: tracking survives a failed removal ─────────────────────────────

test('link: if the old bot role cannot be removed, tracking keeps pointing at it, the new role is withheld, and the next link retries and then tracks the new one', async () => {
  const store = new MemStore();
  store.upsert({ guildId: GUILD, userId: USER, characterName: 'Anna', realm: 'Blackrock', region: 'eu', lastScore: 1100, lastRoleId: R1, updatedAt: 1 });
  const broken = rig({ held: [R1], removeError: 50_013 });
  const out = await link(broken, store, 2500);
  assert.equal(out.kind, 'linked');
  assert.deepEqual(out.kind === 'linked' && [out.removeFailed, out.added, out.addSkipped], [true, false, true]);
  assert.deepEqual([...broken.held], [R1], 'nothing changed on the member');
  assert.equal(store.get(GUILD, USER)?.lastRoleId, R1, 'tracking still points at the role the bot gave');
  assert.equal(store.get(GUILD, USER)?.lastScore, 2500, 'the score itself is stored');
  const text = svc.rioLinkMessage(out, '');
  assert.match(text, /nicht entfernt werden/);
  assert.match(text, /erst, wenn die bisherige Score-Rolle entfernt/);
  assert.doesNotMatch(text, /bereits|bekommen/);

  // later (removal works again): the retry removes R1, adds R2 and now tracks R2
  const healthy = rig({ held: [R1] });
  const again = await link(healthy, store, 2500);
  assert.equal(again.kind === 'linked' && again.removedRoleId, R1);
  assert.deepEqual([...healthy.held].sort(), [R2]);
  assert.equal(store.get(GUILD, USER)?.lastRoleId, R2);

  // unlink after a failed removal still knows the role to take away
  const store2 = new MemStore();
  store2.upsert({ guildId: GUILD, userId: USER, characterName: 'Anna', realm: 'Blackrock', region: 'eu', lastScore: 1100, lastRoleId: R1, updatedAt: 1 });
  const stuck = rig({ held: [R1], removeError: 50_013 });
  await link(stuck, store2, 2500);
  const ok = rig({ held: [R1] });
  const un = await svc.unlinkRioCharacter({ guild: ok.guild as never, userId: USER, store: store2 });
  assert.equal(un.kind === 'unlinked' && un.removedRoleId, R1);

  // score drops below the lowest tier while the removal fails: tracking is kept, nothing is dropped from the member
  const store3 = new MemStore();
  store3.upsert({ guildId: GUILD, userId: USER, characterName: 'Anna', realm: 'Blackrock', region: 'eu', lastScore: 1100, lastRoleId: R1, updatedAt: 1 });
  const down = rig({ held: [R1], removeError: 50_013 });
  await link(down, store3, 10);
  assert.equal(store3.get(GUILD, USER)?.lastRoleId, R1);
  // a successful removal with nothing to add clears the tracking (as before)
  const fine = rig({ held: [R1] });
  await link(fine, store3, 10);
  assert.equal(store3.get(GUILD, USER)?.lastRoleId, null);
});

// ─── Finding 4: the global ceiling queues briefly instead of locking users out ──

test('client: a full window waits for the slot when it opens within a few seconds (no hard rejection), longer waits answer rate-limited with the real wait', async () => {
  let t = 20_000_000;
  const f = fakeFetch(() => json(200, profile(1)));
  const sleeps: number[] = [];
  const deps = { fetchFn: f.fn, now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; } };
  const name = (i: number) => `Name${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`;
  // fill the window: the first call at t, the rest 1 s later, so the oldest slot frees up in 59 s... then shrink: use a window where it frees in 2 s
  await client.fetchRioScore({ ...INPUT, name: name(0) }, deps);
  t += client.RIO_GLOBAL_WINDOW_MS - 2_000; // the first call leaves the window in 2 s
  for (let i = 1; i < client.RIO_GLOBAL_LIMIT; i += 1) assert.equal((await client.fetchRioScore({ ...INPUT, name: name(i) }, deps)).ok, true);
  assert.equal(f.calls.length, client.RIO_GLOBAL_LIMIT);
  const queued = await client.fetchRioScore({ ...INPUT, name: 'Zzzz' }, deps);
  assert.equal(queued.ok, true, 'waited 2 s instead of being turned away');
  assert.deepEqual(sleeps, [2_000]);
  assert.equal(f.calls.length, client.RIO_GLOBAL_LIMIT + 1);

  // the next slot is far away: no waiting, a clear rate-limited answer with the real seconds
  sleeps.length = 0;
  for (let i = 0; i < client.RIO_GLOBAL_LIMIT; i += 1) await client.fetchRioScore({ ...INPUT, name: `Fill${name(i)}` }, deps);
  const far = await client.fetchRioScore({ ...INPUT, name: 'Yyyy' }, { ...deps, now: () => t });
  assert.equal(far.ok, false);
  assert.equal(far.ok ? null : far.kind, 'rate-limited');
  assert.ok((far as { retryAfterSec: number }).retryAfterSec > 3);
  assert.deepEqual(sleeps.filter((ms) => ms > client.RIO_MAX_QUEUE_WAIT_MS), [], 'never sleeps longer than the cap');
});

test('client: queue extras - a cached answer arriving while waiting wins, the waiter list is capped, Retry-After <= cap waits, longer is reported', async () => {
  // Retry-After 2 s: the next call waits it out and succeeds; Retry-After 120 s: reported at once, no sleep
  let t = 30_000_000;
  const sleeps: number[] = [];
  const base = { now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; } };
  const blockedFetch = fakeFetch(() => json(429, {}, { 'retry-after': '2' }));
  const first = await client.fetchRioScore(INPUT, { ...base, fetchFn: blockedFetch.fn });
  assert.deepEqual(first, { ok: false, kind: 'rate-limited', retryAfterSec: 2 });
  const okFetch = fakeFetch(() => json(200, profile(5)));
  const retried = await client.fetchRioScore({ ...INPUT, name: 'Bella' }, { ...base, fetchFn: okFetch.fn });
  assert.equal(retried.ok, true, 'a 2 s Retry-After is waited out');
  assert.deepEqual(sleeps, [2_000]);

  client.resetRioClient();
  sleeps.length = 0;
  const long = fakeFetch(() => json(429, {}, { 'retry-after': '120' }));
  await client.fetchRioScore(INPUT, { ...base, fetchFn: long.fn });
  const rej = await client.fetchRioScore({ ...INPUT, name: 'Cora' }, { ...base, fetchFn: okFetch.fn });
  assert.deepEqual(rej.ok ? null : [rej.kind, (rej as { retryAfterSec: number }).retryAfterSec], ['rate-limited', 120]);
  assert.deepEqual(sleeps, [], 'no sleep for a long block');

  // cached while waiting: the same character is filled by the first waiter, the second takes the cache (one fetch only)
  client.resetRioClient();
  t = 40_000_000;
  const gate: Array<() => void> = [];
  const f2 = fakeFetch(() => json(200, profile(7)));
  const slow = { fetchFn: f2.fn, now: () => t, sleep: () => new Promise<void>((resolve) => { gate.push(() => { t += 2_000; resolve(); }); }) };
  const fillName = (i: number) => `Fill${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`;
  await client.fetchRioScore({ ...INPUT, name: 'Seed' }, slow);
  t += client.RIO_GLOBAL_WINDOW_MS - 2_000;
  for (let i = 1; i < client.RIO_GLOBAL_LIMIT; i += 1) await client.fetchRioScore({ ...INPUT, name: fillName(i) }, slow);
  const a = client.fetchRioScore({ ...INPUT, name: 'Same' }, slow);
  const b = client.fetchRioScore({ ...INPUT, name: 'Same' }, slow);
  await new Promise((r) => setImmediate(r));
  assert.equal(gate.length, 2, 'both wait for the slot');
  const callsBefore = f2.calls.length;
  gate[0]!();
  const ra = await a; // the first waiter fetches and fills the cache
  gate[1]!();
  const rb = await b; // the second one re-checks the cache after waking up: no slot needed
  assert.deepEqual([ra.ok, rb.ok], [true, true]);
  assert.equal(f2.calls.length, callsBefore + 1, 'the second waiter was served from the cache filled by the first');

  // waiter cap: more than RIO_MAX_WAITERS simultaneous waiters -> the surplus is told to retry
  client.resetRioClient();
  t = 50_000_000;
  gate.length = 0;
  await client.fetchRioScore({ ...INPUT, name: 'Seed' }, slow);
  t += client.RIO_GLOBAL_WINDOW_MS - 2_000;
  for (let i = 1; i < client.RIO_GLOBAL_LIMIT; i += 1) await client.fetchRioScore({ ...INPUT, name: fillName(i) }, slow);
  const pending = Array.from({ length: client.RIO_MAX_WAITERS + 3 }, (_, i) => client.fetchRioScore({ ...INPUT, name: `Wait${String.fromCharCode(97 + i)}${String.fromCharCode(97 + i)}` }, slow));
  await new Promise((r) => setImmediate(r));
  assert.equal(gate.length, client.RIO_MAX_WAITERS, 'only the cap waits');
  gate.forEach((open) => open());
  const results = await Promise.all(pending);
  assert.equal(results.filter((r) => !r.ok && r.kind === 'rate-limited').length >= 3, true, 'the surplus got rate-limited');
});

// ─── Finding 7: untrusted text is inert, rounding is consistent ─────────────────

test('link message: API name/realm/season and the admin season label cannot inject markdown or mentions', async () => {
  const evil = '**x** [a](https://evil.example) <@123456789012345678> @everyone <#1234567890> `c` ||s|| ~~t~~';
  const out = {
    kind: 'linked' as const, score: 2500, season: evil, name: evil, realm: evil, region: 'eu', profileUrl: null,
    roleId: R2, added: true, removedRoleId: null, removeFailed: false, addSkipped: false, nextTier: null,
  };
  for (const label of ['', evil]) {
    const text = svc.rioLinkMessage(out, label);
    const first = text.split('\n')[0]!;
    assert.ok(!/(^|[^\\])\*\*x\*\*/.test(first.replace(/^✅ \*\*/, '')), 'bold not injectable');
    for (const raw of ['[a](https://evil.example)', '<@123456789012345678>', '<#1234567890>', '`c`', '||s||', '~~t~~']) {
      assert.ok(!first.includes(raw), `${raw} is escaped`);
    }
    assert.ok(first.includes('\\<\\@123456789012345678>') || first.includes('\\<\\@'), 'mention syntax escaped');
    assert.ok(text.includes(`<@&${R2}>`), 'our own role mention stays real');
  }
  assert.match(svc.rioLinkMessage(out, ''), /nicht verifiziert/);
  // the hierarchy message escapes a hostile role name too
  const hier = svc.rioLinkMessage({ kind: 'role-hierarchy', roleId: R2, roleName: '**@everyone** [x](y)' }, '');
  assert.ok(!hier.includes('[x](y)') && !hier.includes('**@everyone**'));
  assert.equal(pure.rioText('a\nb\u200bc  d', 10), 'a b c d');
  assert.ok(Array.from(pure.rioText('x'.repeat(200), 20).replace(/\\/g, '')).length <= 20);
});

test('/rio-config: season label is escaped in every reply; entfernen finds thresholds with the same rounding as setzen', async () => {
  const was = config.RIO_ROLE_THRESHOLDS;
  try {
    config.RIO_ROLE_THRESHOLDS = '';
    svc.resetRioConfig();
    const evil = '**Boss** <@123456789012345678> [x](http://e)';
    const season = fakeInteraction({}, { label: evil }, 'season');
    await rioConfigCommand.execute(season.i);
    const r1 = String(season.replies[0]!.content);
    assert.ok(!r1.includes('<@123456789012345678>') && !r1.includes('[x](http://e)'));
    assert.ok(!r1.includes('**Boss**'));
    const show = fakeInteraction({}, {}, 'anzeigen');
    await rioConfigCommand.execute(show.i);
    const r2 = String(show.replies[0]!.content);
    assert.ok(!r2.includes('<@123456789012345678>') && !r2.includes('[x](http://e)'));

    // setzen 1234.56 stores 1234.6; entfernen with 1234.56 and 1234.6 both find it
    const set = fakeInteraction({}, { score: 1234.56 }, 'setzen');
    (set.i as unknown as { options: { getRole: () => unknown } }).options.getRole = () => ({ id: R1, managed: false, editable: true, permissions: '0' });
    await rioConfigCommand.execute(set.i);
    assert.deepEqual(svc.getRioTiers().tiers, [{ minScore: 1234.6, roleId: R1 }]);
    assert.match(String(set.replies[0]!.content), /Ab 1234\.6 Punkten/);
    const rm = fakeInteraction({}, { score: 1234.56 }, 'entfernen');
    await rioConfigCommand.execute(rm.i);
    assert.match(String(rm.replies[0]!.content), /Schwelle 1234\.6 entfernt/);
    assert.deepEqual(svc.getRioTiers().tiers, []);
    const set2 = fakeInteraction({}, { score: 1234.6 }, 'setzen');
    (set2.i as unknown as { options: { getRole: () => unknown } }).options.getRole = () => ({ id: R1, managed: false, editable: true, permissions: '0' });
    await rioConfigCommand.execute(set2.i);
    const rm2 = fakeInteraction({}, { score: 1234.6 }, 'entfernen');
    await rioConfigCommand.execute(rm2.i);
    assert.deepEqual(svc.getRioTiers().tiers, []);
  } finally {
    config.RIO_ROLE_THRESHOLDS = was;
    svc.resetRioConfig();
  }
});

// ─── Finding 2: no verification, display-only roles - said in the command text ──

test('docs in the product: /rio-link says it is unverified and the role carries no rights (command description + every success reply)', () => {
  const desc = (commands.get('rio-link')!.data.toJSON() as { description: string }).description;
  assert.match(desc, /nicht verifiziert/);
  assert.match(desc, /ohne Rechte/);
  assert.ok(desc.length <= 100, 'within the Discord limit');
  assert.equal(svc.RIO_DISCLAIMER.includes('nicht verifiziert') && svc.RIO_DISCLAIMER.includes('ohne Rechte'), true);
});
