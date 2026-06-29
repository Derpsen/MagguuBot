import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seerrPayloadSchema } from '../src/server/webhooks/schemas.ts';

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
