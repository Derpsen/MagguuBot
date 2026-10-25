import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

// tools/run-limited.sh is the hook wrapper for the Marco rule of 2026-10-25:
// hard limit, own session, nice 19, nothing left behind.
const SCRIPT = 'tools/run-limited.sh';
const run = (args: string[]) => spawnSync('sh', [SCRIPT, ...args], { encoding: 'utf8', timeout: 30_000 });
const leftovers = (marker: string): string => spawnSync('pgrep', ['-af', marker], { encoding: 'utf8' }).stdout.trim();

test('run-limited passes the exit code through and rejects bad input', () => {
  assert.equal(run(['5', 'true']).status, 0);
  assert.equal(run(['5', 'sh', '-c', 'exit 7']).status, 7);
  assert.equal(run(['0', 'true']).status, 2);
  assert.equal(run(['abc', 'true']).status, 2);
  assert.equal(run(['5']).status, 2);
});

test('run-limited runs the command with nice 19', () => {
  const r = run(['5', 'sh', '-c', 'nice']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '19');
});

test('run-limited kills the whole tree at the limit (also children that ignore TERM)', () => {
  const marker = '7777.77';
  const r = run(['1', 'sh', '-c', `sleep ${marker} & (trap "" TERM; sleep ${marker}) & sleep ${marker}`]);
  assert.equal(r.status, 124, 'limit hit = timeout exit code');
  assert.equal(leftovers(`sleep ${marker}`), '', 'no process of the run is left behind');
});

test('run-limited also sweeps background children of a command that exits normally', () => {
  const marker = '7778.78';
  const r = run(['5', 'sh', '-c', `sleep ${marker} & exit 3`]);
  assert.equal(r.status, 3);
  assert.equal(leftovers(`sleep ${marker}`), '');
});
