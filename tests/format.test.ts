import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDeNumber, formatUptime, germanDate } from '../src/utils/format.ts';

test('formatUptime: days / hours / minutes branches', () => {
  assert.equal(formatUptime(0), '0m');
  assert.equal(formatUptime(59), '0m');
  assert.equal(formatUptime(60), '1m');
  assert.equal(formatUptime(3600), '1h 0m');
  assert.equal(formatUptime(90061), '1d 1h 1m');
});

test('germanDate: ISO day to DE, unknown shape unchanged', () => {
  assert.equal(germanDate('2026-11-09'), '09.11.2026');
  assert.equal(germanDate('nope'), 'nope');
});

test('formatDeNumber: German grouping matches Intl de-DE', () => {
  assert.equal(formatDeNumber(1234), new Intl.NumberFormat('de-DE').format(1234));
  assert.equal(formatDeNumber(0), '0');
});

test('formatDeNumber: cached formatter stays faster than fresh Intl (20k)', () => {
  const N = 20_000;
  let t0 = performance.now();
  for (let i = 0; i < N; i++) new Intl.NumberFormat('de-DE').format(i);
  const fresh = performance.now() - t0;
  t0 = performance.now();
  for (let i = 0; i < N; i++) formatDeNumber(i);
  const cached = performance.now() - t0;
  assert.ok(cached * 10 < fresh, `cached ${cached.toFixed(1)}ms not << fresh ${fresh.toFixed(1)}ms`);
});
