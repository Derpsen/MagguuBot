import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';

// scripts/undici-watch.mjs (decision logic, fake npm data via --fixture) and tools/undici-watch-issue.sh
// (dedupe by exact title over all states, fake `gh`). No network, no real issue.
const root = resolve(import.meta.dirname, '..');
const watch = join(root, 'scripts', 'undici-watch.mjs');
const issueSh = join(root, 'tools', 'undici-watch-issue.sh');
const dirs: string[] = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'undici-watch-')); dirs.push(d); return d; };

interface Result { state: Record<string, { version: string; undici: string | null }>; issues: { title: string; body: string }[] }
function run(djVersion: string, djUndici: string | null, restUndici: string | null): { status: number | null; out: string; result: Result } {
  const d = tmp();
  const fx = join(d, 'fx.json');
  writeFileSync(fx, JSON.stringify({
    'discord.js': { version: djVersion, dependencies: djUndici ? { undici: djUndici, tslib: '^2' } : { tslib: '^2' } },
    '@discordjs/rest': { version: '2.6.3', dependencies: restUndici ? { undici: restUndici } : {} },
  }));
  const out = join(d, 'out.json');
  const r = spawnSync('node', [watch, '--fixture', fx, '--out', out], { encoding: 'utf8', timeout: 30_000 });
  return { status: r.status, out: r.stdout, result: JSON.parse(readFileSync(out, 'utf8')) as Result };
}

test('today: discord.js 14 with undici ^6 reports nothing and prints the real state line', () => {
  const r = run('14.27.0', '^6.27.0', '^6.27.0');
  assert.equal(r.status, 0);
  assert.equal(r.result.issues.length, 0);
  assert.match(r.out, /discord\.js 14\.27\.0 \(undici \^6\.27\.0\), @discordjs\/rest 2\.6\.3 \(undici \^6\.27\.0\); 0 Meldung/);
});

test('undici ^7 and open ranges below 8 do not report', () => {
  assert.equal(run('14.30.0', '^7.2.0', '^7.0.0').result.issues.length, 0);
  assert.equal(run('14.30.0', '>=6.27.0', '~7.30.1').result.issues.length, 0);
});

test('discord.js major 15 reports once (major trigger), with the lock note', () => {
  const r = run('15.0.0', '^6.27.0', '^6.27.0');
  assert.equal(r.result.issues.length, 1);
  const i = r.result.issues[0]!;
  assert.match(i.title, /discord\.js latest ist Major 15/);
  assert.match(i.body, /Möglicher Zeitpunkt, den undici-8-Lock zu prüfen/);
  assert.match(i.body, /Lock .* bleibt bestehen/);
});

test('undici ^8 in @discordjs/rest or discord.js reports (undici trigger), also in an alternative range', () => {
  for (const [dj, rest] of [[null, '^8.10.1'], ['^8.0.0', null], ['^7.0.0 || ^8.1.0', '^6.0.0']] as const) {
    const r = run('14.99.0', dj, rest);
    assert.equal(r.result.issues.length, 1, `${dj} / ${rest}`);
    assert.match(r.result.issues[0]!.title, /nutzt undici \^8/);
  }
});

test('both triggers give two separate reports; no secrets or tokens in the output', () => {
  const r = run('15.1.0', '^8.10.1', '^8.10.1');
  assert.equal(r.result.issues.length, 2);
  assert.doesNotMatch(JSON.stringify(r.result), /token|secret|ghp_/i);
});

test('registry URL escapes every slash, backslash and the scope marker (not just the first one)', async () => {
  const { registryUrl } = (await import(watch)) as { registryUrl: (p: string) => string };
  assert.equal(registryUrl('discord.js'), 'https://registry.npmjs.org/discord.js/latest');
  assert.equal(registryUrl('@discordjs/rest'), 'https://registry.npmjs.org/%40discordjs%2Frest/latest');
  const odd = registryUrl('a/b/c\\d');
  assert.equal(odd, 'https://registry.npmjs.org/a%2Fb%2Fc%5Cd/latest');
  assert.equal(odd.slice('https://registry.npmjs.org/'.length, -'/latest'.length).includes('/'), false);
});

test('unreadable fixture fails with exit 1 (no report)', () => {
  const r = spawnSync('node', [watch, '--fixture', join(tmp(), 'missing.json'), '--out', join(tmp(), 'o.json')], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 1);
});

// Fake gh: `issue list` prints the stored issues (all states), `issue create` stores one, `label create` is a no-op.
function fakeGh(): { env: NodeJS.ProcessEnv; calls: () => string[]; store: string } {
  const d = tmp();
  const store = join(d, 'issues.json');
  const log = join(d, 'calls.log');
  writeFileSync(store, '[]');
  writeFileSync(log, '');
  const gh = join(d, 'gh');
  writeFileSync(gh, `#!/bin/sh
echo "$*" >> "${log}"
case "$1 $2" in
  "issue list") cat "${store}" ;;
  "issue create")
    title=""; while [ $# -gt 0 ]; do [ "$1" = "--title" ] && title=$2; shift; done
    jq --arg t "$title" '. + [{number: (length + 1), title: $t}]' "${store}" > "${store}.n" && mv "${store}.n" "${store}"
    echo "https://example.invalid/issues/1" ;;
  *) : ;;
esac
`);
  chmodSync(gh, 0o755);
  return { env: { ...process.env, PATH: `${d}:${process.env.PATH}`, REPO: 'o/r' }, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean), store };
}
const createCalls = (c: string[]) => c.filter((l) => l.startsWith('issue create'));

test('issue script: creates once, a second run creates nothing (lookup uses --state all, so closed issues count too)', () => {
  const g = fakeGh();
  const d = tmp();
  const file = join(d, 'res.json');
  writeFileSync(file, JSON.stringify({ state: {}, issues: [{ title: 'undici-8-Lock prüfen: A "x" $(id)', body: 'Body `with` $(danger)' }] }));
  const go = () => spawnSync('sh', [issueSh, file], { env: g.env, encoding: 'utf8', timeout: 30_000 });
  const r1 = go();
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(createCalls(g.calls()).length, 1);
  assert.match(g.calls().find((l) => l.startsWith('issue create')) ?? '', /--label dependencies/);
  const r2 = go();
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /already exists/);
  assert.equal(createCalls(g.calls()).length, 1, 'second run must not create another issue');
  assert.ok(g.calls().filter((l) => l.startsWith('issue list')).every((l) => l.includes('--state all')));
  assert.equal(JSON.parse(readFileSync(g.store, 'utf8')).length, 1);
  assert.equal(existsSync(`${file}.body.md`), false);
});

test('issue script: no reports means no gh issue call at all', () => {
  const g = fakeGh();
  const file = join(tmp(), 'res.json');
  writeFileSync(file, JSON.stringify({ state: {}, issues: [] }));
  const r = spawnSync('sh', [issueSh, file], { env: g.env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0);
  assert.equal(g.calls().length, 0);
});
