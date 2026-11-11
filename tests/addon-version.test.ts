import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  FALLBACK_ADDON_VERSION,
  formatAddonVersion,
  resolveAddonVersion,
} from '../src/utils/addon-version.ts';

test('formatAddonVersion accepts optional v and rejects other shapes', () => {
  assert.equal(formatAddonVersion('12.1.9'), 'v12.1.9');
  assert.equal(formatAddonVersion('v12.1.10'), 'v12.1.10');
  assert.equal(formatAddonVersion(' V12.1.9 '), 'v12.1.9');
  assert.equal(formatAddonVersion('v12.1'), null);
  assert.equal(formatAddonVersion('12.1.9-rc.1'), null);
  assert.equal(formatAddonVersion('latest'), null);
  assert.equal(formatAddonVersion(''), null);
  assert.equal(formatAddonVersion(null), null);
});

test('resolveAddonVersion uses the last well-formed announced tag, else the shipped fallback', () => {
  assert.equal(resolveAddonVersion([]), `v${FALLBACK_ADDON_VERSION}`);
  assert.equal(resolveAddonVersion(['not-a-tag']), `v${FALLBACK_ADDON_VERSION}`);
  assert.equal(resolveAddonVersion(['v12.1.8', 'v12.1.10']), 'v12.1.10');
  assert.equal(resolveAddonVersion(['v12.1.8', 'skip-me', '12.1.11']), 'v12.1.11');
});

test('pinned FAQ source has no addon version v-token (version-check scans every src/ literal)', () => {
  const src = readFileSync(new URL('../src/embeds/cards.ts', import.meta.url), 'utf8');
  assert.equal(/\bv(\d+\.\d+\.\d+)\b/.test(src), false);
});
