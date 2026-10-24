import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { MessageFlags, PermissionFlagsBits, type EmbedBuilder } from 'discord.js';
import {
  RaidReminderManager,
  reminderCooldownLeft,
  resetReminderCooldown,
  type NewReminder,
  type ReminderGateway,
  type ReminderRow,
  type ReminderStore,
} from '../src/discord/raid-reminder-manager.ts';
import {
  MAX_REMINDER_TEXT,
  buildReminderEmbed,
  decideDue,
  nextWeeklyOccurrence,
  parseReminderTime,
  reminderChannelPayload,
  reminderDmPayload,
  sanitizeReminderText,
  zonedTimeToUtc,
} from '../src/utils/raid-reminder.ts';

// Real-DB parts use a throwaway file; a LEGACY db (only an old table) exists before the bot's DB module
// boots, so the CREATE TABLE IF NOT EXISTS migration is exercised against an existing database.
const dir = mkdtempSync(join(tmpdir(), 'magguu-erinnerung-'));
const dbPath = join(dir, 'bot.db');
{
  const legacy = new Database(dbPath);
  legacy.exec('CREATE TABLE reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, guild_id TEXT, channel_id TEXT, message TEXT NOT NULL, due_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);');
  legacy.prepare('INSERT INTO reminders (user_id, message, due_at, created_at) VALUES (?,?,?,?)').run('1', 'alt', 1, 1);
  legacy.close();
}
process.env.DISCORD_TOKEN ??= 'test-token-not-used';
process.env.DISCORD_CLIENT_ID ??= '1498095100000000001';
process.env.DISCORD_GUILD_ID = '1400000000000000099';
process.env.WEBHOOK_SECRET ??= 'test-secret-0123456789abcdef';
process.env.DATABASE_PATH = dbPath;
const { commands } = await import('../src/discord/commands/index.ts');
const { raidReminderStore } = await import('../src/discord/raid-reminders.ts');
const { sqliteHandle, ensureSchema, runMigrations } = await import('../src/db/client.ts');
const { assertReminderChannelAllowed, createReminderGateway, REMINDER_CHANNEL_PERMISSIONS } = await import('../src/discord/raid-reminders.ts');
const { guildMemberRemoveEvent } = await import('../src/discord/events/guild-member-remove.ts');
const { saveChannel } = await import('../src/discord/channel-store.ts');
const erinnerung = commands.get('erinnerung')!;

const TZ = 'Europe/Berlin';
const MIN = 60_000;

// ─── time arithmetic (pure, real Intl – no fakes) ───

test('nextWeeklyOccurrence: ordinary week in CEST and CET', () => {
  // Sat 2026-10-24 12:00Z. Next Thursday 20:00 CEST = 18:00Z
  assert.equal(nextWeeklyOccurrence(Date.UTC(2026, 9, 24, 12), TZ, 4, 20, 0), Date.UTC(2026, 9, 29, 19, 0)); // already CET on Oct 29
  // Wed Oct 21 -> Thursday Oct 22 20:00 CEST
  assert.equal(nextWeeklyOccurrence(Date.UTC(2026, 9, 21, 12), TZ, 4, 20, 0), Date.UTC(2026, 9, 22, 18, 0));
  // Friday 19:45 CET
  assert.equal(nextWeeklyOccurrence(Date.UTC(2026, 9, 24, 12), TZ, 5, 19, 45), Date.UTC(2026, 9, 30, 18, 45));
});

test('nextWeeklyOccurrence: strictly after, same day later vs. earlier, never more than 8 days away', () => {
  const t = Date.UTC(2026, 9, 22, 18, 0); // Thu 20:00 CEST
  assert.equal(nextWeeklyOccurrence(t - 1, TZ, 4, 20, 0), t);
  assert.equal(nextWeeklyOccurrence(t, TZ, 4, 20, 0), Date.UTC(2026, 9, 29, 19, 0)); // next week, now CET
  for (let day = 0; day < 7; day += 1) {
    const next = nextWeeklyOccurrence(t, TZ, day, 3, 0);
    assert.ok(next > t && next - t <= 8 * 86_400_000);
  }
});

test('DST end (2026-10-25): wall clock stays 20:00 across the switch, ambiguous 02:30 fires once at the first occurrence', () => {
  // Sunday 20:00 weekly: sent Oct 18 20:00 CEST (18:00Z) -> Oct 25 20:00 CET (19:00Z)
  assert.equal(nextWeeklyOccurrence(Date.UTC(2026, 9, 18, 18, 0, 5), TZ, 0, 20, 0), Date.UTC(2026, 9, 25, 19, 0));
  // 02:30 on the switch day exists twice -> first (CEST, 00:30Z)
  assert.equal(nextWeeklyOccurrence(Date.UTC(2026, 9, 24, 12), TZ, 0, 2, 30), Date.UTC(2026, 9, 25, 0, 30));
  // and after that first occurrence the next one is a week later (not 01:30Z the same night)
  assert.equal(nextWeeklyOccurrence(Date.UTC(2026, 9, 25, 0, 30), TZ, 0, 2, 30), Date.UTC(2026, 10, 1, 1, 30));
});

test('DST start (2026-03-29): non-existent 02:30 is shifted to 03:30 local, not skipped; 20:00 stays 20:00', () => {
  assert.equal(nextWeeklyOccurrence(Date.UTC(2026, 2, 28, 12), TZ, 0, 2, 30), Date.UTC(2026, 2, 29, 1, 30)); // 03:30 CEST
  assert.equal(zonedTimeToUtc(2026, 3, 29, 2, 30, TZ), Date.UTC(2026, 2, 29, 1, 30));
  // Sunday 20:00: Mar 22 20:00 CET (19:00Z) -> Mar 29 20:00 CEST (18:00Z)
  assert.equal(nextWeeklyOccurrence(Date.UTC(2026, 2, 22, 19, 0, 5), TZ, 0, 20, 0), Date.UTC(2026, 2, 29, 18, 0));
});

test('other zones work too (America/New_York, no DST confusion at the date line)', () => {
  // Fri 2026-10-23 12:00Z, NY is EDT (UTC-4): Saturday 09:00 local = 13:00Z
  assert.equal(nextWeeklyOccurrence(Date.UTC(2026, 9, 23, 12), 'America/New_York', 6, 9, 0), Date.UTC(2026, 9, 24, 13, 0));
});

// ─── parsing / sanitising ───

test('parseReminderTime accepts HH:MM, H.MM, "20 Uhr" and rejects garbage', () => {
  assert.deepEqual(parseReminderTime('19:45'), { hour: 19, minute: 45 });
  assert.deepEqual(parseReminderTime('9:05'), { hour: 9, minute: 5 });
  assert.deepEqual(parseReminderTime('20.15'), { hour: 20, minute: 15 });
  assert.deepEqual(parseReminderTime('20 Uhr'), { hour: 20, minute: 0 });
  assert.deepEqual(parseReminderTime('0:00'), { hour: 0, minute: 0 });
  for (const bad of ['24:00', '12:60', '', 'abc', '12:5', '-1:00', '1:2:3', '99']) assert.equal(parseReminderTime(bad), null, bad);
});

test('sanitizeReminderText clips to 100 chars, strips control chars and neutralises markdown and mentions', () => {
  const evil = '@everyone @here <@&123456789012345678> <@123456789012345678> **x** [a](http://evil.example) ' + 'B'.repeat(300);
  const out = sanitizeReminderText(evil)!;
  assert.ok(Array.from(out.replace(/\\(.)/g, '$1')).length <= MAX_REMINDER_TEXT);
  assert.ok(!/(^|[^\\])@everyone/.test(out) && !/(^|[^\\])@here/.test(out), out);
  assert.ok(!/(^|[^\\])<@/.test(out), out);
  assert.equal(sanitizeReminderText('   '), null);
  assert.equal(sanitizeReminderText(null), null);
  assert.equal(sanitizeReminderText('a\u202eb\u200bc'), 'abc', 'bidi override / zero-width removed');
  assert.ok(!/[\u0000-\u001f]/.test(sanitizeReminderText('a\u0000b')!), 'control chars removed');
});

test('mention safety: DM pings nobody, channel pings only the subscriber; embed carries the (escaped) text', () => {
  const embed = buildReminderEmbed({ kind: 'raid', text: sanitizeReminderText('@everyone <@&1> los'), recurring: true });
  assert.deepEqual(reminderDmPayload(embed).allowedMentions, { parse: [] });
  assert.ok(!('content' in reminderDmPayload(embed)));
  const ch = reminderChannelPayload('111122223333444455', embed);
  assert.equal(ch.content, '<@111122223333444455>');
  assert.deepEqual(ch.allowedMentions, { parse: [], users: ['111122223333444455'] });
  const description = embed.data.description ?? '';
  assert.ok(!/(^|[^\\])@everyone/.test(description) && !/(^|[^\\])<@&/.test(description), description);
  assert.match(embed.data.title ?? '', /Raid-Erinnerung/);
});

test('decideDue: wait / send within 15 min / stale after', () => {
  const now = Date.UTC(2026, 9, 24, 18, 0);
  assert.equal(decideDue(now + 1, now), 'wait');
  assert.equal(decideDue(now, now), 'send');
  assert.equal(decideDue(now - 15 * MIN, now), 'send');
  assert.equal(decideDue(now - 15 * MIN - 1, now), 'stale');
});

// ─── manager with in-memory store + fake gateway (FAKES: no real Discord) ───

class MemStore implements ReminderStore {
  rows: ReminderRow[] = [];
  private seq = 0;
  insert(input: NewReminder): ReminderRow {
    const row: ReminderRow = { ...input, id: ++this.seq, pausedReason: null };
    this.rows.push(row);
    return row;
  }
  listByUser(guildId: string, userId: string): ReminderRow[] {
    return this.rows.filter((r) => r.guildId === guildId && r.userId === userId);
  }
  due(now: number): ReminderRow[] {
    return this.rows.filter((r) => !r.pausedReason && r.nextDueAt <= now).map((r) => ({ ...r }));
  }
  update(id: number, patch: { nextDueAt?: number; pausedReason?: string | null; pausedAt?: number | null; pauseNotifiedAt?: number | null; lastSentAt?: number }): void {
    const row = this.rows.find((r) => r.id === id)!;
    if (patch.nextDueAt !== undefined) row.nextDueAt = patch.nextDueAt;
    if (patch.pausedReason !== undefined) row.pausedReason = patch.pausedReason;
    if (patch.pauseNotifiedAt !== undefined) row.pauseNotifiedAt = patch.pauseNotifiedAt;
  }
  delete(id: number): void {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
  deleteAllByUser(guildId: string, userId: string): number {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.guildId === guildId && r.userId === userId));
    return before - this.rows.length;
  }
}

class FakeGateway implements ReminderGateway {
  dms: string[] = [];
  channels: Array<{ channelId: string; userId: string }> = [];
  dmError: unknown = null;
  channelError: unknown = null;
  attempts = 0;
  async sendDm(userId: string, _embed: EmbedBuilder): Promise<void> {
    this.attempts += 1;
    if (this.dmError) throw this.dmError;
    this.dms.push(userId);
  }
  async sendChannel(channelId: string, userId: string, _embed: EmbedBuilder): Promise<void> {
    this.attempts += 1;
    if (this.channelError) throw this.channelError;
    this.channels.push({ channelId, userId });
  }
}

const discordError = (code: number): Error => Object.assign(new Error(`Discord ${code}`), { code });

function setup(start: number) {
  const store = new MemStore();
  const gateway = new FakeGateway();
  const clock = { t: start };
  const logs: string[] = [];
  const manager = new RaidReminderManager({
    store,
    gateway,
    timeZone: TZ,
    now: () => clock.t,
    log: (_level, msg) => logs.push(msg),
  });
  return { store, gateway, clock, logs, manager };
}

const BASE = { guildId: 'g1', userId: 'u1', kind: 'raid' as const, day: 4, hour: 20, minute: 0, text: null, recurring: true, channelId: null };
// Sat 2026-10-24 12:00Z; next Thursday 20:00 is Oct 29 20:00 CET = 19:00Z
const NOW = Date.UTC(2026, 9, 24, 12);
const DUE = Date.UTC(2026, 9, 29, 19, 0);

test('limits: max 5 per user, duplicates rejected, other users unaffected', () => {
  const { manager } = setup(NOW);
  for (let i = 0; i < 5; i += 1) assert.equal(manager.add({ ...BASE, minute: i }).ok, true);
  const sixth = manager.add({ ...BASE, minute: 10 });
  assert.deepEqual(sixth, { ok: false, reason: 'limit', limit: 5 });
  assert.equal(manager.add({ ...BASE, userId: 'u2' }).ok, true);
  const { manager: m2 } = setup(NOW);
  assert.equal(m2.add(BASE).ok, true);
  assert.deepEqual(m2.add(BASE), { ok: false, reason: 'duplicate' });
});

test('add computes next due via the bot time zone', () => {
  const { manager } = setup(NOW);
  const res = manager.add(BASE);
  assert.ok(res.ok && res.reminder.nextDueAt === DUE);
});

test('tick: nothing before due; at due sends one DM, recurring moves exactly one week (wall clock kept across DST)', async () => {
  const { manager, gateway, clock, store } = setup(Date.UTC(2026, 9, 18, 12)); // Sun Oct 18, still CEST
  const added = manager.add({ ...BASE, day: 0, hour: 20 });
  assert.ok(added.ok);
  assert.equal(added.ok && added.reminder.nextDueAt, Date.UTC(2026, 9, 18, 18, 0));
  clock.t = Date.UTC(2026, 9, 18, 17, 59);
  assert.deepEqual(await manager.tick(), { sent: 0, skipped: 0, paused: 0, failed: 0 });
  clock.t = Date.UTC(2026, 9, 18, 18, 0, 20);
  assert.equal((await manager.tick()).sent, 1);
  assert.deepEqual(gateway.dms, ['u1']);
  assert.equal(store.rows[0]!.nextDueAt, Date.UTC(2026, 9, 25, 19, 0)); // 20:00 CET after the switch
  clock.t += 5_000;
  await manager.tick();
  assert.equal(gateway.dms.length, 1, 'no double send');
});

test('one-off reminders are removed after sending (frees the limit); channel delivery goes to the channel', async () => {
  const { manager, gateway, clock, store } = setup(NOW);
  manager.add({ ...BASE, recurring: false });
  manager.add({ ...BASE, recurring: false, minute: 5, channelId: 'c1' });
  clock.t = DUE + 6 * MIN;
  const s = await manager.tick();
  assert.equal(s.sent, 2);
  assert.deepEqual(gateway.dms, ['u1']);
  assert.deepEqual(gateway.channels, [{ channelId: 'c1', userId: 'u1' }]);
  assert.equal(store.rows.length, 0);
});

test('missed reminders: >15 min overdue is NOT sent late (no mass resend after restart), recurring ones are rescheduled', async () => {
  const { manager, gateway, clock, store } = setup(NOW);
  for (const minute of [0, 1, 2]) manager.add({ ...BASE, minute });
  manager.add({ ...BASE, minute: 3, recurring: false });
  clock.t = DUE + 3 * 86_400_000; // bot was down for days
  const s = await manager.tick();
  assert.equal(s.sent, 0);
  assert.equal(s.skipped, 4);
  assert.equal(gateway.attempts, 0);
  assert.equal(store.rows.length, 3, 'one-off dropped, weekly kept');
  assert.ok(store.rows.every((r) => r.nextDueAt > clock.t));
});

test('missed reminder at exactly 14 min overdue after a restart is still delivered', async () => {
  const { manager, gateway, clock } = setup(NOW);
  manager.add(BASE);
  clock.t = DUE + 14 * MIN;
  assert.equal((await manager.tick()).sent, 1);
  assert.equal(gateway.dms.length, 1);
});

test('DM closed (50007): all of the user\'s DM subscriptions pause, no ops alarm, no retry spam, channel ones keep working', async () => {
  const { manager, gateway, clock, store, logs } = setup(NOW);
  manager.add(BASE);
  manager.add({ ...BASE, minute: 5 });
  manager.add({ ...BASE, minute: 10, channelId: 'c1' });
  gateway.dmError = discordError(50007);
  clock.t = DUE + 11 * MIN; // all three (20:00 / 20:05 / 20:10) are due and within grace
  const first = await manager.tick();
  assert.equal(first.paused, 2);
  assert.equal(first.sent, 1, 'the channel reminder is delivered');
  assert.equal(store.rows.filter((r) => r.pausedReason === 'dm_closed').length, 2);
  assert.equal(logs.filter((l) => l === 'reminder subscription paused').length, 2);
  const attemptsAfter = gateway.attempts;
  clock.t += 30_000;
  await manager.tick();
  assert.equal(gateway.attempts, attemptsAfter, 'paused rows are not attempted again');
  // the user sees the hint in /erinnerung liste and can resume; nothing old is resent
  gateway.dmError = null;
  assert.equal(manager.resume('g1', 'u1'), 2);
  assert.ok(store.rows.every((r) => !r.pausedReason && r.nextDueAt > clock.t));
  clock.t += 30_000;
  await manager.tick();
  assert.equal(gateway.dms.length, 0);
});

test('transient errors retry on the next tick within the grace window, then give up quietly', async () => {
  const { manager, gateway, clock, store } = setup(NOW);
  manager.add(BASE);
  gateway.dmError = discordError(500);
  clock.t = DUE;
  assert.equal((await manager.tick()).failed, 1);
  clock.t += 30_000;
  gateway.dmError = null;
  assert.equal((await manager.tick()).sent, 1);
  // second reminder: keeps failing past the grace window -> skipped, rescheduled, never paused
  const s2 = setup(NOW);
  s2.manager.add(BASE);
  s2.gateway.dmError = discordError(500);
  s2.clock.t = DUE;
  await s2.manager.tick();
  s2.clock.t = DUE + 16 * MIN;
  const res = await s2.manager.tick();
  assert.equal(res.skipped, 1);
  assert.equal(s2.store.rows[0]!.pausedReason, null);
  assert.ok(store.rows[0]!.nextDueAt > DUE);
});

test('channel permanently unavailable (50013/10003/50001) pauses only that subscription', async () => {
  const { manager, gateway, clock, store } = setup(NOW);
  manager.add({ ...BASE, channelId: 'c1' });
  manager.add({ ...BASE, minute: 5 });
  gateway.channelError = discordError(50013);
  clock.t = DUE + 6 * MIN;
  const s = await manager.tick();
  assert.equal(s.paused, 1);
  assert.equal(s.sent, 1);
  assert.equal(store.rows.find((r) => r.channelId === 'c1')!.pausedReason, 'channel_unavailable');
});

test('opt-out: /erinnerung aus removes one (only own) or all, always possible', async () => {
  const { manager, gateway, clock } = setup(NOW);
  const a = manager.add(BASE);
  manager.add({ ...BASE, minute: 5 });
  manager.add({ ...BASE, userId: 'u2' });
  assert.ok(a.ok);
  assert.equal(manager.remove('g1', 'u2', a.ok ? a.reminder.id : 0), 0, 'cannot remove someone else\'s');
  assert.equal(manager.remove('g1', 'u1', a.ok ? a.reminder.id : 0), 1);
  assert.equal(manager.remove('g1', 'u1'), 1);
  assert.equal(manager.list('g1', 'u1').length, 0);
  clock.t = DUE;
  await manager.tick();
  assert.deepEqual(gateway.dms, ['u2']);
});

test('cooldown: second call within 5 s is blocked, later ones pass', () => {
  resetReminderCooldown();
  assert.equal(reminderCooldownLeft('x', 1000), 0);
  assert.ok(reminderCooldownLeft('x', 2000) > 0);
  assert.equal(reminderCooldownLeft('x', 7000), 0);
  assert.equal(reminderCooldownLeft('y', 2000), 0);
});

// ─── real SQLite store (temp DB) + migration ───

test('migration: raid_reminders is created in an existing legacy DB without touching old data', () => {
  const cols = sqliteHandle.prepare("PRAGMA table_info('raid_reminders')").all() as Array<{ name: string }>;
  for (const c of ['guild_id', 'user_id', 'kind', 'day', 'hour', 'minute', 'text', 'recurring', 'channel_id', 'next_due_at', 'paused_reason']) {
    assert.ok(cols.some((x) => x.name === c), c);
  }
  assert.equal((sqliteHandle.prepare('SELECT message FROM reminders').get() as { message: string }).message, 'alt');
});

test('real store: persistence survives a fresh connection (restart), due/pause/update/delete behave', () => {
  const now = NOW;
  const row = raidReminderStore.insert({ ...BASE, guildId: 'gp', userId: 'up', text: 'Hallo', nextDueAt: DUE }, now);
  const second = raidReminderStore.insert({ ...BASE, guildId: 'gp', userId: 'up', minute: 5, nextDueAt: DUE + MIN }, now);
  // "restart": read the same file through a brand-new connection
  const fresh = new Database(dbPath, { readonly: true });
  const persisted = fresh.prepare('SELECT * FROM raid_reminders WHERE user_id = ?').all('up') as Array<{ next_due_at: number; text: string | null }>;
  fresh.close();
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0]!.next_due_at, DUE);
  assert.equal(persisted[0]!.text, 'Hallo');

  assert.equal(raidReminderStore.due(DUE - 1).filter((r) => r.userId === 'up').length, 0);
  assert.equal(raidReminderStore.due(DUE).filter((r) => r.userId === 'up').length, 1);
  raidReminderStore.update(row.id, { pausedReason: 'dm_closed', pausedAt: now });
  assert.equal(raidReminderStore.due(DUE + 5 * MIN).filter((r) => r.userId === 'up').length, 1, 'paused row is not due');
  raidReminderStore.update(row.id, { pausedReason: null, pausedAt: null, nextDueAt: DUE + 7 * 86_400_000 });
  assert.equal(raidReminderStore.listByUser('gp', 'up')[0]!.nextDueAt, DUE + 7 * 86_400_000);
  raidReminderStore.delete(second.id);
  assert.equal(raidReminderStore.deleteAllByUser('gp', 'up'), 1);
  assert.equal(raidReminderStore.listByUser('gp', 'up').length, 0);
});

// ─── command (real command + real temp DB; FAKE interaction objects) ───

function fakeInteraction(opts: {
  sub: string;
  userId?: string;
  guildId?: string | null;
  strings?: Record<string, string | null>;
  ints?: Record<string, number | null>;
  bools?: Record<string, boolean | null>;
  channel?: { id: string } | null;
  memberCanWrite?: boolean;
  /** member sees the channel but lacks SendMessages */
  memberViewOnly?: boolean;
  memberUnresolvable?: boolean;
  channelMissing?: boolean;
  channelIsThread?: boolean;
  botCanWrite?: boolean;
  targetUser?: { id: string } | null;
  canManageGuild?: boolean;
}) {
  const replies: Array<{ content: string; flags?: unknown; allowedMentions?: unknown }> = [];
  const guildId = opts.guildId === undefined ? process.env.DISCORD_GUILD_ID! : opts.guildId;
  const FULL = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks;
  const perms = (mask: bigint) => ({ has: (p: bigint) => (mask & p) === p });
  const memberMask = opts.memberCanWrite === false ? 0n : opts.memberViewOnly ? PermissionFlagsBits.ViewChannel : FULL;
  const interaction = {
    inGuild: () => guildId !== null,
    guildId,
    guild: {
      channels: {
        fetch: async (id: string) => {
          if (opts.channelMissing) throw new Error('Unknown Channel');
          return {
            id,
            toString: () => `<#${id}>`,
            isThread: () => opts.channelIsThread === true,
            permissionsFor: (who: { me?: boolean }) => perms(who.me ? (opts.botCanWrite !== false ? FULL : 0n) : memberMask),
          };
        },
      },
      members: {
        fetch: async () => {
          if (opts.memberUnresolvable) throw new Error('Unknown Member');
          return { me: false };
        },
        me: { me: true },
      },
    },
    user: { id: opts.userId ?? 'cmd-user' },
    memberPermissions: { has: (p: bigint) => opts.canManageGuild === true && p === PermissionFlagsBits.ManageGuild },
    options: {
      getUser: () => opts.targetUser ?? null,
      getSubcommand: () => opts.sub,
      getString: (n: string) => opts.strings?.[n] ?? null,
      getInteger: (n: string) => opts.ints?.[n] ?? null,
      getBoolean: (n: string) => opts.bools?.[n] ?? null,
      getChannel: () => opts.channel ?? null,
    },
    reply: async (r: { content: string; flags?: unknown; allowedMentions?: unknown }) => {
      replies.push(r);
    },
  };
  return { interaction: interaction as never, replies };
}

test('command: an → liste → aus end-to-end on the temp DB; replies are ephemeral with no mention parsing', async () => {
  resetReminderCooldown();
  const uid = 'cmd-user-1';
  const created = fakeInteraction({
    sub: 'an',
    userId: uid,
    strings: { art: 'mythicplus', uhrzeit: '19:45', text: '@everyone Key <@&1> **los**' },
    ints: { tag: 2 },
    bools: { woechentlich: true },
  });
  await erinnerung.execute(created.interaction);
  assert.match(created.replies[0]!.content, /Mythic\+-Erinnerung #\d+ angelegt: Dienstag 19:45/);
  assert.deepEqual(created.replies[0]!.allowedMentions, { parse: [] });
  assert.ok(created.replies[0]!.flags);

  const stored = raidReminderStore.listByUser(process.env.DISCORD_GUILD_ID!, uid);
  assert.equal(stored.length, 1);
  assert.ok(!/(^|[^\\])@everyone/.test(stored[0]!.text ?? ''));
  assert.equal(stored[0]!.recurring, true);

  const list = fakeInteraction({ sub: 'liste', userId: uid });
  await erinnerung.execute(list.interaction);
  assert.match(list.replies[0]!.content, /Dienstag 19:45/);
  assert.match(list.replies[0]!.content, /wöchentlich/);

  const off = fakeInteraction({ sub: 'aus', userId: uid });
  await erinnerung.execute(off.interaction);
  assert.match(off.replies[0]!.content, /abbestellt/);
  assert.equal(raidReminderStore.listByUser(process.env.DISCORD_GUILD_ID!, uid).length, 0);
});

test('command: validation (bad time, cooldown, outside the guild / wrong guild, channel permission checks, limit)', async () => {
  resetReminderCooldown();
  const uid = 'cmd-user-2';
  const base = { sub: 'an', userId: uid, strings: { art: 'raid', uhrzeit: '19:45' }, ints: { tag: 4 } };

  const dm = fakeInteraction({ ...base, guildId: null });
  await erinnerung.execute(dm.interaction);
  assert.match(dm.replies[0]!.content, /nur im Server/);

  const other = fakeInteraction({ ...base, guildId: '999' });
  await erinnerung.execute(other.interaction);
  assert.match(other.replies[0]!.content, /nur auf dem Magguu-Server/);

  const badTime = fakeInteraction({ ...base, strings: { art: 'raid', uhrzeit: '25:99' } });
  await erinnerung.execute(badTime.interaction);
  assert.match(badTime.replies[0]!.content, /Uhrzeit nicht verstanden/);

  const noWrite = fakeInteraction({ ...base, channel: { id: '5551' }, memberCanWrite: false });
  await erinnerung.execute(noWrite.interaction);
  assert.match(noWrite.replies[0]!.content, /Dir fehlen in <#5551> die Rechte: `Kanal ansehen`, `Nachrichten senden`/);

  resetReminderCooldown();
  const botNoWrite = fakeInteraction({ ...base, channel: { id: '5551' }, botCanWrite: false });
  await erinnerung.execute(botNoWrite.interaction);
  assert.match(botNoWrite.replies[0]!.content, /Bot darf in diesem Kanal nicht schreiben/);
  assert.equal(raidReminderStore.listByUser(process.env.DISCORD_GUILD_ID!, uid).length, 0);

  resetReminderCooldown();
  const ok = fakeInteraction({ ...base, channel: { id: '5551' } });
  await erinnerung.execute(ok.interaction);
  assert.match(ok.replies[0]!.content, /in <#5551>/);
  const again = fakeInteraction({ ...base, channel: { id: '5551' } });
  await erinnerung.execute(again.interaction);
  assert.match(again.replies[0]!.content, /Bitte kurz warten/);

  // fill up to the limit (cooldown reset between calls)
  for (let m = 0; m < 4; m += 1) {
    resetReminderCooldown();
    const f = fakeInteraction({ ...base, strings: { art: 'raid', uhrzeit: `10:0${m}` } });
    await erinnerung.execute(f.interaction);
  }
  resetReminderCooldown();
  const over = fakeInteraction({ ...base, strings: { art: 'raid', uhrzeit: '11:11' } });
  await erinnerung.execute(over.interaction);
  assert.match(over.replies[0]!.content, /Maximum/);

  const wipe = fakeInteraction({ sub: 'aus', userId: uid });
  await erinnerung.execute(wipe.interaction);
  assert.match(wipe.replies[0]!.content, /Alle 5 Erinnerungen abbestellt/);
});

test('command: fortsetzen shows the DM hint in liste for a paused subscription and resumes it', async () => {
  resetReminderCooldown();
  const uid = 'cmd-user-3';
  const gid = process.env.DISCORD_GUILD_ID!;
  const row = raidReminderStore.insert({ ...BASE, guildId: gid, userId: uid, nextDueAt: Date.now() + 86_400_000 }, Date.now());
  raidReminderStore.update(row.id, { pausedReason: 'dm_closed', pausedAt: Date.now() });
  const list = fakeInteraction({ sub: 'liste', userId: uid });
  await erinnerung.execute(list.interaction);
  assert.match(list.replies[0]!.content, /pausiert: DMs vom Server sind für dich gesperrt/);
  const resume = fakeInteraction({ sub: 'fortsetzen', userId: uid });
  await erinnerung.execute(resume.interaction);
  assert.match(resume.replies[0]!.content, /1 Erinnerung\(en\) wieder aktiv/);
  assert.equal(raidReminderStore.listByUser(gid, uid)[0]!.pausedReason, null);
  raidReminderStore.deleteAllByUser(gid, uid);
});

// ─── review follow-ups: leave cleanup, channel gate, moderation, pause notice, migration idempotency ───

const GID = process.env.DISCORD_GUILD_ID!;
const granted = (bits: bigint) => ({ has: (b: bigint) => (bits & b) === b });
const chan = (id: string, bits: bigint | null) => ({ id, permissionsFor: () => (bits === null ? null : granted(bits)) });

test('member leaves: all of the user\'s reminders are deleted (DM and channel), others untouched, audit channel absent is fine', async () => {
  const leaver = 'leaver-1';
  const stayer = 'stayer-1';
  const now = Date.now();
  raidReminderStore.insert({ ...BASE, guildId: GID, userId: leaver, nextDueAt: now + 1e6 }, now);
  raidReminderStore.insert({ ...BASE, guildId: GID, userId: leaver, channelId: '5551', hour: 21, nextDueAt: now + 1e6 }, now);
  raidReminderStore.insert({ ...BASE, guildId: GID, userId: stayer, nextDueAt: now + 1e6 }, now);
  assert.equal(raidReminderStore.listByUser(GID, leaver).length, 2);
  await guildMemberRemoveEvent.execute({
    id: leaver,
    guild: { id: GID, channels: { fetch: async () => null } },
    user: { displayName: 'x', displayAvatarURL: () => '' },
    joinedTimestamp: null,
  } as never);
  assert.equal(raidReminderStore.listByUser(GID, leaver).length, 0);
  assert.equal(raidReminderStore.listByUser(GID, stayer).length, 1);
  raidReminderStore.deleteAllByUser(GID, stayer);
  // a second leave event (or a user without reminders) is a quiet no-op
  await guildMemberRemoveEvent.execute({ id: leaver, guild: { id: GID, channels: { fetch: async () => null } }, user: undefined } as never);
});

test('channel delivery gate: reserved #updates, missing View/Send/EmbedLinks and unknown permissions are refused with a permanent code', () => {
  const need = REMINDER_CHANNEL_PERMISSIONS;
  assert.equal(need, PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks);
  assert.doesNotThrow(() => assertReminderChannelAllowed(chan('c1', need), {}, undefined));
  assert.doesNotThrow(() => assertReminderChannelAllowed(chan('c1', need), {}, 'other-channel'));
  const code = (fn: () => void) => { try { fn(); } catch (e) { return (e as { code?: number }).code; } return undefined; };
  assert.equal(code(() => assertReminderChannelAllowed(chan('upd', need), {}, 'upd')), 50013, 'addonUpdates is reserved for releases');
  for (const missing of [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]) {
    assert.equal(code(() => assertReminderChannelAllowed(chan('c1', need & ~missing), {}, undefined)), 50013);
  }
  assert.equal(code(() => assertReminderChannelAllowed(chan('c1', null), {}, undefined)), 50013);
});

test('missing channel permission at send time: paused once with one warn, no retry spam, DM subscriptions unaffected', async () => {
  const { store, gateway, clock, logs, manager } = setup(NOW);
  const ch = manager.add({ ...BASE, channelId: 'c9' });
  const dm = manager.add({ ...BASE, hour: 21 });
  assert.ok(ch.ok && dm.ok);
  gateway.channelError = Object.assign(new Error('missing channel permissions'), { code: 50013 });
  clock.t = DUE;
  const first = await manager.tick();
  assert.equal(first.paused, 1);
  assert.equal(logs.filter((l) => l === 'reminder subscription paused').length, 1);
  const attempts = gateway.attempts;
  clock.t = DUE + 30_000;
  await manager.tick();
  clock.t = DUE + 60_000;
  await manager.tick();
  assert.equal(gateway.attempts, attempts, 'a paused channel subscription is not retried');
  assert.equal(store.rows.find((r) => r.channelId === 'c9')!.pausedReason, 'channel_unavailable');
});

test('addonUpdates lock in the command: refused for the reserved channel, other channels still work', async () => {
  resetReminderCooldown();
  const uid = 'lock-user-1';
  saveChannel('addonUpdates', '7777');
  const base = { sub: 'an', userId: uid, strings: { art: 'raid', uhrzeit: '19:45' }, ints: { tag: 4 } };
  const locked = fakeInteraction({ ...base, channel: { id: '7777' } });
  await erinnerung.execute(locked.interaction);
  assert.match(locked.replies[0]!.content, /nur MagguuUI-Releases/);
  assert.equal(raidReminderStore.listByUser(GID, uid).length, 0);
  resetReminderCooldown();
  const open = fakeInteraction({ ...base, channel: { id: '5551' } });
  await erinnerung.execute(open.interaction);
  assert.match(open.replies[0]!.content, /in <#5551>/);
  raidReminderStore.deleteAllByUser(GID, uid);
});

test('moderation: only Manage Server may list/remove other users\' reminders; own ones always; replies stay ping-free', async () => {
  resetReminderCooldown();
  const victim = 'victim-1';
  const mod = 'mod-1';
  const now = Date.now();
  const a = raidReminderStore.insert({ ...BASE, guildId: GID, userId: victim, nextDueAt: now + 1e6 }, now);
  raidReminderStore.insert({ ...BASE, guildId: GID, userId: victim, hour: 21, nextDueAt: now + 1e6 }, now);

  const denied = fakeInteraction({ sub: 'aus', userId: 'plain-user', targetUser: { id: victim } });
  await erinnerung.execute(denied.interaction);
  assert.match(denied.replies[0]!.content, /Server verwalten/);
  const deniedList = fakeInteraction({ sub: 'liste', userId: 'plain-user', targetUser: { id: victim } });
  await erinnerung.execute(deniedList.interaction);
  assert.match(deniedList.replies[0]!.content, /Server verwalten/);
  assert.equal(raidReminderStore.listByUser(GID, victim).length, 2);

  const list = fakeInteraction({ sub: 'liste', userId: mod, targetUser: { id: victim }, canManageGuild: true });
  await erinnerung.execute(list.interaction);
  assert.match(list.replies[0]!.content, new RegExp(`Erinnerungen von <@${victim}>`));
  assert.deepEqual(list.replies[0]!.allowedMentions, { parse: [] });

  const one = fakeInteraction({ sub: 'aus', userId: mod, targetUser: { id: victim }, ints: { id: a.id }, canManageGuild: true });
  await erinnerung.execute(one.interaction);
  assert.match(one.replies[0]!.content, /1 Erinnerung\(en\) von/);
  assert.deepEqual(one.replies[0]!.allowedMentions, { parse: [] });
  assert.equal(raidReminderStore.listByUser(GID, victim).length, 1);

  const missing = fakeInteraction({ sub: 'aus', userId: mod, targetUser: { id: victim }, ints: { id: 999999 }, canManageGuild: true });
  await erinnerung.execute(missing.interaction);
  assert.match(missing.replies[0]!.content, /nicht gefunden|Keine Erinnerung/);

  const all = fakeInteraction({ sub: 'aus', userId: mod, targetUser: { id: victim }, canManageGuild: true });
  await erinnerung.execute(all.interaction);
  assert.equal(raidReminderStore.listByUser(GID, victim).length, 0);

  // naming yourself as the target needs no permission
  const selfRow = raidReminderStore.insert({ ...BASE, guildId: GID, userId: 'self-1', nextDueAt: now + 1e6 }, now);
  const self = fakeInteraction({ sub: 'aus', userId: 'self-1', targetUser: { id: 'self-1' }, ints: { id: selfRow.id } });
  await erinnerung.execute(self.interaction);
  assert.match(self.replies[0]!.content, /abbestellt/);
});

test('pause notice (manager): shown once per pause, no DM attempt, again only after resume + new pause', async () => {
  const { gateway, clock, manager } = setup(NOW);
  manager.add({ ...BASE });
  manager.add({ ...BASE, hour: 21 });
  assert.equal(manager.takePauseNotice('g1', 'u1'), null, 'nothing paused yet');
  gateway.dmError = discordError(50007);
  clock.t = DUE;
  await manager.tick();
  const attempts = gateway.attempts;
  const notice = manager.takePauseNotice('g1', 'u1');
  assert.match(notice ?? '', /einmalig/);
  assert.match(notice ?? '', /2 DM-Erinnerung/);
  assert.match(notice ?? '', /\/erinnerung fortsetzen/);
  assert.equal(manager.takePauseNotice('g1', 'u1'), null, 'second call: already told');
  assert.equal(gateway.attempts, attempts, 'the notice never triggers a DM attempt');
  assert.equal(manager.takePauseNotice('g1', 'other-user'), null);
  manager.resume('g1', 'u1');
  clock.t = DUE + 7 * 86_400_000 + 2 * 60_000;
  await manager.tick();
  assert.match(manager.takePauseNotice('g1', 'u1') ?? '', /einmalig/, 'a new pause is announced again');
});

test('pause notice (command): appended once to the next /erinnerung reply, errors do not swallow it, fortsetzen has none', async () => {
  resetReminderCooldown();
  const uid = 'notice-user-1';
  const now = Date.now();
  const row = raidReminderStore.insert({ ...BASE, guildId: GID, userId: uid, nextDueAt: now + 1e6 }, now);
  raidReminderStore.update(row.id, { pausedReason: 'dm_closed', pausedAt: now, pauseNotifiedAt: null });

  const bad = fakeInteraction({ sub: 'an', userId: uid, strings: { art: 'raid', uhrzeit: '99:99' }, ints: { tag: 1 } });
  await erinnerung.execute(bad.interaction);
  assert.doesNotMatch(bad.replies[0]!.content, /einmalig/);

  const first = fakeInteraction({ sub: 'liste', userId: uid });
  await erinnerung.execute(first.interaction);
  assert.match(first.replies[0]!.content, /Hinweis \(einmalig\)/);
  assert.deepEqual(first.replies[0]!.allowedMentions, { parse: [] });
  const second = fakeInteraction({ sub: 'liste', userId: uid });
  await erinnerung.execute(second.interaction);
  assert.doesNotMatch(second.replies[0]!.content, /Hinweis \(einmalig\)/);
  assert.ok(raidReminderStore.listByUser(GID, uid)[0]!.pauseNotifiedAt);

  const resume = fakeInteraction({ sub: 'fortsetzen', userId: uid });
  await erinnerung.execute(resume.interaction);
  assert.doesNotMatch(resume.replies[0]!.content, /Hinweis \(einmalig\)/);
  assert.equal(raidReminderStore.listByUser(GID, uid)[0]!.pauseNotifiedAt, null, 'resume clears the marker');
  raidReminderStore.deleteAllByUser(GID, uid);
});

test('migration idempotency: double ensureSchema + runMigrations on a populated DB changes nothing and never throws', () => {
  const now = Date.now();
  const row = raidReminderStore.insert({ ...BASE, guildId: GID, userId: 'mig-user', nextDueAt: now + 1e6 }, now);
  const tables = () => (sqliteHandle.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
  const before = tables();
  assert.doesNotThrow(() => { ensureSchema(); ensureSchema(); });
  assert.doesNotThrow(() => { runMigrations(); runMigrations(); });
  assert.deepEqual(tables(), before);
  assert.equal(raidReminderStore.listByUser(GID, 'mig-user').length, 1);
  assert.equal((sqliteHandle.prepare('SELECT message FROM reminders').get() as { message: string }).message, 'alt', 'legacy data untouched');
  assert.ok(before.includes('idx_raid_reminders_due') && before.includes('idx_raid_reminders_user'));
  raidReminderStore.delete(row.id);
});

test('migration: a DB created before pause_notified_at gets the column added without data loss, repeatedly', () => {
  const now = Date.now();
  const row = raidReminderStore.insert({ ...BASE, guildId: GID, userId: 'mig-user-2', nextDueAt: now + 1e6 }, now);
  sqliteHandle.exec('ALTER TABLE raid_reminders DROP COLUMN pause_notified_at');
  const has = () => (sqliteHandle.prepare("PRAGMA table_info('raid_reminders')").all() as Array<{ name: string }>).some((c) => c.name === 'pause_notified_at');
  assert.equal(has(), false);
  runMigrations();
  runMigrations();
  assert.equal(has(), true);
  const kept = sqliteHandle.prepare('SELECT user_id, pause_notified_at FROM raid_reminders WHERE id = ?').get(row.id) as { user_id: string; pause_notified_at: number | null };
  assert.equal(kept.user_id, 'mig-user-2');
  assert.equal(kept.pause_notified_at, null);
  raidReminderStore.delete(row.id);
});

// ─── Welle f: creation-time channel authority of the invoker + gateway wiring ───

test('command: the invoker needs View AND Send in the target channel (clear ephemeral message, nothing stored)', async () => {
  resetReminderCooldown();
  const uid = 'cmd-user-perm';
  const guildId = process.env.DISCORD_GUILD_ID!;
  const base = { sub: 'an', userId: uid, strings: { art: 'raid', uhrzeit: '19:45' }, ints: { tag: 4 }, channel: { id: '7771' } };
  const cases: Array<[string, Parameters<typeof fakeInteraction>[0], RegExp]> = [
    ['view only (no SendMessages)', { ...base, memberViewOnly: true }, /Dir fehlen in <#7771> die Rechte: `Nachrichten senden`\./],
    ['no rights at all', { ...base, memberCanWrite: false }, /`Kanal ansehen`, `Nachrichten senden`/],
    ['member cannot be resolved (fail closed)', { ...base, memberUnresolvable: true }, /Dir fehlen in <#7771>/],
    ['channel gone', { ...base, channelMissing: true }, /Kanal nicht gefunden/],
    ['thread', { ...base, channelIsThread: true }, /Threads/],
    ['bot lacks rights', { ...base, botCanWrite: false }, /Bot darf in diesem Kanal nicht schreiben/],
  ];
  for (const [label, opts, expected] of cases) {
    resetReminderCooldown();
    const f = fakeInteraction(opts);
    await erinnerung.execute(f.interaction);
    assert.equal(f.replies.length, 1, label);
    assert.match(f.replies[0]!.content, expected, label);
    assert.equal(f.replies[0]!.flags, MessageFlags.Ephemeral, label);
    assert.deepEqual(f.replies[0]!.allowedMentions, { parse: [] }, label);
    assert.equal(raidReminderStore.listByUser(guildId, uid).length, 0, `${label}: nothing stored`);
  }
  resetReminderCooldown();
  const ok = fakeInteraction(base);
  await erinnerung.execute(ok.interaction);
  assert.match(ok.replies[0]!.content, /angelegt/);
  assert.equal(raidReminderStore.listByUser(guildId, uid).length, 1);
  raidReminderStore.deleteAllByUser(guildId, uid);
});

function fakeGatewayClient(opts: { channel?: unknown; failChannelFetch?: boolean; dmFails?: boolean } = {}) {
  const calls = { dm: [] as unknown[], channelSend: [] as unknown[], fetchMe: 0, userFetch: [] as string[] };
  const channel =
    opts.channel === undefined
      ? {
          id: 'ch-1',
          isSendable: () => true,
          isDMBased: () => false,
          permissionsFor: () => ({ has: () => true }),
          send: async (payload: unknown) => void calls.channelSend.push(payload),
          guild: { members: { me: { id: 'me' }, fetchMe: async () => ((calls.fetchMe += 1), { id: 'me-fetched' }) } },
        }
      : opts.channel;
  const client = {
    users: {
      fetch: async (id: string) => {
        calls.userFetch.push(id);
        return { send: async (payload: unknown) => void calls.dm.push(payload) };
      },
    },
    channels: { fetch: async () => channel },
  };
  return { client, calls, channel: channel as Record<string, unknown> };
}
const gwEmbed = () => buildReminderEmbed({ kind: "raid", text: "Hallo", recurring: false }) as EmbedBuilder;

test('gateway wiring: sendChannel fetches the channel, gates it, and sends a payload that pings only the subscriber', async () => {
  const f = fakeGatewayClient();
  const gw = createReminderGateway(() => f.client as never, () => undefined);
  const embed = gwEmbed();
  await gw.sendChannel('ch-1', '4242', embed);
  assert.equal(f.calls.channelSend.length, 1);
  assert.deepEqual(f.calls.channelSend[0], reminderChannelPayload('4242', embed));
  assert.deepEqual((f.calls.channelSend[0] as { allowedMentions: unknown }).allowedMentions, { parse: [], users: ['4242'] });
  assert.equal(f.calls.fetchMe, 0, 'cached members.me is used when present');
});

test('gateway wiring: members.me missing falls back to fetchMe; a failed permission check never sends', async () => {
  const f = fakeGatewayClient();
  (f.channel.guild as { members: { me: unknown } }).members.me = null;
  const gw = createReminderGateway(() => f.client as never, () => undefined);
  await gw.sendChannel('ch-1', '1', gwEmbed());
  assert.equal(f.calls.fetchMe, 1);
  assert.equal(f.calls.channelSend.length, 1);

  const denied = fakeGatewayClient();
  denied.channel.permissionsFor = () => ({ has: () => false });
  await assert.rejects(createReminderGateway(() => denied.client as never, () => undefined).sendChannel('ch-1', '1', gwEmbed()), { code: 50013 });
  assert.equal(denied.calls.channelSend.length, 0);
});

test('gateway wiring: the reserved #updates channel is refused with a permanent code before anything is sent', async () => {
  const f = fakeGatewayClient();
  const gw = createReminderGateway(() => f.client as never, () => 'ch-1');
  await assert.rejects(gw.sendChannel('ch-1', '1', gwEmbed()), { code: 50013 });
  assert.equal(f.calls.channelSend.length, 0);
});

test('gateway wiring: unknown, non-sendable and DM-based channels give the permanent 10003, never a send', async () => {
  const sendable = fakeGatewayClient().channel;
  for (const channel of [null, { ...sendable, isSendable: () => false }, { ...sendable, isDMBased: () => true }]) {
    const f = fakeGatewayClient({ channel });
    await assert.rejects(createReminderGateway(() => f.client as never, () => undefined).sendChannel('ch-1', '1', gwEmbed()), { code: 10003 });
    assert.equal(f.calls.channelSend.length, 0);
  }
});

test('gateway wiring: sendDm resolves the user and sends the DM payload (no mentions)', async () => {
  const f = fakeGatewayClient();
  const embed = gwEmbed();
  await createReminderGateway(() => f.client as never, () => undefined).sendDm('9001', embed);
  assert.deepEqual(f.calls.userFetch, ['9001']);
  assert.deepEqual(f.calls.dm, [reminderDmPayload(embed)]);
});

test('gateway wiring: the real manager pauses only the channel subscription when the gateway reports the permanent channel error', async () => {
  const f = fakeGatewayClient();
  const { store, clock } = setup(NOW);
  const manager = new RaidReminderManager({
    store,
    gateway: createReminderGateway(() => f.client as never, () => 'ch-1'), // ch-1 is the reserved channel here
    timeZone: TZ,
    now: () => clock.t,
    log: () => undefined,
  });
  manager.add({ ...BASE, channelId: 'ch-1' });
  clock.t = DUE + MIN;
  const s = await manager.tick();
  assert.equal(s.paused, 1);
  assert.equal(store.rows[0]!.pausedReason, 'channel_unavailable');
  assert.equal(f.calls.channelSend.length, 0);
  assert.equal((await manager.tick()).paused, 0, 'paused once, no retry spam');
});
