import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { enforceEmbedTotalSize, formatBytes, truncate } from '../src/embeds/colors.ts';
import { buildGrabEmbed } from '../src/embeds/arr.ts';
import { buildReleaseEmbed, cleanAddonReleaseNotes } from '../src/embeds/github.ts';
import { sanitizePayload } from '../src/server/webhook-payload-redactor.ts';
import { healthLevelForEvent } from '../src/server/webhooks/schemas.ts';
import { buildServiceUrl } from '../src/services/service-url.ts';
import { isAddonRepository, parseAddonRepositories } from '../src/utils/github-routing.ts';
import { emptyEnvToUndefined, envBoolean } from '../src/utils/env.ts';
import { createRecentKeyCache } from '../src/utils/recent-key-cache.ts';
import { isPrivateIp } from '../src/utils/safe-fetch.ts';
import { webhookRetryDelayMs } from '../src/utils/retry.ts';
import { applyWebhookRetryMigration } from '../src/db/webhook-retry-migration.ts';
import { isMaintainerrEventCode } from '../src/utils/maintainerr.ts';
import { plexActivityCorrelationKey, preservePlexActivityState } from '../src/utils/plex-activity.ts';

test('sanitizePayload redacts sensitive nested fields', () => {
  const sanitized = sanitizePayload({
    token: 'secret-token',
    user: {
      name: 'Magguu',
      api_key: 'service-key',
      nested: { clientSecret: 'client-secret' },
    },
  });

  assert.deepEqual(sanitized, {
    token: '[redacted]',
    user: {
      name: 'Magguu',
      api_key: '[redacted]',
      nested: { clientSecret: '[redacted]' },
    },
  });
});

test('service URLs tolerate configured trailing slashes', () => {
  assert.equal(buildServiceUrl('http://sonarr:8989/', '/api/v3/queue'), 'http://sonarr:8989/api/v3/queue');
  assert.equal(buildServiceUrl('https://example.test/sonarr///', 'api/v3/queue'), 'https://example.test/sonarr/api/v3/queue');
});

test('restored arr health events are always reported as healthy', () => {
  assert.equal(healthLevelForEvent('HealthRestored', undefined), 'ok');
  assert.equal(healthLevelForEvent('HealthRestored', 'error'), 'ok');
  assert.equal(healthLevelForEvent('Health', undefined), 'warning');
  assert.equal(healthLevelForEvent('Health', 'error'), 'error');
});

test('isPrivateIp recognizes local and private address ranges', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('10.0.0.5'), true);
  assert.equal(isPrivateIp('172.16.0.1'), true);
  assert.equal(isPrivateIp('192.168.178.2'), true);
  assert.equal(isPrivateIp('::1'), true);
  assert.equal(isPrivateIp('::ffff:192.168.1.50'), true);
  assert.equal(isPrivateIp('::ffff:7f00:1'), true);
  assert.equal(isPrivateIp('100.64.0.1'), true);
  // Bracketed IPv6 literals as returned by URL.hostname must not bypass the guard.
  assert.equal(isPrivateIp('[::1]'), true);
  assert.equal(isPrivateIp('[fd00::1]'), true);
  assert.equal(isPrivateIp('[fe80::abcd]'), true);
  assert.equal(isPrivateIp('[ff02::1]'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('2606:4700:4700::1111'), false);
  assert.equal(isPrivateIp('[2606:4700:4700::1111]'), false);
});

test('environment booleans parse false-like strings without truthy coercion', () => {
  const enabled = envBoolean(false);
  const disabled = envBoolean(true);

  assert.equal(enabled.parse('true'), true);
  assert.equal(enabled.parse('1'), true);
  assert.equal(disabled.parse('false'), false);
  assert.equal(disabled.parse('0'), false);
  assert.equal(enabled.parse(undefined), false);
  assert.equal(disabled.parse(undefined), true);
  assert.equal(enabled.safeParse('yes').success, false);
  assert.equal(emptyEnvToUndefined(''), undefined);
  assert.equal(emptyEnvToUndefined('   '), undefined);
  assert.equal(emptyEnvToUndefined('value'), 'value');
});

test('webhook retries use bounded exponential-style backoff', () => {
  assert.equal(webhookRetryDelayMs(0), 60_000);
  assert.equal(webhookRetryDelayMs(1), 5 * 60_000);
  assert.equal(webhookRetryDelayMs(2), 15 * 60_000);
  assert.equal(webhookRetryDelayMs(3), 60 * 60_000);
  assert.equal(webhookRetryDelayMs(4), 6 * 60 * 60_000);
  assert.equal(webhookRetryDelayMs(99), 6 * 60 * 60_000);
});

test('Maintainerr machine event codes are hidden while readable titles remain', () => {
  assert.equal(isMaintainerrEventCode('COLLECTION_HANDLING_FAILED'), true);
  assert.equal(isMaintainerrEventCode('MEDIA_ADDED_TO_COLLECTION'), true);
  assert.equal(isMaintainerrEventCode('Collection Handling Failed'), false);
});

test('Plex activity cards correlate sessions and keep watched as final state', () => {
  assert.equal(
    plexActivityCorrelationKey({ sessionKey: 42, user: 'ignored', title: 'ignored' }),
    'session:42',
  );
  assert.equal(
    plexActivityCorrelationKey({ user: 'MxJflix', player: 'AFTKRT', title: 'Toy Story' }),
    'fallback:mxjflix:aftkrt:toy story',
  );
  assert.equal(
    plexActivityCorrelationKey({ sessionKey: 91, user: 'Magguuu', player: 'iPhone', mediaType: 'track' }),
    'music:magguuu:iphone',
  );
  assert.equal(plexActivityCorrelationKey({ title: 'Toy Story' }), null);
  assert.equal(preservePlexActivityState('watched', 'stop'), 'watched');
  assert.equal(preservePlexActivityState('pause', 'resume'), 'resume');
});

test('legacy databases receive webhook retry columns before their indexes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'magguubot-migration-test-'));
  const databasePath = join(directory, 'legacy.db');
  try {
    const legacy = new DatabaseSync(databasePath);
    try {
      legacy.exec(`CREATE TABLE webhook_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        channel_id TEXT,
        message_id TEXT,
        status TEXT NOT NULL,
        error TEXT,
        created_at INTEGER NOT NULL
      )`);
      applyWebhookRetryMigration(legacy);
      const columns = (legacy.prepare('PRAGMA table_info(webhook_events)').all() as Array<{ name: string }>)
        .map((row) => row.name);
      const indexes = (legacy.prepare('PRAGMA index_list(webhook_events)').all() as Array<{ name: string }>)
        .map((row) => row.name);
      for (const column of ['retry_count', 'next_retry_at', 'retry_state', 'replay_of_event_id']) {
        assert.ok(columns.includes(column), `missing column: ${column}`);
      }
      assert.ok(indexes.includes('idx_webhook_retry_due'));
      assert.ok(indexes.includes('idx_webhook_replay_of'));
    } finally {
      legacy.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('embed helpers keep output inside Discord-friendly bounds', () => {
  assert.equal(formatBytes(0), '—');
  assert.equal(formatBytes(1024), '1.00 KB');
  assert.equal(truncate('abcdef', 4), 'abc…');

  const embed = {
    data: {
      title: 'T',
      description: 'x'.repeat(30),
      fields: [{ name: 'field', value: 'y'.repeat(30) }],
    },
    setDescription(value: string) {
      this.data.description = value;
      return this;
    },
    spliceFields(start: number, deleteCount: number) {
      this.data.fields.splice(start, deleteCount);
      return this;
    },
  };

  enforceEmbedTotalSize(embed, 20);
  const total =
    (embed.data.title?.length ?? 0) +
    (embed.data.description?.length ?? 0) +
    embed.data.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);

  assert.equal(total <= 20, true);

  const arrEmbed = buildGrabEmbed({
    service: 'sonarr',
    title: 'T'.repeat(400),
    quality: 'Q'.repeat(2_000),
    indexer: 'I'.repeat(2_000),
    releaseGroup: 'R'.repeat(2_000),
  }).toJSON();
  assert.equal((arrEmbed.title?.length ?? 0) <= 256, true);
  assert.equal(arrEmbed.fields?.every((field) => field.value.length <= 1_024), true);
});

test('addon repositories default to MagguuUI and only match exact names', () => {
  const repositories = parseAddonRepositories(undefined);
  assert.equal(isAddonRepository('Derpsen/MagguuUI', repositories), true);
  assert.equal(isAddonRepository('derpsen/magguuui', repositories), true);
  assert.equal(isAddonRepository('Derpsen/MagguuUI-Website', repositories), false);
});

test('recent key cache suppresses duplicate events and accepts them after expiry', () => {
  let now = 1_000;
  const cache = createRecentKeyCache({
    maxEntries: 2,
    ttlMs: 100,
    now: () => now,
  });

  assert.equal(cache.remember('Derpsen/MagguuUI\u0000v12.0.24-fix'), true);
  assert.equal(cache.remember('Derpsen/MagguuUI\u0000v12.0.24-fix'), false);

  now = 1_101;
  assert.equal(cache.remember('Derpsen/MagguuUI\u0000v12.0.24-fix'), true);
});

test('addon release embeds remove duplicate changelog headers and show update links', () => {
  const body = '# Changelog\n\nAll notable changes to the latest MagguuUI release are documented here.\n\n## v12.0.24 (2026-06-24)\n\n### Fixed\n\n- Installer works.';
  assert.equal(cleanAddonReleaseNotes(body), '### Fixed\n\n- Installer works.');

  const embed = buildReleaseEmbed({
    repo: { full_name: 'Derpsen/MagguuUI', html_url: 'https://github.com/Derpsen/MagguuUI' },
    tag: 'v12.0.24-fix',
    author: 'Derpsen',
    body,
    url: 'https://github.com/Derpsen/MagguuUI/releases/tag/v12.0.24-fix',
    prerelease: false,
    addonRelease: true,
  }).toJSON();

  assert.match(embed.title ?? '', /v12\.0\.24-fix ist verfügbar/);
  assert.doesNotMatch(embed.description ?? '', /# Changelog/);
  assert.match(embed.fields?.find((field) => field.name === 'Downloads')?.value ?? '', /CurseForge/);
});
