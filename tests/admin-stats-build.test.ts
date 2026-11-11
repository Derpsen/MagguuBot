import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { readBuildInfo } from '../src/embeds/status.ts';

const overview = readFileSync(new URL('../src/server/admin/overview.ts', import.meta.url), 'utf8');

test('GET /stats includes readBuildInfo() in the JSON body (admin-only, existing route)', () => {
  assert.match(overview, /import\s*\{[^}]*readBuildInfo[^}]*\}\s*from\s*'..\/..\/embeds\/status\.js'/);
  assert.match(overview, /build:\s*readBuildInfo\(\)/);
});

test('readBuildInfo short-sha source matches /status (unknown refs stay null)', () => {
  assert.deepEqual(
    readBuildInfo({ MAGGUU_BUILD_SHA: 'abcdef1234567', MAGGUU_BUILD_DATE: '2026-10-14T09:00:00Z' }),
    { sha: 'abcdef1234567', date: '2026-10-14T09:00:00Z' },
  );
  assert.deepEqual(readBuildInfo({ MAGGUU_BUILD_SHA: 'unknown', MAGGUU_BUILD_DATE: 'unknown' }), {
    sha: null,
    date: null,
  });
});
