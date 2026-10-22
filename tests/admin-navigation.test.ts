import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HUB_TABS, LEGACY_REDIRECTS, NAV_SECTIONS } from '../frontend/src/lib/navigation.ts';

const OLD_SIDEBAR_PATHS = [
  '/', '/requests', '/tickets', '/warnings', '/tags', '/autoresponders', '/scheduled',
  '/role-panels', '/leaderboard', '/reputation', '/reminders', '/channels', '/webhooks', '/rss', '/settings',
];

test('admin sidebar has 8 entries in 4 sections', () => {
  assert.equal(NAV_SECTIONS.length, 4);
  assert.equal(NAV_SECTIONS.flatMap((s) => s.items).length, 8);
});

test('every former sidebar path is either still a nav entry or a legacy redirect', () => {
  const navPaths = new Set(NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.to)));
  const redirected = new Set(LEGACY_REDIRECTS.map((r) => r.from));
  assert.equal(OLD_SIDEBAR_PATHS.length, 15);
  for (const path of OLD_SIDEBAR_PATHS) {
    assert.ok(navPaths.has(path) || redirected.has(path), `${path} has no new home`);
  }
});

test('legacy redirects target an existing hub tab', () => {
  for (const r of LEGACY_REDIRECTS) {
    const tabs: ReadonlyArray<{ key: string }> = HUB_TABS[r.hub];
    assert.ok(tabs.some((t) => t.key === r.tab), `${r.from} → ${r.hub}?tab=${r.tab} missing`);
    const hubInNav = NAV_SECTIONS.some((s) => s.items.some((i) => i.to === `/${r.hub}`));
    assert.ok(hubInNav, `hub /${r.hub} not in sidebar`);
  }
});
