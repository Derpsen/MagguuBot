import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discordErrorCode, isAlreadyGone, isMessageGone, isPermanentDiscordError } from '../src/discord/discord-errors.ts';

const err = (code: unknown) => Object.assign(new Error('discord'), { code });

test('discordErrorCode: only numeric codes', () => {
  assert.equal(discordErrorCode(err(10_008)), 10_008);
  assert.equal(discordErrorCode(err('ECONNRESET')), null);
  assert.equal(discordErrorCode(new Error('x')), null);
  assert.equal(discordErrorCode(null), null);
  assert.equal(discordErrorCode('10008'), null);
});

test('isAlreadyGone: Unknown Channel / Unknown Message only (former copies in the Plex cleanup modules)', () => {
  assert.equal(isAlreadyGone(err(10_003)), true);
  assert.equal(isAlreadyGone(err(10_008)), true);
  for (const c of [50_001, 50_005, 50_013, 10_011, '10008']) assert.equal(isAlreadyGone(err(c)), false, String(c));
  assert.equal(isAlreadyGone(undefined), false);
});

test('classes do not overlap where it matters', () => {
  assert.equal(isMessageGone(err(10_003)), false); // channel gone is permanent, not "post a new message"
  assert.equal(isPermanentDiscordError(err(10_008)), false);
});
