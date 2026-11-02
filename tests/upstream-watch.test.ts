import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error plain .mjs tool without type declarations
import * as uw from '../tools/upstream-watch.mjs';

test('satisfies: peer ranges used by the lock checks', () => {
  assert.equal(uw.satisfies('>=4.8.4 <6.1.0', '7.0.0'), false);
  assert.equal(uw.satisfies('>=4.8.4 <6.1.0', '6.0.3'), true);
  assert.equal(uw.satisfies('>=4.8.4 <7.1.0', '7.0.0'), true);
  assert.equal(uw.satisfies('^0.47.1', '0.48.0'), false);
  assert.equal(uw.satisfies('^0.47.1 || ^0.48.0', '0.48.0'), true);
  assert.equal(uw.satisfies('>=0.47.0', '0.48.0'), true);
  assert.equal(uw.satisfies('^6.27.0', '8.0.0'), false);
  assert.equal(uw.satisfies('^6.27.0 || ^8.0.0', '8.0.0'), true);
  assert.equal(uw.satisfies('8.x', '8.2.0'), true);
  assert.equal(uw.satisfies('~7.0.0', '7.1.0'), false);
  assert.equal(uw.satisfies('6.0.0 - 7.2.0', '7.0.0'), true);
  assert.equal(uw.satisfies('*', '7.0.0'), true);
  assert.equal(uw.satisfies('garbage', '7.0.0'), false);
});

test('evaluateNpm: today all locks stay, flips are detected', () => {
  const today = uw.evaluateNpm({
    'typescript-eslint': { latest: { version: '8.72.1', peerDependencies: { typescript: '>=4.8.4 <6.1.0' } } },
    'nuxt-og-image': { latest: { version: '7.0.7', peerDependencies: { satori: '^0.47.1' } } },
    nuxt: { distTags: { latest: '4.6.3' } },
    nitro: { distTags: { latest: '3.0.261029-rc' } },
    'discord.js': { distTags: { latest: '14.28.0' } },
    '@discordjs/rest': { latest: { version: '2.6.3', dependencies: { undici: '^6.27.0' } } },
    '@types/node': { distTags: { latest: '26.4.1' } },
  });
  assert.ok(Object.values(today).every((s: any) => s.met === false), JSON.stringify(today));
  const later = uw.evaluateNpm({
    nitro: { distTags: { latest: '3.0.0' } },
    'discord.js': { distTags: { latest: '15.0.0' } },
    '@types/node': { distTags: { latest: '27.0.0' } },
    '@discordjs/rest': { latest: { version: '3.0.0', dependencies: { undici: '^8.1.0' } } },
  });
  assert.equal(later['lock.nitro3.nitro'].met, true);
  assert.equal(later['lock.discordjs15.discord.js'].met, true);
  assert.equal(later['lock.typesnode27.@types/node'].met, true);
  assert.equal(later['lock.undici8.@discordjs/rest'].met, true);
});

test('evaluateNode / evaluateReleases', () => {
  const n = uw.evaluateNode([{ version: 'v27.0.0', lts: false }, { version: 'v26.13.0', lts: 'Lithium' }]);
  assert.equal(n['node.lts'].value, 'v26.13.0 (Lithium)');
  assert.equal(n['node.newest-is-lts'].met, false);
  const r = uw.evaluateReleases({ sonarrLatest: 'v4.0.20.3014', sonarrList: [{ tag_name: 'v5.0.0.100', prerelease: true }], profilarrLatest: 'v2.3.1' });
  assert.equal(r['sonarr.latest-stable'].met, false);
  assert.equal(r['sonarr.v5-prerelease'].value, 'ja');
  assert.equal(uw.evaluateReleases({ sonarrLatest: 'v5.0.1.1' })['sonarr.latest-stable'].met, true);
});

test('evaluateRepo: private -> n/a, Renovate PRs, red CI uses the newest run per workflow, unreadable alerts n/a', () => {
  assert.deepEqual(uw.evaluateRepo('Derpsen/MagguuUI', { public: false }), { 'repo.MagguuUI.visibility': { value: 'n/a (nicht öffentlich lesbar)', met: null } });
  const s = uw.evaluateRepo('Derpsen/MagguuBot', {
    public: true,
    pulls: [{ number: 9, title: 'feat: x', user: { login: 'marco' } }, { number: 7, title: 'chore(deps): a', user: { login: 'renovate[bot]' } }],
    runs: [
      { name: 'ci', status: 'completed', conclusion: 'success' },
      { name: 'ci', status: 'completed', conclusion: 'failure' },
      { name: 'docker', status: 'in_progress', conclusion: null },
      { name: 'docker', status: 'completed', conclusion: 'failure' },
    ],
    dependabot: null,
    codeScanning: [{}, {}],
  });
  assert.equal(s['repo.MagguuBot.renovate-prs'].value, '#7 chore(deps): a');
  assert.equal(s['repo.MagguuBot.ci-main'].value, 'rot: docker');
  assert.equal(s['repo.MagguuBot.dependabot-alerts'].value, 'n/a');
  assert.equal(s['repo.MagguuBot.code-scanning-alerts'].value, '2 offen');
});

test('diff, merge and payload: only changes, unreadable keys keep the previous value', () => {
  const prev = { a: { value: '1' }, b: { value: 'x' }, gone: { value: 'g' } };
  const cur = { a: { value: '2' }, b: { value: 'x' }, neu: { value: 'n' } };
  const d = uw.diffSignals(prev, cur);
  assert.deepEqual(d.map((c: any) => c.key), ['a', 'gone', 'neu']);
  assert.deepEqual(uw.diffSignals(prev, uw.mergeWithPrevious(prev, { ...prev, a: undefined }, ['a'])), []);
  const p = uw.buildPayload({ repository: 'Derpsen/MagguuBot', runUrl: 'https://github.com/x/actions/runs/1', changes: d });
  assert.equal(p.title, 'upstream-watch');
  assert.deepEqual(p.changes, ['a: 1 -> 2', 'gone: g -> (weg)', 'neu: (neu) -> n']);
  assert.equal(uw.idempotencyKey(p), uw.idempotencyKey({ ...p }));
  assert.notEqual(uw.idempotencyKey(p), uw.idempotencyKey({ ...p, title: 'TEST' }));
});

test('watchdog: stale after max hours, no baseline is not stale', () => {
  const now = Date.parse('2026-11-03T16:53:00Z');
  assert.equal(uw.watchdog({ state: { lastScheduledAt: '2026-11-03T06:40:00Z' }, now }).stale, false);
  assert.equal(uw.watchdog({ state: { lastScheduledAt: '2026-11-02T06:40:00Z' }, now }).stale, true);
  assert.equal(uw.watchdog({ state: null, now }).stale, false);
});

test('postEscalation: secrets never logged, only https, status reported', async () => {
  const seen: any[] = [];
  const logged: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { logged.push(a.join(' ')); };
  try {
    const fake = async (url: string, init: any) => { seen.push({ url, init }); return { ok: true, status: 204 } as Response; };
    const payload = uw.buildPayload({ title: 'TEST', repository: 'r', runUrl: '', changes: [], test: true });
    assert.deepEqual(await uw.postEscalation(payload, { url: 'https://hook.example/x', bearer: 's3cr3t', fetchImpl: fake }), { sent: true, status: 204 });
    assert.equal(seen[0].init.headers.authorization, 'Bearer s3cr3t');
    assert.equal(JSON.parse(seen[0].init.body).title, 'TEST');
    assert.equal((await uw.postEscalation(payload, { url: 'http://hook.example/x', bearer: 's', fetchImpl: fake })).sent, false);
    assert.equal((await uw.postEscalation(payload, { url: '', bearer: '', fetchImpl: fake })).sent, false);
    const failing = async () => { throw new Error('boom https://hook.example/x s3cr3t'); };
    const r = await uw.postEscalation(payload, { url: 'https://hook.example/x', bearer: 's3cr3t', fetchImpl: failing });
    assert.ok(!String(r.status).includes('s3cr3t') && !String(r.status).includes('hook.example'));
  } finally { console.log = orig; }
  assert.ok(logged.every((l) => !l.includes('s3cr3t')));
});

test('collect: npm/GitHub failures keep keys out instead of writing n/a noise', async () => {
  const fake = async (url: string) => {
    if (url.includes('registry.npmjs.org')) return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
    if (url.includes('nodejs.org')) return { ok: true, status: 200, json: async () => [{ version: 'v26.13.0', lts: 'Lithium' }] } as unknown as Response;
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  };
  const { signals, failed } = await uw.collect({ fetchImpl: fake });
  assert.ok(failed.includes('lock.ts7.typescript-eslint'));
  assert.ok(failed.includes('sonarr.latest-stable'));
  assert.equal(signals['node.lts'].value, 'v26.13.0 (Lithium)');
  assert.equal(signals['repo.MagguuBot.visibility'].value, 'n/a (nicht öffentlich lesbar)');
});
