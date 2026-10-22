import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBurstSummaryEmbed, BURST_FOOTERS } from '../src/embeds/burst-summary.js';
import { BurstGate } from '../src/utils/burst-gate.js';
import { TtlKeys, importItemKeys, importNameKeys, normRelease } from '../src/utils/import-dedupe.js';
import { classifyBotEmbed } from '../src/utils/routing.js';

/** Fake clock + scheduler: run() fires due timers in order. */
function fakeTime() {
  let now = 0;
  let timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let seq = 0;
  return {
    now: () => now,
    schedule: (fn: () => void, ms: number) => {
      const id = ++seq;
      timers.push({ at: now + ms, fn, id });
      return () => { timers = timers.filter((t) => t.id !== id); };
    },
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > end) break;
        timers.shift();
        now = t.at;
        t.fn();
        await new Promise((r) => setImmediate(r));
      }
      now = end;
    },
  };
}

function gate(passThrough: number, time: ReturnType<typeof fakeTime>) {
  const delivered: string[] = [];
  const summaries: string[][] = [];
  const g = new BurstGate<string>({
    quietMs: 120_000, maxHoldMs: 600_000, passThrough, maxSummariesPerHour: 6,
    deliver: async (i) => { delivered.push(i); },
    summarize: async (items) => { summaries.push(items); },
    now: time.now, schedule: time.schedule,
  });
  return { g, delivered, summaries };
}

test('500 deletes within a minute → one summary card, no single cards', async () => {
  const time = fakeTime();
  const { g, delivered, summaries } = gate(0, time);
  for (let i = 0; i < 500; i++) {
    await g.submit(`Serie ${i % 85}`);
    await time.advance(100);
  }
  await time.advance(130_000);
  assert.equal(delivered.length, 0);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]!.length, 500);
});

test('a burst spread over 22 min (530 deletes) stays at a handful of cards', async () => {
  const time = fakeTime();
  const { g, delivered, summaries } = gate(0, time);
  for (let i = 0; i < 530; i++) {
    await g.submit(`t${i}`);
    await time.advance(2_500); // ~24/min for 22 min
  }
  await time.advance(130_000);
  assert.equal(delivered.length, 0);
  assert.ok(summaries.length <= 3, `${summaries.length} cards`);
  assert.equal(summaries.flat().length, 530);
});

test('a single delete still gets its normal detail card', async () => {
  const time = fakeTime();
  const { g, delivered, summaries } = gate(0, time);
  await g.submit('Einzelfilm');
  await time.advance(130_000);
  assert.deepEqual(delivered, ['Einzelfilm']);
  assert.equal(summaries.length, 0);
});

test('imports: first 5 individually, the rest as one summary; quiet resets the burst', async () => {
  const time = fakeTime();
  const { g, delivered, summaries } = gate(5, time);
  for (let i = 0; i < 40; i++) await g.submit(`imp${i}`);
  await time.advance(130_000);
  assert.equal(delivered.length, 5);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]!.length, 35);
  await time.advance(300_000);
  await g.submit('later');
  assert.equal(delivered.at(-1), 'later');
});

test('hourly cap holds further summaries until a slot is free', async () => {
  const time = fakeTime();
  const delivered: string[] = [];
  const summaries: string[][] = [];
  const g = new BurstGate<string>({
    quietMs: 1_000, maxHoldMs: 5_000, passThrough: 0, maxSummariesPerHour: 2,
    deliver: async (i) => { delivered.push(i); }, summarize: async (items) => { summaries.push(items); },
    now: time.now, schedule: time.schedule,
  });
  for (let round = 0; round < 4; round++) {
    await g.submit('a'); await g.submit('b');
    await time.advance(10_000);
  }
  assert.equal(summaries.length, 2);
  assert.equal(g.pending, 4);
  await time.advance(3_600_000);
  assert.equal(summaries.length, 3);
  assert.equal(g.pending, 0);
});

test('duplicate import (same episode / Download + ImportComplete / SAB + Sonarr) → one card', () => {
  let now = 0;
  const seen = new TtlKeys(30 * 60_000, () => now);
  const dl = { service: 'sonarr' as const, title: 'Show', mediaId: 7, episodes: [{ season: 1, number: 2 }], downloadId: 'SABnzbd_nzo_abc', releaseNames: ['Show.S01E02.1080p.WEB-GRP.mkv'] };
  const keys = [...importItemKeys(dl), ...importNameKeys(dl)];
  assert.ok(!seen.allSeen(keys));
  seen.add(keys);
  assert.ok(seen.allSeen(keys), 'repeat webhook is a duplicate');
  const complete = { ...dl, releaseNames: [] };
  assert.ok(seen.allSeen([...importItemKeys(complete), ...importNameKeys(complete)]), 'ImportComplete after Download');
  assert.ok(seen.has(`rel:${normRelease('Show.S01E02.1080p.WEB-GRP')}`), 'SAB name matches the Sonarr release');
  const next = { ...dl, episodes: [{ season: 1, number: 3 }] };
  assert.ok(!seen.allSeen([...importItemKeys(next), ...importNameKeys(next)]), 'other episode of a pack is new');
  now += 31 * 60_000;
  assert.ok(!seen.allSeen(keys), 'window expired');
});

test('summary card lists counts per service and truncates titles; routing recognises it', () => {
  const items = Array.from({ length: 530 }, (_, i) => ({ service: i < 400 ? 'Sonarr' : 'Radarr', title: `Titel ${i % 85}` }));
  const e = buildBurstSummaryEmbed('deletes', items).toJSON();
  assert.match(e.title ?? '', /530 Library-Löschungen \(Sonarr 400, Radarr 130\)/);
  assert.match(e.description ?? '', /… und 65 weitere Titel/);
  assert.equal(e.footer?.text, BURST_FOOTERS.deletes);
  assert.deepEqual(classifyBotEmbed({ footer: BURST_FOOTERS.deletes }), ['health']);
  assert.deepEqual(classifyBotEmbed({ footer: BURST_FOOTERS.imports }), ['imports']);
  assert.deepEqual(classifyBotEmbed({ footer: 'MagguuBot  ·  File aus der Library entfernt' }), ['health']);
});
