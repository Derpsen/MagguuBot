import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parsePositiveInteger,
  radarrPayloadSchema,
  seerrPayloadSchema,
  sonarrPayloadSchema,
} from '../src/server/webhooks/schemas.ts';

test('Seerr default test notification accepts null special objects', () => {
  const parsed = seerrPayloadSchema.safeParse({
    notification_type: 'TEST_NOTIFICATION',
    event: 'Test Notification',
    subject: 'Test',
    message: 'Seerr test notification',
    image: '',
    media: null,
    request: null,
    issue: null,
    comment: null,
    extra: [],
  });

  assert.equal(parsed.success, true);
});

test('Seerr current default payload accepts plural Discord ID fields', () => {
  const parsed = seerrPayloadSchema.safeParse({
    notification_type: 'ISSUE_CREATED',
    subject: 'Dune (2021)',
    media: { media_type: 'movie', tmdbId: '438631', status: 'AVAILABLE' },
    request: {
      request_id: '42',
      requestedBy_username: 'Magguu',
      requestedBy_settings_discordIds: ['123456789012345678'],
    },
    issue: {
      issue_id: '7',
      issue_type: 'VIDEO',
      issue_status: 'OPEN',
      reportedBy_username: 'Magguu',
      reportedBy_settings_discordIds: '123456789012345678,234567890123456789',
    },
    comment: null,
    extra: [],
  });

  assert.equal(parsed.success, true);
});

test('webhook integer coercion rejects invalid, fractional, and unsafe ids', () => {
  assert.equal(parsePositiveInteger('42'), 42);
  assert.equal(parsePositiveInteger(7), 7);
  assert.equal(parsePositiveInteger('nope'), undefined);
  assert.equal(parsePositiveInteger('1.5'), undefined);
  assert.equal(parsePositiveInteger(Number.MAX_SAFE_INTEGER + 1), undefined);
});

test('arr webhook schemas tolerate null remote poster URLs', () => {
  assert.equal(sonarrPayloadSchema.safeParse({
    eventType: 'Grab',
    series: { title: 'Example', images: [{ coverType: 'poster', remoteUrl: null }] },
  }).success, true);
  assert.equal(radarrPayloadSchema.safeParse({
    eventType: 'Grab',
    movie: { title: 'Example', images: [{ coverType: 'poster', remoteUrl: null }] },
  }).success, true);
});
