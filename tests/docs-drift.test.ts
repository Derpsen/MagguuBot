import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';

// tools/docs-sync.py (docs <-> paths/npm scripts/env) and tools/docs-drift.sh (stale words): counter-probes with
// a temp repo (hit, allow, history, clean, config error) plus "the real repo is clean". Read-only, no network.
const root = resolve(import.meta.dirname, '..');
const sync = join(root, 'tools', 'docs-sync.py');
const drift = join(root, 'tools', 'docs-drift.sh');
const dirs: string[] = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function make(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'docs-sync-'));
  dirs.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}
const runSync = (dir: string) => spawnSync('python3', [sync, '--root', dir], { encoding: 'utf8', timeout: 30_000 });
const runDrift = (dir: string, rules: string) => spawnSync('bash', [drift, rules], { cwd: dir, encoding: 'utf8', timeout: 30_000 });

const BASE = { 'README.md': 'Run `tools/run.sh` and see `docs/x.md`.\n', 'AGENTS.md': 'Rules.\n', 'tools/run.sh': '#!/bin/sh\n', 'docs/x.md': 'x\n' };

test('docs-sync: clean repo passes', () => {
  const r = runSync(make(BASE));
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /docs-sync: OK/);
});

test('docs-sync: missing path is a hit, shortened path and history/allow lines are not', () => {
  const r = runSync(make({ ...BASE, 'README.md': 'See `tools/gone.sh` and shortened `docs/x.md`.\n' }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /README\.md:1: \[paths\] `tools\/gone\.sh`/);
  assert.doesNotMatch(r.stdout, /docs\/x\.md` does not/);
  const ok = runSync(make({
    ...BASE,
    'README.md': '(2026-10-01: removed `tools/gone.sh`)\nHA `configuration.yaml` is external.\n',
    '.github/docs-sync.txt': '# external file\n^README\\.md:configuration\\.yaml$\n',
  }));
  assert.equal(ok.status, 0, ok.stdout);
});

test('docs-sync: npm scripts and env variables are compared with package.json / .env.example / Unraid XML / config schema', () => {
  const dir = make({
    ...BASE,
    'package.json': '{"scripts": {"build": "x"}}',
    '.env.example': 'USED_VAR=1\n# UNUSED_VAR=2\n',
    'src/config.ts': 'const schema = z.object({\n  USED_VAR: z.string(),\n  NEW_KEY: z.string().optional(),\n  NODE_ENV: z.string(),\n});\n',
    'unraid/app.xml': '<Config Target="USED_VAR" Type="Variable"/>\n<Config Target="XML_ONLY" Type="Variable"/>\n',
    'README.md': '`npm run build`, `npm run nope`, `USED_VAR`, `USED_MISSING`, `OTHER_THING`.\n',
  });
  const r = runSync(dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /`npm run nope` is not a script/);
  assert.doesNotMatch(r.stdout, /npm run build/);
  assert.match(r.stdout, /UNUSED_VAR is documented but not used/);
  assert.match(r.stdout, /XML_ONLY is set in the Unraid template/);
  assert.match(r.stdout, /NEW_KEY is read by the config schema/);
  assert.match(r.stdout, /`USED_MISSING` is named in the docs/);
  assert.doesNotMatch(r.stdout, /OTHER_THING|NODE_ENV/);
});

test('docs-sync: bad allow regex is a config error (exit 2)', () => {
  assert.equal(runSync(make({ ...BASE, '.github/docs-sync.txt': '([\n' })).status, 2);
});

test('docs-drift.sh: hit, allow, clean and config errors', () => {
  const rules = '@files README.md\n@allow \\(20[0-9]{2}-[0-9]{2}-[0-9]{2}: \nOldName\told name\n';
  const hit = runDrift(make({ 'README.md': 'Uses OldName.\n(2026-10-01: OldName retired)\n', 'r.txt': rules }), 'r.txt');
  assert.equal(hit.status, 1);
  assert.deepEqual(hit.stdout.trim().split('\n'), ['README.md:1: old name']);
  assert.equal(runDrift(make({ 'README.md': 'Fine.\n', 'r.txt': rules }), 'r.txt').status, 0);
  const bad = make({ 'README.md': 'x\n', 'r.txt': '@files README.md\nno tab here\n' });
  assert.equal(runDrift(bad, 'r.txt').status, 2);
  assert.equal(runDrift(bad, 'missing.txt').status, 2);
});

test('the real repo is docs-drift and docs-sync clean', () => {
  const a = spawnSync('bash', [drift], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  assert.equal(a.status, 0, a.stdout);
  const b = spawnSync('python3', [sync], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  assert.equal(b.status, 0, b.stdout);
});
