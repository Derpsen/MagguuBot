import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

// Characterization of the three in-command parseDuration copies (remindme, giveaway,
// schedule-announce). They accept different units and spacing on purpose; do not
// unify without updating these goldens first (MEMORY hard-refactor ROI #2).
const dir = mkdtempSync(join(tmpdir(), 'magguu-parse-duration-'));
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

process.env.DISCORD_TOKEN ??= 'test-token-not-used';
process.env.DISCORD_CLIENT_ID ??= '1498095100000000001';
process.env.DISCORD_GUILD_ID ??= '1400000000000000099';
process.env.WEBHOOK_SECRET ??= 'test-secret-0123456789abcdef';
process.env.DATABASE_PATH = join(dir, 'bot.db');

const { parseDuration: parseScheduleDuration } = await import('../src/discord/commands/schedule-announce.ts');
const { parseDuration: parseRemindmeDuration } = await import('../src/discord/commands/remindme.ts');
const { parseDuration: parseGiveawayDuration } = await import('../src/discord/commands/giveaway.ts');

const S = 1000;
const M = 60_000;
const H = 3_600_000;
const D = 86_400_000;
const W = 604_800_000;

type Case = { input: string; schedule: number | null; giveaway: number | null; remindme: number | null };

const CASES: Case[] = [
  { input: '30s', schedule: 30 * S, giveaway: 30 * S, remindme: 30 * S },
  { input: '15m', schedule: 15 * M, giveaway: 15 * M, remindme: 15 * M },
  { input: '2h', schedule: 2 * H, giveaway: 2 * H, remindme: 2 * H },
  { input: '3d', schedule: 3 * D, giveaway: 3 * D, remindme: 3 * D },
  { input: ' 5m ', schedule: 5 * M, giveaway: 5 * M, remindme: 5 * M },
  // giveaway and remindme allow a space before the unit; schedule-announce does not
  { input: '5 m', schedule: null, giveaway: 5 * M, remindme: 5 * M },
  // weeks and aliases exist only on remindme
  { input: '1w', schedule: null, giveaway: null, remindme: 1 * W },
  { input: '30min', schedule: null, giveaway: null, remindme: 30 * M },
  { input: '2hour', schedule: null, giveaway: null, remindme: 2 * H },
  { input: '3days', schedule: null, giveaway: null, remindme: 3 * D },
  { input: '1week', schedule: null, giveaway: null, remindme: 1 * W },
  { input: '15secs', schedule: null, giveaway: null, remindme: 15 * S },
  // rejected by all three
  { input: '', schedule: null, giveaway: null, remindme: null },
  { input: '0m', schedule: null, giveaway: null, remindme: null },
  { input: '-1m', schedule: null, giveaway: null, remindme: null },
  { input: 'xyz', schedule: null, giveaway: null, remindme: null },
  { input: '5x', schedule: null, giveaway: null, remindme: null },
];

test('parseDuration goldens: schedule-announce vs giveaway vs remindme', () => {
  for (const c of CASES) {
    assert.equal(parseScheduleDuration(c.input), c.schedule, `schedule-announce ${JSON.stringify(c.input)}`);
    assert.equal(parseGiveawayDuration(c.input), c.giveaway, `giveaway ${JSON.stringify(c.input)}`);
    assert.equal(parseRemindmeDuration(c.input), c.remindme, `remindme ${JSON.stringify(c.input)}`);
  }
});
