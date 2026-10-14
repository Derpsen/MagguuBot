import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStatusEmbed, readBuildInfo, sourceState, STATUS_WEBHOOK_SOURCES } from '../src/embeds/status.ts';

const now = new Date('2026-10-14T10:00:00Z');

test('build info reads the image SHA and falls back gracefully', () => {
  assert.deepEqual(readBuildInfo({ MAGGUU_BUILD_SHA: 'abcdef1234567', MAGGUU_BUILD_DATE: '2026-10-14T09:00:00Z' }), {
    sha: 'abcdef1234567',
    date: '2026-10-14T09:00:00Z',
  });
  assert.deepEqual(readBuildInfo({ MAGGUU_BUILD_SHA: 'unknown', MAGGUU_BUILD_DATE: 'unknown' }), { sha: null, date: null });
  assert.deepEqual(readBuildInfo({}), { sha: null, date: null });
});

test('source state flips to stale after the threshold', () => {
  assert.equal(sourceState(undefined, 24, now), 'never');
  assert.equal(sourceState(new Date(now.getTime() - 23 * 3_600_000), 24, now), 'ok');
  assert.equal(sourceState(new Date(now.getTime() - 25 * 3_600_000), 24, now), 'stale');
  assert.equal(sourceState(new Date(now.getTime() - 3 * 3_600_000), 2, now), 'stale');
});

test('status embed lists every webhook source within Discord limits', () => {
  const embed = buildStatusEmbed({
    uptimeSeconds: 90_061,
    build: { sha: 'abcdef1234567', date: null },
    lastWebhookAt: new Map([
      ['sonarr', new Date(now.getTime() - 10 * 60_000)],
      ['radarr', new Date(now.getTime() - 30 * 3_600_000)],
    ]),
    staleHours: 24,
    now,
  }).toJSON();
  const fields = embed.fields ?? [];
  for (const f of fields) assert.ok(f.value.length <= 1024);
  assert.equal(fields[0]?.value, '1d 1h 1m');
  assert.match(fields[1]?.value ?? '', /sha-abcdef1/);
  const sources = fields[2]?.value ?? '';
  assert.equal(sources.split('\n').length, STATUS_WEBHOOK_SOURCES.length);
  assert.match(sources, /✅ Sonarr: vor 10m/);
  assert.match(sources, /⚠️ Radarr: vor 30h 0m \(still > 24h\)/);
  assert.match(sources, /⚠️ SABnzbd: noch nie empfangen/);
});

test('status embed reports unknown version without a build SHA', () => {
  const embed = buildStatusEmbed({ uptimeSeconds: 5, build: { sha: null, date: null }, lastWebhookAt: new Map(), staleHours: 24, now }).toJSON();
  assert.match(embed.fields?.[1]?.value ?? '', /unbekannt/);
});
