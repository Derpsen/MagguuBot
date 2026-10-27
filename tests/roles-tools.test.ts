import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { CHANNEL, ROLE, STRUCTURE } from '../src/discord/server-layout.js';
import { DiscordError } from '../src/rollout/rest.js';
import { buildBackup, parseBackup, snapshotFromBackup, verifyFreshBackup, writeBackup, fileMode } from '../src/rollout/roles-backup.js';
import { checkInvariants, executeSteps, guardedUsers } from '../src/rollout/roles-effects.js';
import { buildInventory, formatInventory } from '../src/rollout/roles-inventory.js';
import { P, canView, channelPermissions, cloneSnapshot, sha256, stateFingerprint, type ChannelRec, type RoleRec, type RolesSnapshot } from '../src/rollout/roles-model.js';
import { DEFAULT_EVERYONE_REMOVE, defaultRolesPlan, formatApplyPlan, parseRolesPlan, planRolesApply, type RolesPlan } from '../src/rollout/roles-plan.js';
import { emptyRefs } from '../src/rollout/roles-refs.js';
import { formatRestorePlan, planRestore } from '../src/rollout/roles-restore.js';
import { takeRolesSnapshot } from '../src/rollout/roles-snapshot.js';

// ─── Fixture: a small guild + a stateful fake REST (records every write) ───
const G = '1400000000000000001';
const OWNER = '1400000000000000002';
const BOT = '1400000000000000003';
const ADMIN_USER = '1400000000000000004';
const MOD_USER = '1400000000000000005';
const NEWBIE = '1400000000000000006';
const REG_USER = '1400000000000000007';
const VIP_USERS = ['1400000000000000011', '1400000000000000012', '1400000000000000013'];
const FAN_USERS = Array.from({ length: 30 }, (_, i) => `14000000000001${String(i).padStart(5, '0')}`);
const ALL_USER_IDS = [OWNER, BOT, ADMIN_USER, MOD_USER, NEWBIE, REG_USER, ...VIP_USERS, ...FAN_USERS];

const rid = (n: number): string => `15000000000000${String(n).padStart(5, '0')}`;
const R = { admin: rid(1), mod: rid(2), plex: rid(3), regular: rid(4), newcomer: rid(5), vip: rid(6), fan: rid(7), movies: rid(8), unused: rid(9), refd: rid(10), boost: rid(11), botRole: rid(12) };
const CH = { cat: '1600000000000000001', welcome: '1600000000000000002', logs: '1600000000000000003', plexAct: '1600000000000000004', chat: '1600000000000000005' };

const VIEW_BITS = P.VIEW_CHANNEL | P.SEND_MESSAGES | P.EMBED_LINKS | P.READ_MESSAGE_HISTORY | P.ADD_REACTIONS;
function role(id: string, name: string, position: number, permissions: bigint, extra: Partial<RoleRec> = {}): RoleRec {
  return { id, name, position, color: 0, hoist: false, mentionable: false, permissions: permissions.toString(), managed: false, flags: 0, unicodeEmoji: null, tags: null, ...extra };
}
function ch(id: string, name: string, parentId: string | null, overwrites: ChannelRec['overwrites'] = [], type = 0): ChannelRec {
  return { id, name, type, parentId, position: 0, overwrites };
}

function fixture(): RolesSnapshot {
  const members: Record<string, string[]> = {
    [OWNER]: [], [BOT]: [R.botRole], [ADMIN_USER]: [R.admin], [MOD_USER]: [R.mod], [NEWBIE]: [R.newcomer], [REG_USER]: [R.regular, R.plex],
  };
  for (const u of VIP_USERS) members[u] = [R.vip];
  for (const u of FAN_USERS) members[u] = [R.fan];
  return {
    guildId: G, ownerId: OWNER, botUserId: BOT, botHighestRolePosition: 20,
    roles: [
      role(G, '@everyone', 0, VIEW_BITS | P.MENTION_EVERYONE | P.MANAGE_MESSAGES),
      role(R.admin, ROLE.admin, 18, P.ADMINISTRATOR),
      role(R.mod, ROLE.moderator, 17, P.MANAGE_MESSAGES | P.KICK_MEMBERS),
      role(R.plex, ROLE.plexUser, 9, 0n),
      role(R.regular, ROLE.regular, 8, 0n),
      role(R.newcomer, ROLE.newcomer, 7, 0n),
      role(R.vip, 'VIP', 6, 0n),
      role(R.fan, 'Plex-Fan', 5, 0n),
      role(R.movies, ROLE.pingMovies, 4, 0n),
      role(R.unused, 'Unnütz', 3, 0n),
      role(R.refd, 'Referenziert', 2, 0n),
      role(R.boost, 'Server Booster', 1, 0n, { managed: true, tags: { premiumSubscriber: true } }),
      role(R.botRole, 'MagguuBot', 20, VIEW_BITS | P.MANAGE_MESSAGES, { managed: true, tags: { botId: BOT } }),
    ],
    channels: [
      ch(CH.cat, '🏠 START', null, [], 4),
      ch(CH.welcome, CHANNEL.welcome, CH.cat),
      ch(CH.logs, CHANNEL.logs, CH.cat),
      ch(CH.plexAct, CHANNEL.plexActivity, CH.cat, [{ id: R.plex, type: 0, allow: P.VIEW_CHANNEL.toString(), deny: '0' }]),
      ch(CH.chat, CHANNEL.chat, CH.cat),
    ],
    members, notes: [], missingKnownChannels: 0,
  };
}

function refsFor(extraIds: string[] = []) {
  const refs = emptyRefs();
  for (const c of [CH.welcome, CH.logs, CH.plexAct, CH.chat]) refs.channelIds.add(c);
  refs.ids.set(R.refd, ['bot_settings.autoRoleId']);
  for (const id of extraIds) refs.ids.set(id, ['test']);
  return refs;
}

const PLAN: RolesPlan = parseRolesPlan(JSON.stringify({
  version: 1,
  everyone: { remove: ['MENTION_EVERYONE', 'MANAGE_MESSAGES'] },
  merge: [{ from: 'VIP', into: ROLE.regular }, { from: 'Plex-Fan', into: ROLE.pingMovies }],
  delete: ['Unnütz', 'Referenziert', 'Server Booster', 'MagguuBot', ROLE.moderator],
  visibility: { staffRoles: [ROLE.admin, ROLE.moderator], staffOnlyChannels: [CHANNEL.logs, CHANNEL.plexActivity] },
}));

class FakeRest {
  writes: Array<{ method: string; path: string }> = [];
  failAt: number | null = null;
  failStatus = 403;
  nextRole = 9000;
  constructor(public snap: RolesSnapshot) {}
  async request<T>(method: string, path: string, body?: unknown, ok: number[] = []): Promise<T | null> {
    const s = this.snap;
    if (method === 'GET') {
      if (path === '/users/@me') return { id: s.botUserId } as T;
      if (path === `/guilds/${s.guildId}`) return { owner_id: s.ownerId } as T;
      if (path === `/guilds/${s.guildId}/roles`) return s.roles.map((r) => ({ ...r, tags: r.tags ? { ...(r.tags.botId ? { bot_id: r.tags.botId } : {}), ...(r.tags.premiumSubscriber ? { premium_subscriber: null } : {}) } : null })) as T;
      if (path === `/guilds/${s.guildId}/channels`) return s.channels.map((c) => ({ id: c.id, name: c.name, type: c.type, parent_id: c.parentId, position: c.position, permission_overwrites: c.overwrites })) as T;
      if (path.startsWith(`/guilds/${s.guildId}/members?`)) {
        if (!s.members) throw new DiscordError('GET', path, 403, '');
        return Object.entries(s.members).map(([id, roles]) => ({ user: { id }, roles })) as T;
      }
      throw new Error(`unexpected GET ${path}`);
    }
    this.writes.push({ method, path });
    if (this.failAt !== null && this.writes.length === this.failAt) {
      if (ok.includes(this.failStatus)) return null;
      throw new DiscordError(method, path, this.failStatus, '');
    }
    const roleM = /^\/guilds\/\d+\/roles\/(\d+)$/.exec(path);
    const owM = /^\/channels\/(\d+)\/permissions\/(\d+)$/.exec(path);
    const memM = /^\/guilds\/\d+\/members\/(\d+)\/roles\/(\d+)$/.exec(path);
    const b = body as Record<string, unknown> | undefined;
    if (roleM && method === 'PATCH') Object.assign(s.roles.find((r) => r.id === roleM[1]) as RoleRec, b);
    else if (roleM && method === 'DELETE') {
      if (!s.roles.some((r) => r.id === roleM[1])) { if (ok.includes(404)) return null; throw new DiscordError(method, path, 404, ''); }
      s.roles = s.roles.filter((r) => r.id !== roleM[1]);
      for (const m of Object.keys(s.members ?? {})) (s.members as Record<string, string[]>)[m] = (s.members as Record<string, string[]>)[m]!.filter((x) => x !== roleM[1]);
      for (const c of s.channels) c.overwrites = c.overwrites.filter((o) => o.id !== roleM[1]);
    } else if (path === `/guilds/${s.guildId}/roles` && method === 'POST') {
      const id = rid(++this.nextRole);
      s.roles.push(role(id, String(b?.name), 1, BigInt(String(b?.permissions)), { color: Number(b?.color), hoist: Boolean(b?.hoist), mentionable: Boolean(b?.mentionable) }));
      return { id } as T;
    } else if (path === `/guilds/${s.guildId}/roles` && method === 'PATCH') {
      for (const it of b as unknown as Array<{ id: string; position: number }>) (s.roles.find((r) => r.id === it.id) as RoleRec).position = it.position;
    } else if (owM) {
      const c = s.channels.find((x) => x.id === owM[1]) as ChannelRec;
      c.overwrites = c.overwrites.filter((o) => o.id !== owM[2]);
      if (method === 'PUT') c.overwrites.push({ id: owM[2] as string, type: Number(b?.type) as 0 | 1, allow: String(b?.allow), deny: String(b?.deny) });
    } else if (memM && method === 'PUT') {
      const list = (s.members as Record<string, string[]>)[memM[1] as string] as string[];
      if (!list.includes(memM[2] as string)) list.push(memM[2] as string);
    } else throw new Error(`unexpected ${method} ${path}`);
    return null;
  }
}

const NOW = Date.parse('2026-10-27T12:00:00Z');
const ctxOf = (snap: RolesSnapshot, refs = refsFor()) => ({ guardedUserIds: guardedUsers(snap, ['Admin', 'Moderator'], []), postingChannelIds: refs.channelIds });
const stepsOf = (p: { steps: Array<{ effect: { t: string } }> }, t: string) => p.steps.filter((s) => s.effect.t === t);

// ─── Plan: happy path ─────────────────────────────────────────────────────
test('plan: merge small role, delete empty unused role, @everyone minimal, staff-only channels – and nothing else', () => {
  const snap = fixture();
  const plan = planRolesApply(snap, PLAN, refsFor());
  assert.deepEqual(plan.violations, []);
  const deleted = stepsOf(plan, 'roleDelete').map((s) => (s.effect as { id: string }).id).sort();
  assert.deepEqual(deleted, [R.unused, R.vip].sort());
  assert.equal(stepsOf(plan, 'memberAddRole').length, VIP_USERS.length);
  const everyone = plan.after.roles.find((r) => r.id === G) as RoleRec;
  assert.equal(BigInt(everyone.permissions) & (P.MENTION_EVERYONE | P.MANAGE_MESSAGES), 0n);
  assert.ok((BigInt(everyone.permissions) & P.VIEW_CHANNEL) !== 0n, 'only the whitelisted dangerous bits go');
  for (const id of [CH.logs, CH.plexAct]) {
    const c = plan.after.channels.find((x) => x.id === id) as ChannelRec;
    assert.equal(canView(plan.after, c, NEWBIE), false);
    assert.equal(canView(plan.after, c, REG_USER), false, 'Plex-User loses the activity channel');
    assert.equal(canView(plan.after, c, MOD_USER), true);
    assert.equal(canView(plan.after, c, ADMIN_USER), true);
    assert.equal(canView(plan.after, c, OWNER), true);
    assert.equal(canView(plan.after, c, BOT), true);
  }
  assert.equal(canView(plan.after, plan.after.channels.find((x) => x.id === CH.chat) as ChannelRec, NEWBIE), true, 'normal user still sees chat');
});

test('dry-run: planning and snapshotting send no write at all', async () => {
  const rest = new FakeRest(fixture());
  const snap = await takeRolesSnapshot(rest, G, [CH.logs]);
  planRolesApply(snap, PLAN, refsFor());
  planRestore(snapshotFromBackup(buildBackup(snap, new Date(NOW))), snap, refsFor().channelIds);
  assert.deepEqual(rest.writes, []);
  assert.equal(snap.members?.[ADMIN_USER]?.[0], R.admin);
});

// ─── Gate counter-probes ──────────────────────────────────────────────────
test('gate managed: managed roles are never deleted/changed (also not by name in a plan)', () => {
  const plan = planRolesApply(fixture(), PLAN, refsFor());
  assert.ok(plan.skipped.some((s) => s.label === 'Server Booster' && s.category === 'managed'));
  assert.ok(plan.skipped.some((s) => s.label === 'MagguuBot' && (s.category === 'managed' || s.category === 'geschützt')));
  for (const s of plan.steps) {
    const e = s.effect as { id?: string };
    assert.notEqual(e.id, R.boost);
    assert.notEqual(e.id, R.botRole);
  }
});

test('gate reference: a role the bot refers to (id or name) is neither deleted nor merged away', () => {
  const plan = planRolesApply(fixture(), PLAN, refsFor());
  assert.ok(plan.skipped.some((s) => s.label === 'Referenziert' && s.category === 'referenziert'));
  assert.ok(!stepsOf(plan, 'roleDelete').some((s) => (s.effect as { id: string }).id === R.refd));
  const byName = refsFor();
  byName.names.set('VIP', ['XP-Rang']);
  const p2 = planRolesApply(fixture(), PLAN, byName);
  assert.ok(p2.skipped.some((s) => s.label.startsWith('VIP') && s.category === 'referenziert'));
  assert.ok(!stepsOf(p2, 'roleDelete').some((s) => (s.effect as { id: string }).id === R.vip));
  const byId = refsFor([R.unused]);
  assert.ok(!stepsOf(planRolesApply(fixture(), PLAN, byId), 'roleDelete').some((s) => (s.effect as { id: string }).id === R.unused));
});

test('gate member limit: 30 holders > 25 are listed, not merged; a higher explicit limit merges', () => {
  const plan = planRolesApply(fixture(), PLAN, refsFor());
  const skip = plan.skipped.find((s) => s.label.startsWith('Plex-Fan'));
  assert.equal(skip?.category, 'mitglieder-limit');
  assert.equal(skip?.count, 30);
  assert.ok(!stepsOf(plan, 'roleDelete').some((s) => (s.effect as { id: string }).id === R.fan));
  const big = planRolesApply(fixture(), { ...PLAN, maxMembers: 40 }, refsFor());
  assert.ok(stepsOf(big, 'roleDelete').some((s) => (s.effect as { id: string }).id === R.fan));
  assert.equal(stepsOf(big, 'memberAddRole').length, VIP_USERS.length + FAN_USERS.length);
});

test('gate permission loss: a merge that would take permissions or channel views from members is refused', () => {
  const snap = fixture();
  (snap.roles.find((r) => r.id === R.vip) as RoleRec).permissions = P.ATTACH_FILES.toString();
  const plan = planRolesApply(snap, PLAN, refsFor());
  const skip = plan.skipped.find((s) => s.label.startsWith('VIP'));
  assert.equal(skip?.category, 'rechteverlust');
  assert.match(skip?.reason ?? '', /ATTACH_FILES/);
  assert.ok(!stepsOf(plan, 'roleDelete').some((s) => (s.effect as { id: string }).id === R.vip));
});

test('gate non-empty / in use: delete only empty AND unused roles', () => {
  const plan = planRolesApply(fixture(), PLAN, refsFor());
  assert.ok(plan.skipped.some((s) => s.label === ROLE.moderator && (s.category === 'geschützt' || s.category === 'nicht-leer')));
  const snap = fixture();
  (snap.channels.find((c) => c.id === CH.chat) as ChannelRec).overwrites.push({ id: R.unused, type: 0, allow: P.VIEW_CHANNEL.toString(), deny: '0' });
  const p2 = planRolesApply(snap, PLAN, refsFor());
  assert.ok(p2.skipped.some((s) => s.label === 'Unnütz' && s.category === 'in-benutzung'));
  assert.ok(!stepsOf(p2, 'roleDelete').some((s) => (s.effect as { id: string }).id === R.unused));
});

test('gate owner/admin/mod access: staff-only never locks out a protected member', () => {
  const protectedUser = REG_USER;
  const plan = planRolesApply(fixture(), PLAN, refsFor(), { protectedUserIds: [protectedUser] });
  // REG_USER may only see the Plex activity channel through the Plex-User role: the plan must refuse that channel.
  assert.ok(plan.skipped.some((s) => s.category === 'geschützt' && s.label.includes('plex')), 'role of a protected user keeps its view, listed');
  const c = plan.after.channels.find((x) => x.id === CH.plexAct) as ChannelRec;
  assert.equal(canView(plan.after, c, protectedUser), true);
  assert.deepEqual(plan.violations, []);
});

test('gate bot access: the bot keeps View/Send/Embed/History in every posting channel; a bot already locked out blocks the run', () => {
  const plan = planRolesApply(fixture(), PLAN, refsFor());
  for (const id of [CH.welcome, CH.logs, CH.plexAct, CH.chat]) {
    const c = plan.after.channels.find((x) => x.id === id) as ChannelRec;
    const need = P.VIEW_CHANNEL | P.SEND_MESSAGES | P.EMBED_LINKS | P.READ_MESSAGE_HISTORY;
    assert.equal(channelPermissions(plan.after, c, BOT) & need, need, c.name);
  }
  const broken = fixture();
  (broken.channels.find((c) => c.id === CH.logs) as ChannelRec).overwrites.push({ id: BOT, type: 1, allow: '0', deny: P.SEND_MESSAGES.toString() });
  const p2 = planRolesApply(broken, PLAN, refsFor());
  assert.ok(p2.violations.some((v) => v.includes('VOR dem Lauf') && v.includes('logs')), p2.violations.join('|'));
  // and the generic checker catches a successor state that removes the bot's view
  const bad = cloneSnapshot(fixture());
  (bad.channels.find((c) => c.id === CH.chat) as ChannelRec).overwrites.push({ id: BOT, type: 1, allow: '0', deny: P.VIEW_CHANNEL.toString() });
  assert.ok(checkInvariants(fixture(), bad, ctxOf(fixture())).some((v) => v.includes('Bot')));
});

test('gate over bot role: roles at/above the bot role are not touched', () => {
  const snap = fixture();
  snap.botHighestRolePosition = 2;
  const plan = planRolesApply(snap, PLAN, refsFor());
  assert.ok(plan.skipped.some((s) => s.category === 'über-bot-rolle'));
  for (const s of plan.steps) if (s.effect.t === 'roleDelete') assert.ok((snap.roles.find((r) => r.id === (s.effect as { id: string }).id) as RoleRec).position < 2);
});

test('gate incomplete picture: unreadable members or channels missing from the list (2026-11-16) are violations', () => {
  const noMembers = { ...fixture(), members: null };
  assert.ok(planRolesApply(noMembers, PLAN, refsFor()).violations.length > 0);
  const missing = { ...fixture(), missingKnownChannels: 2 };
  assert.ok(planRolesApply(missing, PLAN, refsFor()).violations.some((v) => v.includes('Kanal-ID')));
  assert.deepEqual(planRolesApply(fixture(), PLAN, refsFor()).violations, []);
});

test('gate @everyone whitelist: only dangerous bits (and invites) may be removed, everything else is refused', () => {
  assert.throws(() => parseRolesPlan(JSON.stringify({ ...PLAN, everyone: { remove: ['VIEW_CHANNEL'] } })));
  assert.throws(() => parseRolesPlan('{"version":1,"unbekannt":1,"visibility":{"staffRoles":["Admin"]}}'));
  assert.doesNotThrow(() => parseRolesPlan(JSON.stringify({ ...PLAN, everyone: { remove: ['ADMINISTRATOR', 'CREATE_INSTANT_INVITE'] } })));
  assert.ok(!(DEFAULT_EVERYONE_REMOVE as readonly string[]).includes('CREATE_INSTANT_INVITE'));
});

test('default plan follows the layout: staff-only = approvals/status/logs/plex-aktivität, merges from mergeFrom', () => {
  const plan = defaultRolesPlan();
  for (const n of [CHANNEL.approvals, CHANNEL.status, CHANNEL.logs, CHANNEL.plexActivity]) assert.ok(plan.visibility.staffOnlyChannels.includes(n), n);
  assert.ok(!plan.visibility.staffOnlyChannels.includes(CHANNEL.chat));
  assert.ok(plan.merge.some((m) => m.from === 'VIP' && m.into === ROLE.regular));
  assert.ok(STRUCTURE.flatMap((c) => c.channels).find((c) => c.name === CHANNEL.plexActivity)?.adminOnly);
  assert.doesNotThrow(() => parseRolesPlan(JSON.stringify(plan)));
});

// ─── Backup ───────────────────────────────────────────────────────────────
test('backup: file 0600 + sidecar checksum, round trip, tamper detection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'roles-'));
  try {
    const backup = buildBackup(fixture(), new Date(NOW));
    const w = await writeBackup(join(dir, 'x'), backup);
    assert.equal((await fileMode(w.file)).toString(8), '600');
    const text = await readFile(w.file, 'utf8');
    assert.equal((await readFile(`${w.file}.sha256`, 'utf8')).split(' ')[0], sha256(text));
    assert.equal(w.sha256File, sha256(text));
    assert.equal((await stat(join(dir, 'x'))).mode & 0o777, 0o700);
    await assert.rejects(writeBackup(join(dir, 'x'), backup), 'never overwrite an existing backup');
    const ok = parseBackup(text);
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.backup?.members?.[ADMIN_USER], [R.admin]);
    assert.equal(parseBackup(text.replace('Unnütz', 'Geändert')).ok, false);
    await writeFile(join(dir, 'bad.json'), '{kaputt', { mode: 0o600 });
    assert.equal(parseBackup('{kaputt').ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('backup required for --execute: stale, other guild, changed state, tampered or missing is refused', () => {
  const live = fixture();
  const fresh = parseBackup(JSON.stringify(buildBackup(live, new Date(NOW - 10 * 60_000))));
  assert.deepEqual(verifyFreshBackup(fresh, live, NOW), []);
  assert.ok(verifyFreshBackup(fresh, live, NOW + 2 * 3600_000)[0]?.includes('min alt'));
  assert.ok(verifyFreshBackup(fresh, { ...live, guildId: '1400000000000000999' }, NOW).some((p) => p.includes('Guild')));
  const changed = fixture();
  (changed.roles.find((r) => r.id === R.regular) as RoleRec).name = 'Anders';
  assert.ok(verifyFreshBackup(fresh, changed, NOW).some((p) => p.includes('geändert')));
  assert.ok(verifyFreshBackup(parseBackup(JSON.stringify(buildBackup(live, new Date(NOW))).replace('Unnütz', 'X')), live, NOW).length > 0);
  assert.ok(verifyFreshBackup({ ok: false, problems: ['kein Backup'], backup: null }, live, NOW).length > 0);
  // the member list is not part of the fingerprint: a member joining does not invalidate the backup
  const joined = fixture();
  (joined.members as Record<string, string[]>)['1400000000000000999'] = [];
  assert.equal(stateFingerprint(joined), stateFingerprint(live));
});

// ─── Execution + restore round trip ───────────────────────────────────────
test('executeSteps: stops at the first permanent error, treats 404 on delete as done, prints no ids', async () => {
  const snap = fixture();
  const plan = planRolesApply(snap, PLAN, refsFor());
  const rest = new FakeRest(structuredClone(snap));
  rest.failAt = 2;
  const res = await executeSteps(rest, G, plan.steps);
  assert.equal(res.done, 1);
  assert.equal(res.failed?.status, 403);
  assert.equal(res.notRun, plan.steps.length - 2);
  assert.equal(rest.writes.length, 2, 'nothing after the failure is sent');
  assert.ok(!JSON.stringify(res).match(/\d{17}/), 'no ids in the result');
  const gone = new FakeRest(structuredClone(snap));
  const del = await executeSteps(gone, G, [{ effect: { t: 'roleDelete', id: rid(777) }, label: 'x', phase: 5 }]);
  assert.equal(del.failed, null);
});

test('execute + restore round trip on the fake guild (members and overwrites come back, bot/staff keep access throughout)', async () => {
  const original = fixture();
  const rest = new FakeRest(structuredClone(original));
  const refs = refsFor();
  const live0 = await takeRolesSnapshot(rest, G, [...refs.channelIds]);
  const backup = parseBackup(JSON.stringify(buildBackup(live0, new Date(NOW)))).backup!;
  const plan = planRolesApply(live0, PLAN, refs);
  assert.deepEqual(plan.violations, []);
  const exec = await executeSteps(rest, G, plan.steps);
  assert.equal(exec.failed, null);
  const live1 = await takeRolesSnapshot(rest, G, [...refs.channelIds]);
  assert.deepEqual(checkInvariants(live0, live1, ctxOf(live0, refs)), [], 'post-check on the live result');
  assert.ok(!live1.roles.some((r) => r.name === 'VIP'));
  assert.ok(VIP_USERS.every((u) => live1.members?.[u]?.includes(R.regular)));
  assert.equal(JSON.stringify(live1.roles.map((r) => r.id)).includes(R.boost), true, 'managed role untouched');

  // restore (dry-run first: no write)
  const writesBefore = rest.writes.length;
  const rp = planRestore(snapshotFromBackup(backup), live1, refs.channelIds);
  assert.deepEqual(rp.violations, []);
  assert.equal(rest.writes.length, writesBefore);
  assert.deepEqual(rp.recreated.sort(), ['Unnütz', 'VIP'].sort());
  const rx = await executeSteps(rest, G, rp.steps);
  assert.equal(rx.failed, null);
  const live2 = await takeRolesSnapshot(rest, G, [...refs.channelIds]);
  assert.deepEqual(live2.roles.map((r) => r.name).sort(), original.roles.map((r) => r.name).sort());
  const vip = live2.roles.find((r) => r.name === 'VIP') as RoleRec;
  assert.ok(VIP_USERS.every((u) => live2.members?.[u]?.includes(vip.id)), 'members of the re-created role are re-assigned');
  assert.equal(BigInt((live2.roles.find((r) => r.id === G) as RoleRec).permissions), BigInt((original.roles.find((r) => r.id === G) as RoleRec).permissions));
  for (const c of original.channels) assert.deepEqual(live2.channels.find((x) => x.id === c.id)?.overwrites, c.overwrites, c.name);
  assert.deepEqual(checkInvariants(live1, live2, ctxOf(live1, refs)), []);
  // a second restore plan finds only role-id-bound leftovers (no overwrite/everyone drift)
  const again = planRestore(snapshotFromBackup(backup), live2, refs.channelIds);
  assert.equal(again.counters.overwrites, 0);
  assert.equal(again.counters.rollenNeu, 0);
});

test('restore without deletions gives an identical fingerprint (exact round trip)', async () => {
  const rest = new FakeRest(structuredClone(fixture()));
  const refs = refsFor();
  const live0 = await takeRolesSnapshot(rest, G, [...refs.channelIds]);
  const backup = parseBackup(JSON.stringify(buildBackup(live0, new Date(NOW)))).backup!;
  const only = planRolesApply(live0, { ...PLAN, merge: [], delete: [] }, refs);
  await executeSteps(rest, G, only.steps);
  const live1 = await takeRolesSnapshot(rest, G, [...refs.channelIds]);
  assert.notEqual(stateFingerprint(live1), backup.fingerprint);
  const rp = planRestore(snapshotFromBackup(backup), live1, refs.channelIds);
  await executeSteps(rest, G, rp.steps);
  assert.equal(stateFingerprint(await takeRolesSnapshot(rest, G, [...refs.channelIds])), backup.fingerprint);
});

test('restore gates: managed roles untouched, wrong guild and unreadable members abort, bot/staff access guarded', () => {
  const live = fixture();
  const b = snapshotFromBackup(buildBackup(live, new Date(NOW)));
  (b.roles.find((r) => r.id === R.boost) as RoleRec).permissions = P.ADMINISTRATOR.toString();
  (b.roles.find((r) => r.id === R.botRole) as RoleRec).name = 'Fremd';
  const plan = planRestore(b, live, refsFor().channelIds);
  assert.equal(plan.steps.length, 0, 'managed roles are not restored');
  assert.ok(planRestore({ ...b, guildId: '1400000000000000999' }, live, refsFor().channelIds).violations.some((v) => v.includes('Guild')));
  assert.ok(planRestore(b, { ...live, members: null }, refsFor().channelIds).violations.length > 0);
  // a backup that would take away the bot's posting rights is refused as a whole
  const evil = snapshotFromBackup(buildBackup(live, new Date(NOW)));
  (evil.channels.find((c) => c.id === CH.chat) as ChannelRec).overwrites.push({ id: BOT, type: 1, allow: '0', deny: P.SEND_MESSAGES.toString() });
  assert.ok(planRestore(evil, live, refsFor().channelIds).violations.some((v) => v.includes('Bot')));
  // unchanged state: nothing to do
  assert.equal(planRestore(snapshotFromBackup(buildBackup(live, new Date(NOW))), live, refsFor().channelIds).steps.length, 0);
});

// ─── Inventory + output hygiene ───────────────────────────────────────────
test('inventory: counters and flags per role, @everyone dangerous bits, visibility matrix', () => {
  const inv = buildInventory(fixture(), refsFor());
  const row = (n: string) => inv.roles.find((r) => r.name === n)!;
  assert.equal(row('Unnütz').members, 0);
  assert.ok(row('Unnütz').flags.includes('leer') && row('Unnütz').flags.includes('ungenutzt'));
  assert.ok(row('Referenziert').flags.includes('bot-referenz'));
  assert.ok(row('Server Booster').flags.includes('managed'));
  assert.equal(row('Plex-Fan').members, 30);
  assert.ok(row('Admin').dangerous.includes('ADMINISTRATOR'));
  assert.ok(inv.everyone.dangerous.includes('MENTION_EVERYONE') && inv.everyone.mentionEveryone);
  assert.ok(inv.visibility.length > 0);
});

test('no user id or member list ever appears in human-readable output (inventory, apply plan, restore plan)', () => {
  const snap = fixture();
  const plan = planRolesApply(snap, PLAN, refsFor());
  const restore = planRestore(snapshotFromBackup(buildBackup(snap, new Date(NOW))), plan.after, refsFor().channelIds);
  const text = [
    formatInventory(buildInventory(snap, refsFor())),
    formatApplyPlan(plan, 'dry-run'),
    formatRestorePlan(restore, 'dry-run', { createdAt: 'x', roles: 1, channels: 1 }),
    JSON.stringify(plan.skipped), JSON.stringify(plan.violations), JSON.stringify(buildInventory(snap, refsFor())),
  ].join('\n');
  for (const id of ALL_USER_IDS) assert.ok(!text.includes(id), `user id leaked: ${id.slice(0, 6)}…`);
});
