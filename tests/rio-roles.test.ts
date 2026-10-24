import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { PermissionFlagsBits } from 'discord.js';

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

interface FakeRole { id: string; name: string; managed: boolean; editable: boolean }
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
        return { id, name: `Rolle-${id.slice(-1)}`, managed: false, editable: true, ...(opts.roles?.[id] ?? {}) } as FakeRole;
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
    (set.i as unknown as { options: { getRole: () => unknown } }).options.getRole = () => ({ id: R1, managed: false, editable: true });
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
