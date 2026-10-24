import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PermissionFlagsBits, type EmbedBuilder } from 'discord.js';
import type { PlexCardGateway } from '../src/discord/plex-card-manager.ts';
import { PlexWeeklyManager, type PlexWeeklyRecord, type PlexWeeklyStore } from '../src/discord/plex-weekly-manager.ts';
import { aggregatePlexWeekly, buildPlexWeeklyEmbed, type PlexWeeklyRaw } from '../src/utils/plex-weekly.ts';

// The command module pulls in config + DB: throwaway env, no network, no Discord.
const dir = mkdtempSync(join(tmpdir(), 'magguu-weekly-'));
process.env.DISCORD_TOKEN ??= 'test-token-not-used';
process.env.DISCORD_CLIENT_ID ??= '1498095100000000001';
process.env.DISCORD_GUILD_ID ??= '1400000000000000099';
process.env.WEBHOOK_SECRET ??= 'test-secret-0123456789abcdef';
process.env.DATABASE_PATH = join(dir, 'bot.db');
// Load through the command index (same entry point as the bot) to keep the module graph acyclic.
const { commands } = await import('../src/discord/commands/index.ts');
const wochenstatistikCommand = commands.get('wochenstatistik')!;

const RAW: PlexWeeklyRaw = {
  home: [
    { stat_id: 'top_movies', rows: [{ title: 'Dune', year: 2021, total_plays: 2, total_duration: 3600 }] },
    { stat_id: 'top_tv', rows: [] },
    { stat_id: 'top_users', rows: [{ friendly_name: 'Anna', total_plays: 2, total_duration: 3600 }] },
  ],
};
const TZ = 'Europe/Berlin';
const T0 = Date.UTC(2026, 9, 26, 6, 0, 0);

// ─── markdown / length hardening of titles and user names ───

test('weekly embed: titles and user names are clipped to 48 chars and markdown/mentions are escaped', () => {
  const evil = '**fett** _kursiv_ <@123456789012345678> @everyone [x](http://evil.example) `code` ~~s~~ ' + 'A'.repeat(200);
  const stats = aggregatePlexWeekly({
    home: [
      { stat_id: 'top_movies', rows: [{ title: evil, year: 2020, total_plays: 3, total_duration: 100 }] },
      { stat_id: 'top_users', rows: [{ friendly_name: evil, total_plays: 3, total_duration: 100 }] },
    ],
  });
  const movie = stats.movies[0]!.name;
  const user = stats.users[0]!.name;
  for (const name of [movie, user]) {
    assert.ok(Array.from(name.replace(/\\(.)/g, '$1')).length <= 48, 'visible length');
    assert.equal(/(^|[^\\])<@/.test(name), false, 'mention is escaped');
    assert.equal(/(^|[^\\])\*/.test(name), false, 'bold is escaped');
    assert.equal(/\\$/.test(name) && !/\\\\$/.test(name), false, 'no dangling backslash');
  }
  const json = JSON.stringify(buildPlexWeeklyEmbed(stats, new Date(T0), TZ).toJSON());
  assert.equal(json.includes('<@123456789012345678>'), false);
  assert.equal(json.includes('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), false);
});

test('weekly embed: plain titles stay unchanged, blank names fall back to Unbekannt', () => {
  const stats = aggregatePlexWeekly({
    home: [
      { stat_id: 'top_movies', rows: [{ title: 'Dune', total_plays: 2 }, { title: '   ', total_plays: 1 }] },
      { stat_id: 'top_users', rows: [{ user: '\u200b', total_plays: 1 }] },
    ],
  });
  assert.deepEqual(stats.movies.map((m) => m.name), ['Dune', 'Unbekannt']);
  assert.deepEqual(stats.users.map((u) => u.name), ['Unbekannt']);
});

// ─── permanent Discord errors pause the card ───

function codeError(code: number): Error {
  return Object.assign(new Error(`discord ${code}`), { code });
}

function setup(pauseMs?: number) {
  const rows = new Map<string, PlexWeeklyRecord>();
  const store: PlexWeeklyStore = { load: (c) => rows.get(c) ?? null, save: (r) => void rows.set(r.channelId, { ...r }) };
  const calls: string[] = [];
  const fail: { post?: Error; edit?: Error } = {};
  let seq = 0;
  const gateway: PlexCardGateway = {
    async post(channelId, _e: EmbedBuilder) {
      calls.push(`post-try:${channelId}`);
      if (fail.post) throw fail.post;
      seq += 1;
      return `m${seq}`;
    },
    async edit(channelId, messageId) {
      calls.push(`edit-try:${channelId}:${messageId}`);
      if (fail.edit) throw fail.edit;
    },
  };
  let now = T0;
  let fetches = 0;
  const logs: Array<{ level: string; msg: string; data?: Record<string, unknown> }> = [];
  const manager = new PlexWeeklyManager({
    store, gateway, timeZone: TZ, now: () => now, permanentPauseMs: pauseMs,
    fetchRaw: async () => { fetches += 1; return RAW; },
    log: (level, msg, data) => logs.push({ level, msg, data }),
  });
  return { manager, rows, calls, fail, logs, advance: (ms: number) => { now += ms; }, fetches: () => fetches };
}

for (const code of [10_003, 50_001, 50_013]) {
  test(`manager: permanent edit error ${code} → one warn, pause 30 min, no retry, no repost`, async () => {
    const t = setup();
    assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'posted');
    t.advance(24 * 3600_000);
    t.fail.edit = codeError(code);
    assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'paused');
    const attempts = t.calls.length;
    const warns = t.logs.filter((l) => l.level === 'warn');
    assert.equal(warns.length, 1);
    assert.equal(warns[0]!.data?.code, code);

    // every 30 min tick inside the pause window: silent, no Discord call, no Tautulli fetch
    const fetchesBefore = t.fetches();
    t.advance(29 * 60_000);
    assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'paused');
    assert.equal(t.calls.length, attempts);
    assert.equal(t.fetches(), fetchesBefore);
    assert.equal(t.logs.filter((l) => l.level === 'warn').length, 1, 'no log spam while paused');
    assert.equal(t.calls.filter((c) => c.startsWith('post-try')).length, 1, 'never reposts (only the initial post)');
    assert.equal(t.rows.get('c1')?.messageId, 'm1');

    // after 30 min it tries again; healed → edit works
    t.advance(2 * 60_000);
    t.fail.edit = undefined;
    assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'edited'); // the card header carries the date, so it differs
  });
}

test('manager: permanent post error pauses too; a forced refresh (admin command) lifts the pause', async () => {
  const t = setup(10 * 60_000);
  t.fail.post = codeError(50_013);
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'paused');
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'paused');
  assert.equal(t.calls.length, 1, 'only the first attempt reached Discord');
  t.fail.post = undefined;
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0, force: true }), 'posted');
  assert.equal(t.rows.get('c1')?.messageId, 'm1');
});

test('manager: pause is per channel and 10008 still reposts', async () => {
  const t = setup();
  await t.manager.refresh('c1', { maxAgeMs: 0 });
  t.advance(24 * 3600_000);
  t.fail.edit = codeError(50_001);
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'paused');
  t.fail.edit = undefined;
  assert.equal(await t.manager.refresh('c2', { maxAgeMs: 0 }), 'posted', 'other channel unaffected');
  t.advance(31 * 60_000);
  t.fail.edit = codeError(10_008);
  assert.equal(await t.manager.refresh('c1', { maxAgeMs: 0 }), 'reposted');
});

// ─── /wochenstatistik runtime permission check (fake interaction) ───

interface FakeInteraction {
  inGuild(): boolean;
  memberPermissions: { has(p: bigint): boolean } | null;
  replies: Array<Record<string, unknown>>;
  deferred: boolean;
  reply(o: Record<string, unknown>): Promise<void>;
  deferReply(o: Record<string, unknown>): Promise<void>;
  editReply(o: unknown): Promise<void>;
}

function fake(opts: { guild: boolean; perms: bigint | null }): FakeInteraction {
  const i: FakeInteraction = {
    inGuild: () => opts.guild,
    memberPermissions: opts.perms === null ? null : { has: (p) => (opts.perms! & p) === p },
    replies: [],
    deferred: false,
    async reply(o) { i.replies.push(o); },
    async deferReply() { i.deferred = true; },
    async editReply() {},
  };
  return i;
}

test('/wochenstatistik: needs Manage Server at runtime (missing permissions object and DM included)', async () => {
  const json = wochenstatistikCommand.data.toJSON() as { default_member_permissions?: string | null };
  assert.equal(json.default_member_permissions, String(PermissionFlagsBits.ManageGuild));

  const denied = [
    fake({ guild: true, perms: null }), // memberPermissions missing
    fake({ guild: false, perms: null }), // DM context
    fake({ guild: false, perms: PermissionFlagsBits.ManageGuild }), // even with bits, DMs are refused
    fake({ guild: true, perms: PermissionFlagsBits.SendMessages | PermissionFlagsBits.ManageMessages }),
  ];
  for (const i of denied) {
    await wochenstatistikCommand.execute(i as never);
    assert.equal(i.deferred, false);
    assert.equal(i.replies.length, 1);
    assert.match(String(i.replies[0]!.content), /Server verwalten/);
  }

  // Allowed: passes the gate and defers (the refresh itself reports "not configured" in this env, no network).
  const ok = fake({ guild: true, perms: PermissionFlagsBits.ManageGuild });
  await wochenstatistikCommand.execute(ok as never);
  assert.equal(ok.deferred, true);
  assert.equal(ok.replies.length, 0);
});
