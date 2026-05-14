import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enforceEmbedTotalSize, formatBytes, truncate } from '../src/embeds/colors.ts';
import { sanitizePayload } from '../src/server/webhook-payload-redactor.ts';
import { isPrivateIp } from '../src/utils/safe-fetch.ts';

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

test('isPrivateIp recognizes local and private address ranges', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('10.0.0.5'), true);
  assert.equal(isPrivateIp('172.16.0.1'), true);
  assert.equal(isPrivateIp('192.168.178.2'), true);
  assert.equal(isPrivateIp('::1'), true);
  assert.equal(isPrivateIp('::ffff:192.168.1.50'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('2606:4700:4700::1111'), false);
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
});
