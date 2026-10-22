import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { RestLike } from '../src/rollout/execute.js';
import type { Action, GuildSnapshot } from '../src/rollout/plan.js';

// execute.ts pulls in config + DB; throwaway environment, no network.
const dir = mkdtempSync(join(tmpdir(), 'magguu-exec-'));
process.env.DISCORD_TOKEN ??= 'test-token-not-used';
process.env.DISCORD_CLIENT_ID ??= '1498095100000000001';
process.env.DISCORD_GUILD_ID ??= '1400000000000000099';
process.env.WEBHOOK_SECRET ??= 'test-secret-0123456789abcdef';
process.env.DATABASE_PATH = join(dir, 'bot.db');

const { channelPatchMismatch, executeActions } = await import('../src/rollout/execute.ts');

const SNAP = { guildId: '1', botUserId: '2', botHighestRolePosition: 1, features: [], rulesChannelId: null, publicUpdatesChannelId: null, verificationLevel: 0, explicitContentFilter: 0, channels: [], roles: [], members: null } as unknown as GuildSnapshot;
const topicAction: Action = { kind: 'updateChannel', id: '42', current: '🩺・status', changes: { topic: 'Neu.' }, why: ['Thema'] };

function fakeRest(patchTopic: string, getTopic: string): RestLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async request<T>(method: string, path: string): Promise<T | null> {
      calls.push(`${method} ${path}`);
      const topic = method === 'PATCH' ? patchTopic : getTopic;
      return { id: '42', name: '🩺・status', parent_id: null, topic } as T;
    },
  };
}

test('channelPatchMismatch names the fields Discord did not store', () => {
  assert.deepEqual(channelPatchMismatch({ topic: 'A' }, { topic: 'A' }), []);
  assert.deepEqual(channelPatchMismatch({ topic: 'A' }, { topic: 'alt' }), ['Thema']);
  assert.deepEqual(channelPatchMismatch({ topic: '' }, { topic: null }), []);
  assert.deepEqual(channelPatchMismatch({ name: 'x', parent_id: '9' }, { name: 'y', parent_id: '8' }), ['Name', 'Kategorie']);
  assert.deepEqual(channelPatchMismatch({ topic: 'A' }, null), ['Antwort']);
});

test('topic PATCH is ok only when Discord echoes the new topic', async () => {
  const rest = fakeRest('Neu.', 'Neu.');
  const { results } = await executeActions(rest, SNAP, [topicAction], [], 0);
  assert.equal(results[0]?.status, 'ok');
  assert.deepEqual(rest.calls, ['PATCH /channels/42']);
});

test('topic dropped by Discord (rate limit) is reported as error, not ok', async () => {
  const rest = fakeRest('Alt', 'Alt');
  const { results } = await executeActions(rest, SNAP, [topicAction], [], 0);
  assert.equal(results[0]?.status, 'error');
  assert.match(results[0]?.detail ?? '', /Thema.*10 min/);
  assert.deepEqual(rest.calls, ['PATCH /channels/42', 'GET /channels/42']);
});

test('late-applied topic passes after the re-check', async () => {
  const { results } = await executeActions(fakeRest('Alt', 'Neu.'), SNAP, [topicAction], [], 0);
  assert.equal(results[0]?.status, 'ok');
});

test('no runtime code rewrites layout channel topics (rollout owns them)', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
  const offenders = walk('src').filter((f) => /\.setTopic\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});
