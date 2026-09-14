import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHANNEL_CATALOG, isChannelKey } from '../src/discord/channel-catalog.js';

test('channel catalog is the ChannelKey source of truth', () => {
  const keys = CHANNEL_CATALOG.map((entry) => entry.key);
  assert.equal(new Set(keys).size, keys.length, 'catalog keys must be unique');
  assert.equal(isChannelKey('grabs'), true);
  assert.equal(isChannelKey('movieNight'), true);
  assert.equal(isChannelKey('ticketLogs'), true);
  assert.equal(isChannelKey('rules'), false);
  assert.equal(isChannelKey('general'), false);
  assert.equal(isChannelKey('not-a-key'), false);
  assert.equal(isChannelKey(''), false);
  for (const entry of CHANNEL_CATALOG) {
    assert.equal(isChannelKey(entry.key), true, entry.key);
    assert.ok(entry.label.length > 0, entry.key);
    assert.ok(entry.description.length > 0, entry.key);
  }
});