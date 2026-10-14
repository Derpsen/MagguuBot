import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAddonReleaseAnnouncementEmbed, stripMarkdown, summarizeReleaseNotes } from '../src/embeds/addon-release.ts';
import { decideRelease } from '../src/utils/addon-release-decision.ts';

const BODY = `# Changelog

All notable changes to the latest MagguuUI release are documented here.

## v12.1.8 (2026-10-20)

Ready for WoW 12.1. MagguuUI lives inside **EllesmereUI**. Type \`/mui\` to open it.

### Große Neuerungen

- Updated Magguu profiles. Click gold **Apply Magguu profiles**.
- Rogue layouts changed — see [docs](https://ui.magguu.xyz/guide).
- Third
- Fourth item
- Fifth item

### Weitere Features

- *Raider.IO* builds load on left-click.

### Install notes

- Leave all four folders enabled.

### Bugfixes

- Fixed \`Audio Device Switcher\` right-click.

## v12.1.7 (2026-10-10)

### Bugfixes

- Old fix that must not appear.
`;

test('markdown is stripped to plain text', () => {
  assert.equal(stripMarkdown('Click **gold** `/mui` and [docs](https://x.y) _now_'), 'Click gold /mui and docs now');
});

test('summary keeps only the newest version and the three known headings', () => {
  const s = summarizeReleaseNotes(BODY);
  assert.equal(s.intro, 'Ready for WoW 12.1. MagguuUI lives inside EllesmereUI. Type /mui to open it.');
  assert.deepEqual(s.sections.map((x) => x.heading), ['Große Neuerungen', 'Weitere Features', 'Bugfixes']);
  assert.equal(s.sections[0]?.bullets.length, 3);
  assert.equal(s.sections[0]?.omitted, 2);
  assert.equal(s.sections[0]?.bullets[1], 'Rogue layouts changed — see docs.');
  assert.equal(s.sections[2]?.bullets[0], 'Fixed Audio Device Switcher right-click.');
  assert.ok(!JSON.stringify(s).includes('Old fix'));
  assert.ok(!JSON.stringify(s).includes('Leave all four'));
});

test('summary is deterministic and survives empty bodies', () => {
  assert.deepEqual(summarizeReleaseNotes(BODY), summarizeReleaseNotes(BODY));
  assert.deepEqual(summarizeReleaseNotes(null), { intro: '', sections: [] });
});

test('release embed respects Discord limits and links the full release', () => {
  const huge = `## v1.0.0\n\n### Bugfixes\n\n${Array.from({ length: 40 }, () => `- ${'x'.repeat(2000)}`).join('\n')}`;
  for (const body of [BODY, huge]) {
    const e = buildAddonReleaseAnnouncementEmbed({ tag: 'v12.1.8', body, url: 'https://github.com/Derpsen/MagguuUI/releases/tag/v12.1.8' }).toJSON();
    assert.ok((e.description ?? '').length <= 4096);
    assert.match(e.description ?? '', /releases\/tag\/v12\.1\.8/);
    for (const f of e.fields ?? []) assert.ok(f.value.length <= 1024);
  }
});

test('first start seeds; known tags and prereleases are skipped; new tags announce', () => {
  assert.equal(decideRelease({ tag_name: 'v12.1.7' }, []), 'seed');
  assert.equal(decideRelease({ tag_name: 'v12.1.7' }, ['v12.1.7']), 'skip');
  assert.equal(decideRelease({ tag_name: 'V12.1.7' }, ['v12.1.7']), 'skip');
  assert.equal(decideRelease({ tag_name: 'v12.1.8', prerelease: true }, ['v12.1.7']), 'skip');
  assert.equal(decideRelease({ tag_name: 'v12.1.8' }, ['v12.1.7']), 'announce');
});
