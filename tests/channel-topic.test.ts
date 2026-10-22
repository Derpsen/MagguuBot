import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allChannelPlans, CHANNEL } from '../src/discord/server-layout.js';
import {
  MIN_TOPIC_EDIT_INTERVAL_MS,
  composeTopic,
  counterText,
  shouldEditTopic,
  topicMatches,
} from '../src/utils/channel-topic.js';

test('composed topic = layout purpose + " · " + German counter', () => {
  assert.equal(composeTopic('Film oder Serie anfragen.', counterText({ kind: 'requests', pending: 0 })), 'Film oder Serie anfragen. · 0 offen');
  assert.equal(counterText({ kind: 'approvals', pending: 2 }), '2 in der Queue');
  assert.equal(counterText({ kind: 'downloads', queued: 7 }), '7 in der Queue');
  assert.equal(counterText({ kind: 'health', errors: 1, warnings: 3 }), '🔴 1 Fehler');
  assert.equal(counterText({ kind: 'health', errors: 0, warnings: 1 }), '🟡 1 Warnung');
  assert.equal(counterText({ kind: 'health', errors: 0, warnings: 2 }), '🟡 2 Warnungen');
  assert.equal(counterText({ kind: 'health', errors: 0, warnings: 0 }), '🟢 alles ok');
  assert.equal(composeTopic('Zweck.', null), 'Zweck.');
  assert.equal(composeTopic('x'.repeat(1100), '1').length, 1024);
});

test('matcher accepts purpose (+ counter only on live-counter channels)', () => {
  assert.ok(topicMatches('Zweck.', 'Zweck.'));
  assert.ok(topicMatches('Zweck. · 3 offen', 'Zweck.', true));
  assert.ok(!topicMatches('Zweck. · 3 offen', 'Zweck.', false));
  assert.ok(!topicMatches('Zweck. · ', 'Zweck.', true));
  assert.ok(!topicMatches('📝 Film / Serie requesten · 0 pending', 'Film oder Serie anfragen.', true));
  assert.ok(!topicMatches(null, 'Zweck.', true));
});

test('updater only edits on change and at most once per cooldown per channel', () => {
  const t0 = 1_000_000;
  assert.ok(!shouldEditTopic('A · 1', 'A · 1', undefined, t0));
  assert.ok(shouldEditTopic('A · 1', 'A · 2', undefined, t0));
  assert.ok(!shouldEditTopic('A · 1', 'A · 2', t0, t0 + MIN_TOPIC_EDIT_INTERVAL_MS - 1));
  assert.ok(shouldEditTopic('A · 1', 'A · 2', t0, t0 + MIN_TOPIC_EDIT_INTERVAL_MS));
  // ≤ 2 edits in any 10 min window
  assert.ok(MIN_TOPIC_EDIT_INTERVAL_MS >= 5 * 60_000);
});

test('exactly anfragen, downloads, freigaben and status carry a live counter, all with a purpose text', () => {
  const live = allChannelPlans().filter(({ channel }) => channel.liveCounter).map(({ channel }) => channel);
  assert.deepEqual(live.map((c) => c.name).sort(), [CHANNEL.requests, CHANNEL.downloads, CHANNEL.approvals, CHANNEL.status].sort());
  for (const c of live) assert.ok(c.topic && !c.topic.includes(' · '), c.name);
});
