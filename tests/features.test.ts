import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMovieNightComponents, buildMovieNightEmbed } from '../src/embeds/movie-night.ts';
import {
  buildAddonUpdatesChannelEmbed,
  buildBotHelpEmbed,
  buildFaqChannelEmbed,
  buildPlexActivityChannelEmbed,
} from '../src/embeds/welcome.ts';
import { buildQueueEmbed } from '../src/embeds/queue.ts';
import { buildWeeklyDigestEmbed } from '../src/embeds/weekly-digest.ts';
import { deriveAchievements } from '../src/utils/achievements.ts';
import { readResponseBytesLimited } from '../src/utils/http-body.ts';
import { planWelcomeEmbedSync } from '../src/utils/setup-plan.ts';
import { localScheduleParts, nextReminderRetryAt, parseFutureTime, weeklyPeriodKey } from '../src/utils/schedule.ts';

test('weekly schedule respects the configured IANA timezone', () => {
  const parts = localScheduleParts(new Date('2026-07-05T08:30:00.000Z'), 'Europe/Berlin');
  assert.deepEqual(parts, { dateKey: '2026-07-05', day: 0, hour: 10 });
});

test('weekly schedule catches up after the configured day without double periods', () => {
  assert.equal(weeklyPeriodKey(new Date('2026-07-05T07:00:00Z'), 'Europe/Berlin', 0, 10), null);
  assert.equal(weeklyPeriodKey(new Date('2026-07-05T08:00:00Z'), 'Europe/Berlin', 0, 10), '2026-07-05');
  assert.equal(weeklyPeriodKey(new Date('2026-07-06T08:00:00Z'), 'Europe/Berlin', 0, 10), '2026-07-05');
});

test('future time parser accepts relative values and rejects the past', () => {
  const now = Date.parse('2026-07-01T10:00:00.000Z');
  assert.equal(parseFutureTime('2h', now)?.toISOString(), '2026-07-01T12:00:00.000Z');
  assert.equal(parseFutureTime('1d', now)?.toISOString(), '2026-07-02T10:00:00.000Z');
  assert.equal(parseFutureTime('2026-06-01T10:00:00.000Z', now), null);
  assert.equal(parseFutureTime('not-a-date', now), null);
});

test('reminder retries back off and stop after five failures', () => {
  const now = new Date('2026-07-02T10:00:00Z');
  assert.equal(nextReminderRetryAt(0, now)?.toISOString(), '2026-07-02T10:05:00.000Z');
  assert.equal(nextReminderRetryAt(3, now)?.toISOString(), '2026-07-02T10:40:00.000Z');
  assert.equal(nextReminderRetryAt(4, now), null);
});

test('limited response reader enforces declared and streamed sizes', async () => {
  const accepted = await readResponseBytesLimited(new Response('abcd'), 4);
  assert.equal(new TextDecoder().decode(accepted), 'abcd');
  await assert.rejects(() => readResponseBytesLimited(new Response('abcde'), 4), /exceeds/);
  await assert.rejects(
    () => readResponseBytesLimited(new Response('a', { headers: { 'content-length': '5' } }), 4),
    /exceeds/,
  );
});

test('achievement thresholds unlock deterministic badges', () => {
  const badges = deriveAchievements({
    level: 10,
    messages: 1_000,
    rep: 25,
    suggestions: 10,
    movieVotes: 1,
    giveawayWins: 1,
    hasBirthday: true,
  });
  assert.equal(badges.some((badge) => badge.name === 'Chatmaschine'), true);
  assert.equal(badges.some((badge) => badge.name === 'Community-Stütze'), true);
  assert.equal(badges.some((badge) => badge.name === 'Glückspilz'), true);
  assert.equal(badges.length, 12);
});

test('weekly digest stays inside Discord embed limits', () => {
  const embed = buildWeeklyDigestEmbed({
    periodLabel: '28.06.2026 – 05.07.2026',
    newOnPlex: 12,
    imports: 18,
    requestsCreated: 5,
    requestsAvailable: 4,
    requestsDeclined: 1,
    requestsFailed: 0,
    suggestions: 3,
    starboardPosts: 2,
    topUser: { name: 'A'.repeat(200), xp: 12_345, level: 11 },
    sourceCounts: Array.from({ length: 40 }, (_, index) => ({ source: `source-${index}`, count: index })),
  }).toJSON();
  assert.equal((embed.title?.length ?? 0) <= 256, true);
  assert.equal(embed.fields?.every((field) => field.value.length <= 1_024), true);
});

test('movie night renders nominations and only exposes voting while open', () => {
  const night = {
    id: 1,
    guildId: '123',
    channelId: '456',
    messageId: '789',
    title: 'Sommerabend',
    scheduledAt: new Date('2026-07-05T18:00:00.000Z'),
    status: 'open' as const,
    createdBy: '123',
    createdAt: new Date('2026-07-01T10:00:00.000Z'),
    closedAt: null,
  };
  const nominations = [{
    id: 4,
    movieNightId: 1,
    title: 'Dune',
    url: 'https://example.test/dune',
    nominatedBy: '123',
    createdAt: new Date('2026-07-01T11:00:00.000Z'),
  }];
  const view = { night, nominations, voteCounts: new Map([[4, 3]]) };
  const embed = buildMovieNightEmbed(view).toJSON();
  assert.match(embed.description ?? '', /Dune/);
  assert.equal(buildMovieNightComponents(view).length, 1);
  assert.equal(buildMovieNightComponents({ ...view, night: { ...night, status: 'closed' } }).length, 0);
});

test('live queue clamps invalid progress and field sizes', () => {
  const embed = buildQueueEmbed({
    sonarr: {
      page: 1,
      pageSize: 1,
      sortKey: 'timeleft',
      sortDirection: 'ascending',
      totalRecords: 1,
      records: [{
        id: 1,
        title: 'X'.repeat(2_000),
        size: 100,
        sizeleft: -500,
        status: 'downloading',
        trackedDownloadState: 'downloading',
      }],
    },
    radarr: null,
    sab: null,
  }).toJSON();
  assert.equal(embed.fields?.every((field) => field.value.length <= 1_024), true);
  assert.match(embed.fields?.[0]?.value ?? '', /██████████████/);
});

test('pinned FAQ and Plex activity posts match current addon and session cleanup', () => {
  const faq = buildFaqChannelEmbed({}).toJSON();
  const faqText = [faq.description, ...(faq.fields ?? []).map((field) => field.value)].join('\n');
  assert.match(faqText, /EllesmereUI/);
  assert.match(faqText, /9\.0\.6\+/);
  assert.match(faqText, /MagguuUI/);
  assert.match(faqText, /Magguu Settings/);
  assert.match(faqText, /MagguuUI_Data/);
  assert.match(faqText, /MagguuUI_EUI/);
  assert.match(faqText, /MagguuUI_Media/);
  assert.match(faqText, /\[Data\]/);
  assert.match(faqText, /\[EUI\]/);
  assert.match(faqText, /\[Media\]/);
  assert.match(faqText, /alle vier aktiviert/);
  assert.match(faqText, /Profile laden/);
  assert.match(faqText, /EXBoss, EXCore/);
  assert.match(faqText, /EllesmereUI, MagguuUI, BigWigs, LittleWigs, Northern Sky, EXBoss, EXCore/);
  assert.match(faqText, /BugGrabber, BugSack, HandyNotes, MDT, Raider\.IO, Simulationcraft, Talent Tree Tweaks, WIM, Ellesmere WIM Skin, Waypoint UI, GTFO, Premade Groups Filter, KeystoneLoot/);
  assert.match(faqText, /KeystoneLoot/);
  assert.match(faqText, /Ellesmere-Startpopup/);
  assert.match(faqText, /Window & Tooltip Skins/);
  assert.match(faqText, /Edit Mode/);
  assert.match(faqText, /BigWigs, LittleWigs, Northern Sky/);
  assert.match(faqText, /Premade Groups Filter/);
  assert.match(faqText, /11 Client-Sprachen/);
  assert.match(faqText, /Archon-BiS, alle Specs/);
  assert.match(faqText, /Optionen/);
  assert.match(faqText, /Changelog/);
  assert.match(faqText, /Ready for WoW \*\*12\.1\*\*/);
  assert.match(faqText, /Midnight \*\*12\.0\*\*/);
  assert.match(faqText, /\/mui tools/);
  assert.match(faqText, /Magguu-Profile übernehmen/);
  assert.match(faqText, /Smart Tab/);
  assert.match(faqText, /Quick Focus/);
  assert.match(faqText, /Ellesmere-Lautsprecher/);
  assert.match(faqText, /NAMEN & FARBEN/);
  assert.match(faqText, /EXBoss-Split/);
  assert.match(faqText, /Profile laden nur aktivieren/);
  assert.match(faqText, /Itemlevel Party\/Raid \(2P\/4P\)/);
  assert.match(faqText, /PGF\+KeystoneLoot/);
  assert.equal(/Feintuning unter/.test(faqText), false);
  assert.equal(/Ashvane/i.test(faqText), false);
  assert.equal(/einen MagguuUI-Ordner/.test(faqText), false);
  assert.equal(/7\.9\.5/.test(faqText), false);
  assert.equal(/MagguuKSL/.test(faqText), false);
  assert.equal(/ElvUI Pflicht/.test(faqText), false);
  assert.equal(/Naowh/i.test(faqText), false);
  assert.equal(faq.fields?.every((field) => field.value.length <= 1_024), true);

  const updates = buildAddonUpdatesChannelEmbed().toJSON();
  assert.match(`${updates.description ?? ''}`, /vier.*Ordner/);
  assert.match(`${updates.description ?? ''}`, /MagguuUI_Data/);
  assert.match(`${updates.description ?? ''}`, /Magguu Settings/);
  assert.match(`${updates.description ?? ''}`, /Profile laden/);
  assert.match(`${updates.description ?? ''}`, /aktiviert nur/);
  assert.equal(/einen \*\*`MagguuUI`\*\*-Ordner/.test(`${updates.description ?? ''}`), false);
  assert.equal(/Naowh/i.test(`${updates.description ?? ''}`), false);

  const plex = buildPlexActivityChannelEmbed().toJSON();
  assert.match(`${plex.description ?? ''}`, /20 Minuten/);
  assert.match(`${plex.description ?? ''}`, /plex-now-playing/);

  const help = buildBotHelpEmbed({}).toJSON();
  assert.match(help.fields?.find((field) => field.name.includes('Downloads'))?.value ?? '', /plex-now-playing/);
  assert.equal(help.fields?.every((field) => field.value.length <= 1_024), true);
});

test('setup dry-run plans welcome embed rewrites in full mode and skips them in fast mode', () => {
  const channels = [
    { planName: '❓・faq', status: 'exists' as const },
    { planName: '🎬・aktivität', status: 'exists' as const },
    { planName: '📊・wochenrückblick', status: 'exists' as const },
  ];
  const tracked = new Set(channels.map((channel) => channel.planName));
  const names = new Set(channels.map((channel) => channel.planName));

  const full = planWelcomeEmbedSync({
    fullSync: true,
    rolesChanged: false,
    refsChanged: false,
    welcomePlanNames: names,
    channels,
    trackedPlanNames: tracked,
  });
  assert.deepEqual(full.edit, ['❓・faq', '🎬・aktivität', '📊・wochenrückblick']);
  assert.deepEqual(full.post, []);

  const fast = planWelcomeEmbedSync({
    fullSync: false,
    rolesChanged: false,
    refsChanged: false,
    welcomePlanNames: names,
    channels,
    trackedPlanNames: tracked,
  });
  assert.deepEqual(fast.skip, ['❓・faq', '🎬・aktivität', '📊・wochenrückblick']);
  assert.deepEqual(fast.edit, []);

  const missingPin = planWelcomeEmbedSync({
    fullSync: false,
    rolesChanged: false,
    refsChanged: false,
    welcomePlanNames: names,
    channels,
    trackedPlanNames: new Set(['❓・faq']),
  });
  assert.deepEqual(missingPin.post, ['🎬・aktivität', '📊・wochenrückblick']);
});
