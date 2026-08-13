import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatEpisodeRange } from '../src/embeds/arr.ts';
import { isUpgradeFileDelete, sonarrPayloadSchema } from '../src/server/webhooks/schemas.ts';
import { resolveTautulliEventName } from '../src/utils/tautulli-event.ts';

test('formatEpisodeRange covers single, consecutive, and mixed packs', () => {
  assert.equal(formatEpisodeRange([]), undefined);
  assert.equal(formatEpisodeRange([{ season: 6, number: 17, title: 'The End' }]), 'S06E17');
  assert.equal(formatEpisodeRange([
    { season: 6, number: 17, title: 'The End (1)' },
    { season: 6, number: 18, title: 'The End (2)' },
  ]), 'S06E17-E18');
  assert.equal(formatEpisodeRange([
    { season: 1, number: 1 },
    { season: 2, number: 1 },
  ]), 'S01E01–S02E01');
});

test('isUpgradeFileDelete matches Servarr upgrade reasons and ignores manual deletes', () => {
  assert.equal(isUpgradeFileDelete({ deleteReason: 'upgrade' }), true);
  assert.equal(isUpgradeFileDelete({ isUpgrade: true }), true);
  assert.equal(isUpgradeFileDelete({ message: 'Deleted for upgrade' }), true);
  assert.equal(isUpgradeFileDelete({ deleteReason: 'manual' }), false);
  assert.equal(isUpgradeFileDelete({}), false);
});

test('Sonarr ImportComplete payloads are accepted', () => {
  assert.equal(sonarrPayloadSchema.safeParse({
    eventType: 'ImportComplete',
    series: { title: 'Lost' },
    episodes: [
      { seasonNumber: 6, episodeNumber: 17, title: 'The End (1)' },
      { seasonNumber: 6, episodeNumber: 18, title: 'The End (2)' },
    ],
  }).success, true);
});

test('Tautulli created/recently-added aliases map to the new-on-Plex card', () => {
  assert.equal(resolveTautulliEventName('created'), 'recently_added');
  assert.equal(resolveTautulliEventName('recently_added'), 'recently_added');
  assert.equal(resolveTautulliEventName('recently-added'), 'recently_added');
  assert.equal(resolveTautulliEventName('play'), 'play');
  assert.equal(resolveTautulliEventName('error'), 'error');
  assert.equal(resolveTautulliEventName(''), undefined);
});
