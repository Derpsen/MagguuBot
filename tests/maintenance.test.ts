import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { enforceEmbedTotalSize, formatBytes, truncate } from '../src/embeds/colors.ts';
import { buildGrabEmbed } from '../src/embeds/arr.ts';
import {
  buildReleaseEmbed,
  cleanAddonReleaseNotes,
  extractWowRetailVersion,
} from '../src/embeds/github.ts';
import {
  rememberDeliveredFeedItem,
  wasEmbedDelivered,
} from '../src/discord/feed-delivery.ts';
import { RevocationCache } from '../src/server/auth/revocation-cache.ts';
import { parseWebhookClearScope } from '../src/server/admin/webhook-clear-scope.ts';
import { webhookRetryState } from '../src/server/webhook-retry-policy.ts';
import { sanitizePayload } from '../src/server/webhook-payload-redactor.ts';
import { seerrPendingDeliveryTargets } from '../src/server/webhooks/seerr-pending-delivery.ts';
import {
  REPLAYABLE_WEBHOOK_SOURCES,
  isReplayableWebhookSource,
  webhookReplayBlockReason,
} from '../src/server/webhook-sources.ts';
import { healthLevelForEvent } from '../src/server/webhooks/schemas.ts';
import { fetchRss, parseRss, RSS_MAX_BODY_BYTES } from '../src/services/rss.ts';
import { buildServiceUrl } from '../src/services/service-url.ts';
import { isAddonRepository, parseAddonRepositories } from '../src/utils/github-routing.ts';
import { emptyEnvToUndefined, envBoolean } from '../src/utils/env.ts';
import { createRecentKeyCache } from '../src/utils/recent-key-cache.ts';
import { isPrivateIp } from '../src/utils/safe-fetch.ts';
import { webhookRetryDelayMs } from '../src/utils/retry.ts';
import { applyWebhookRetryMigration } from '../src/db/webhook-retry-migration.ts';
import { isMaintainerrEventCode } from '../src/utils/maintainerr.ts';
import {
  decidePlexActivityEvent,
  decideStaleSession,
  nextProgressWatch,
  plexActivityCorrelationKey,
  plexActivityMatchesLiveSession,
  preservePlexActivityState,
  shouldCloseOrphanActivityCard,
  shouldFlushDeferredPause,
} from '../src/utils/plex-activity.ts';
import { shouldPostWorkflowConclusion } from '../src/utils/github-routing.ts';

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

test('automatic webhook retries are limited to replay-supported inbound sources', () => {
  assert.deepEqual(REPLAYABLE_WEBHOOK_SOURCES, [
    'sonarr',
    'radarr',
    'seerr',
    'tautulli',
    'sabnzbd',
    'maintainerr',
    'github',
    'prowlarr',
  ]);
  assert.equal(isReplayableWebhookSource('rss-feed'), false);
  assert.equal(isReplayableWebhookSource('blue-tracker'), false);
  assert.equal(isReplayableWebhookSource('internal'), false);
  assert.equal(webhookReplayBlockReason('rss-feed', 'failed'), 'unsupported-source');
  assert.equal(webhookReplayBlockReason('blue-tracker', 'skipped'), 'unsupported-source');
  assert.equal(webhookReplayBlockReason('sonarr', 'posted'), 'already-posted');
  assert.equal(webhookReplayBlockReason('sonarr', 'failed'), null);
});

test('feed entries are remembered only after Discord confirms delivery', () => {
  const seen = new Set<string>();
  const item = { guid: 'post-1', title: '[EU]   Server Update' };

  assert.equal(wasEmbedDelivered(null), false);
  assert.equal(rememberDeliveredFeedItem(seen, item, false), false);
  assert.deepEqual([...seen], []);

  assert.equal(wasEmbedDelivered({ id: 'message-1' }), true);
  assert.equal(rememberDeliveredFeedItem(seen, item, true), true);
  assert.deepEqual([...seen], ['post-1', 'title:server update']);
});

test('blue-tracker enrichment distinguishes transient failures from definitive misses', async (t) => {
  const requiredEnv = {
    NODE_ENV: 'test',
    DISCORD_TOKEN: 'test-token',
    DISCORD_CLIENT_ID: 'test-client',
    DISCORD_GUILD_ID: 'test-guild',
    WEBHOOK_SECRET: 'test-webhook-secret',
  };
  const previousEnv = Object.fromEntries(
    Object.keys(requiredEnv).map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, requiredEnv);
  const { enrichBluePost, isTransientBluePostEnrichment } = await import('../src/services/blue-tracker-enrich.ts');

  const url = 'https://www.bluetracker.gg/wow/topic/eu-en/123-example/';

  const transient = await enrichBluePost(url, async () => new Response('', { status: 503 }));
  assert.deepEqual(transient, { status: 'transient-error', error: 'HTTP 503' });
  assert.equal(isTransientBluePostEnrichment(transient), true);
  const missing = await enrichBluePost(url, async () => new Response('', { status: 404 }));
  assert.deepEqual(missing, { status: 'unavailable', reason: 'http-rejected', httpStatus: 404 });
  assert.equal(isTransientBluePostEnrichment(missing), false);
  assert.deepEqual(
    await enrichBluePost(url, async () => { throw new Error('connection reset'); }),
    { status: 'transient-error', error: 'connection reset' },
  );
  assert.deepEqual(
    await enrichBluePost(url, async () => new Response('<html><body>gone</body></html>')),
    { status: 'unavailable', reason: 'no-post-content' },
  );
  assert.deepEqual(
    await enrichBluePost('https://example.test/post', async () => {
      throw new Error('fetcher must not run for unsupported hosts');
    }),
    { status: 'unavailable', reason: 'unsupported-host' },
  );

  const enriched = await enrichBluePost(
    url,
    async () => new Response('<div class="blue-post"><div class="post-content"><p>Retail hotfix details.</p></div></div>'),
  );
  assert.equal(enriched.status, 'enriched');
  if (enriched.status === 'enriched') assert.equal(enriched.post.body, 'Retail hotfix details.');
});

test('Seerr pending replays target only the failed Discord destination', () => {
  assert.deepEqual(seerrPendingDeliveryTargets(undefined, true), ['approval', 'lifecycle']);
  assert.deepEqual(seerrPendingDeliveryTargets(undefined, false), ['approval']);
  assert.deepEqual(seerrPendingDeliveryTargets('MEDIA_PENDING', true), ['approval']);
  assert.deepEqual(seerrPendingDeliveryTargets('MEDIA_PENDING_LIFECYCLE', true), ['lifecycle']);
  assert.deepEqual(seerrPendingDeliveryTargets('MEDIA_PENDING_LIFECYCLE', false), ['lifecycle']);
});

test('failed manual replay of a skipped event finishes without a phantom schedule', () => {
  assert.equal(webhookRetryState('failed', false, 1, 3), 'pending');
  assert.equal(webhookRetryState('failed', false, 3, 3), 'exhausted');
  assert.equal(webhookRetryState('skipped', false, 1, 3), 'exhausted');
  assert.equal(webhookRetryState('skipped', true, 1, 3), 'resolved');
});

test('RSS fetching surfaces transport, HTTP, size, and parse failures', async () => {
  const xml = '<?xml version="1.0"?><rss version="2.0"><channel><item><guid>post-1</guid><title>Server Update</title></item></channel></rss>';
  const items = await fetchRss('https://example.test/feed', async () => new Response(xml));
  assert.equal(items.length, 1);
  assert.equal(items[0]?.guid, 'post-1');

  await assert.rejects(
    () => fetchRss('https://example.test/feed', async () => new Response('', { status: 503 })),
    /HTTP 503/,
  );
  await assert.rejects(
    () => fetchRss('https://example.test/feed', async () => { throw new Error('DNS lookup failed'); }),
    /DNS lookup failed/,
  );
  await assert.rejects(
    () => fetchRss(
      'https://example.test/feed',
      async () => new Response('x', { headers: { 'content-length': String(RSS_MAX_BODY_BYTES + 1) } }),
    ),
    /exceeds 5 MB limit/,
  );
  assert.throws(() => parseRss('<rss><channel></rss>'), /invalid RSS XML/);
});

test('webhook cleanup rejects unknown scopes instead of treating them as all', () => {
  assert.equal(parseWebhookClearScope(undefined), 'all');
  assert.equal(parseWebhookClearScope('all'), 'all');
  assert.equal(parseWebhookClearScope('failed'), 'failed');
  assert.equal(parseWebhookClearScope('skipped'), 'skipped');
  assert.equal(parseWebhookClearScope('faild'), null);
  assert.equal(parseWebhookClearScope(''), null);
});

test('recording a revocation preserves the existing persisted revocation snapshot', () => {
  const cache = new RevocationCache(30_000, () => 10_000);
  let loads = 0;
  cache.record('new-user', new Date(9_000), () => {
    loads += 1;
    return [{ userId: 'existing-user', notValidBefore: new Date(8_000) }];
  });

  assert.equal(loads, 1);
  assert.equal(cache.isRevoked('existing-user', 7_000, () => []), true);
  assert.equal(cache.isRevoked('new-user', 8_500, () => []), true);
  assert.equal(cache.isRevoked('existing-user', 8_001, () => []), false);
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

test('Plex pause is deferred for two minutes and cancelled by a quick resume', () => {
  const now = new Date('2026-08-13T20:00:00.000Z');
  const paused = decidePlexActivityEvent({ currentState: 'play', incoming: 'pause', now });
  assert.deepEqual(paused, { action: 'defer-pause', pausedAt: now });
  assert.equal(shouldFlushDeferredPause(now, new Date(now.getTime() + 60_000)), false);
  assert.equal(shouldFlushDeferredPause(now, new Date(now.getTime() + 2 * 60_000)), true);
  assert.deepEqual(
    decidePlexActivityEvent({ currentState: 'play', incoming: 'resume', pausedAt: now, now }),
    { action: 'ignore', pausedAt: null },
  );
  assert.deepEqual(
    decidePlexActivityEvent({ currentState: 'pause', incoming: 'resume', now }),
    { action: 'apply', displayKind: 'play', pausedAt: null },
  );
  assert.deepEqual(
    decidePlexActivityEvent({ currentState: 'play', incoming: 'watched', pausedAt: now, now }),
    { action: 'apply', displayKind: 'watched', pausedAt: null },
  );
});

test('stale Plex sessions terminate after the pause or stuck-progress timeout', () => {
  const staleAfterMs = 20 * 60_000;
  const now = Date.parse('2026-08-14T18:00:00.000Z');
  const fresh = nextProgressWatch(undefined, 12_000, now);
  const stuck = nextProgressWatch(fresh, 12_000, now + staleAfterMs);

  assert.equal(decideStaleSession({
    state: 'paused',
    pausedCounterSeconds: 19 * 60,
    live: false,
    progressWatch: fresh,
    now,
    staleAfterMs,
  }), null);
  assert.equal(decideStaleSession({
    state: 'paused',
    pausedCounterSeconds: 20 * 60,
    live: false,
    progressWatch: fresh,
    now,
    staleAfterMs,
  }), 'paused');
  assert.equal(decideStaleSession({
    state: 'playing',
    pausedCounterSeconds: 0,
    live: false,
    progressWatch: stuck,
    now: now + staleAfterMs,
    staleAfterMs,
  }), 'stuck-progress');
  assert.equal(decideStaleSession({
    state: 'playing',
    pausedCounterSeconds: 0,
    live: true,
    progressWatch: stuck,
    now: now + staleAfterMs,
    staleAfterMs,
  }), null);
  assert.equal(decideStaleSession({
    state: 'playing',
    pausedCounterSeconds: 0,
    live: false,
    progressWatch: nextProgressWatch(fresh, 45_000, now + staleAfterMs),
    now: now + staleAfterMs,
    staleAfterMs,
  }), null);
  assert.equal(decideStaleSession({
    state: 'paused',
    pausedCounterSeconds: 99 * 60,
    live: false,
    progressWatch: fresh,
    now,
    staleAfterMs: 0,
  }), null);
});

test('orphan Plex activity cards close only after the live session is gone', () => {
  const now = new Date('2026-08-14T18:10:00.000Z');
  const updatedAt = new Date('2026-08-14T18:00:00.000Z');
  const live = { sessionKey: '42', user: 'Magguu', player: 'Fire TV', mediaType: 'movie' };

  assert.equal(plexActivityMatchesLiveSession('session:42', live), true);
  assert.equal(plexActivityMatchesLiveSession('fallback:magguu:fire tv:toy story', live), true);
  assert.equal(plexActivityMatchesLiveSession('music:magguu:fire tv', { ...live, mediaType: 'track' }), true);
  assert.equal(plexActivityMatchesLiveSession('session:99', live), false);

  assert.equal(shouldCloseOrphanActivityCard({
    state: 'play',
    correlationKey: 'session:42',
    updatedAt,
    sessions: [live],
    now,
  }), false);
  assert.equal(shouldCloseOrphanActivityCard({
    state: 'play',
    correlationKey: 'session:42',
    updatedAt,
    sessions: [],
    now,
  }), true);
  assert.equal(shouldCloseOrphanActivityCard({
    state: 'play',
    correlationKey: 'session:42',
    updatedAt: new Date('2026-08-14T18:09:00.000Z'),
    sessions: [],
    now,
  }), false);
  assert.equal(shouldCloseOrphanActivityCard({
    state: 'watched',
    correlationKey: 'session:42',
    updatedAt,
    sessions: [],
    now,
  }), false);
});

test('GitHub workflow successes and skipped runs stay out of Discord', () => {
  assert.equal(shouldPostWorkflowConclusion('success'), false);
  assert.equal(shouldPostWorkflowConclusion('skipped'), false);
  assert.equal(shouldPostWorkflowConclusion('failure'), true);
  assert.equal(shouldPostWorkflowConclusion('cancelled'), true);
  assert.equal(shouldPostWorkflowConclusion('timed_out'), true);
  assert.equal(shouldPostWorkflowConclusion(null), false);
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

test('webhook retry migration neutralizes pending rows for unsupported sources', () => {
  const directory = mkdtempSync(join(tmpdir(), 'magguubot-retry-source-test-'));
  const databasePath = join(directory, 'retry-sources.db');
  try {
    const database = new DatabaseSync(databasePath);
    try {
      database.exec(`CREATE TABLE webhook_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at INTEGER,
        retry_state TEXT,
        replay_of_event_id INTEGER,
        created_at INTEGER NOT NULL
      )`);
      database.exec(`
        INSERT INTO webhook_events
          (source, event_type, payload, status, next_retry_at, retry_state, created_at)
        VALUES
          ('rss-feed', 'feed-1', '{}', 'failed', 123, 'pending', 1),
          ('blue-tracker', 'new', '{}', 'failed', 123, 'pending', 1),
          ('sonarr', 'Grab', '{}', 'failed', 123, 'pending', 1)
      `);

      applyWebhookRetryMigration(database);
      applyWebhookRetryMigration(database);

      const rows = (database.prepare(`
        SELECT source, retry_state AS retryState, next_retry_at AS nextRetryAt
        FROM webhook_events
        ORDER BY id
      `).all() as Array<{ source: string; retryState: string | null; nextRetryAt: number | null }>)
        .map((row) => ({ ...row }));
      assert.deepEqual(rows, [
        { source: 'rss-feed', retryState: null, nextRetryAt: null },
        { source: 'blue-tracker', retryState: null, nextRetryAt: null },
        { source: 'sonarr', retryState: 'pending', nextRetryAt: 123 },
      ]);
    } finally {
      database.close();
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
  assert.equal(
    embed.fields?.find((field) => field.name === 'WoW-Version')?.value,
    'World of Warcraft Retail',
  );
  assert.match(embed.fields?.find((field) => field.name === 'Downloads')?.value ?? '', /CurseForge/);
  assert.match(embed.fields?.find((field) => field.name === 'Installation')?.value ?? '', /9\.0\.6\+/);
  assert.match(embed.fields?.find((field) => field.name === 'Installation')?.value ?? '', /vier MagguuUI-Ordner/);
  assert.match(embed.fields?.find((field) => field.name === 'Installation')?.value ?? '', /MagguuUI_Data/);
  assert.match(embed.fields?.find((field) => field.name === 'Installation')?.value ?? '', /Optionen \+ Changelog/);
  assert.match(embed.fields?.find((field) => field.name === 'Installation')?.value ?? '', /Ellesmere-Startpopup/);
  assert.match(embed.fields?.find((field) => field.name === 'Installation')?.value ?? '', /Window & Tooltip Skins/);
  assert.match(embed.fields?.find((field) => field.name === 'Installation')?.value ?? '', /Edit Mode MagguuUI/);
  assert.match(embed.fields?.find((field) => field.name === 'Installation')?.value ?? '', /0\.58/);
  assert.doesNotMatch(embed.fields?.find((field) => field.name === 'Installation')?.value ?? '', /einen MagguuUI-Ordner/);
  assert.doesNotMatch(embed.fields?.find((field) => field.name === 'Installation')?.value ?? '', /7\.9\.5/);
});

test('addon release embeds derive Retail versions only from explicit release-note markers', () => {
  assert.equal(extractWowRetailVersion('Ready for WoW 12.1'), '12.1');
  assert.equal(extractWowRetailVersion('Ready for WoW 12.1; still loads on Midnight 12.0'), '12.1');
  assert.equal(extractWowRetailVersion('- **Ready for WoW 12.1.0:** current Retail client.'), '12.1.0');
  assert.equal(extractWowRetailVersion('Compatible with World of Warcraft Retail 11.2.7.'), '11.2.7');
  assert.equal(extractWowRetailVersion('Supports Retail version: v12.0.9.'), '12.0.9');
  assert.equal(extractWowRetailVersion('## v99.8.7\n\n- Addon release only.'), null);
  assert.equal(extractWowRetailVersion('Ready for WoW 12.0.7.1'), null);
  assert.equal(extractWowRetailVersion(undefined), null);

  const embed = buildReleaseEmbed({
    repo: { full_name: 'Derpsen/MagguuUI', html_url: 'https://github.com/Derpsen/MagguuUI' },
    tag: 'v12.1.42',
    author: 'Derpsen',
    body: '## Changes\n\n- Ready for WoW 12.1.3.\n- Updated profiles.',
    url: 'https://github.com/Derpsen/MagguuUI/releases/tag/v12.1.42',
    prerelease: false,
    addonRelease: true,
  }).toJSON();

  assert.equal(
    embed.fields?.find((field) => field.name === 'WoW-Version')?.value,
    'World of Warcraft Retail 12.1.3',
  );
  assert.notEqual(
    embed.fields?.find((field) => field.name === 'WoW-Version')?.value,
    'World of Warcraft Retail 12.0.7',
  );
});
