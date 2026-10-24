import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Runs the REAL redact_log function from the workflow file (between the redact-begin/end markers) in bash.
// All secrets below are made-up fake values.
const workflow = readFileSync(new URL('../.github/workflows/ci-alarm.yml', import.meta.url), 'utf8');
const block = /# redact-begin[^\n]*\n([\s\S]*?)# redact-end/.exec(workflow)?.[1];

function redact(input: string): string {
  assert.ok(block, 'redact block found in ci-alarm.yml');
  const script = block.split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
  const res = spawnSync('bash', ['-c', `${script}\nredact_log`], { input, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout;
}

const FAKE = {
  ghp: 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
  pat: 'github_pat_' + '11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz0123456789ABCDEFGHIJ',
  gho: 'gho_' + 'abcdefghijklmnopqrstuvwxyz0123456789',
  ghs: 'ghs_' + 'ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.c2lnbmF0dXJlLWZha2U',
  url: 'https://hooks.example.invalid/services/T000/B000/XXXXFAKEXXXX',
  hex: 'deadbeef'.repeat(8),
  b64: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5',
};

test('bare tokens, JWTs, URLs, long hex/base64 and bearer values never survive', () => {
  for (const [name, value] of Object.entries(FAKE)) {
    const out = redact(`2026-10-24T10:00:00.000Z npm ERR! while calling ${value} done\n`);
    assert.ok(!out.includes(value), `${name} leaked: ${out}`);
    assert.ok(!out.includes(value.slice(0, 20)), `${name} prefix leaked: ${out}`);
  }
  const bearer = redact('curl -H Authorization: Bearer abc.def-123_fake=\n') + redact('got bearer fakevalue123456 back\n');
  assert.ok(!bearer.includes('abc.def') && !bearer.includes('fakevalue123456'), bearer);
});

test('several secrets in one line are all replaced and the surrounding text stays readable', () => {
  const out = redact(`error: request to ${FAKE.url} failed with ${FAKE.ghp} and ${FAKE.jwt}, exit 1\n`);
  assert.ok(!out.includes('hooks.example') && !out.includes('ghp_') && !out.includes('eyJ'), out);
  assert.match(out, /^error: request to \[redacted-url\] failed with \[redacted-gh\] and \[redacted-jwt\], exit 1$/m);
});

test('keyword lines are still dropped; ordinary log lines, timestamps stripped, ANSI removed', () => {
  assert.equal(redact('API_KEY=whatever\n'), '[line redacted]\n');
  assert.equal(redact('Authorization: something short\n'), '[line redacted]\n');
  assert.equal(redact('2026-10-24T10:00:00.1234567Z \x1b[31mError: expected 3 to equal 4\x1b[0m\n'), 'Error: expected 3 to equal 4\n');
  assert.equal(redact('   at Object.<anonymous> (tests/x.test.ts:12:5)\n'), '   at Object.<anonymous> (tests/x.test.ts:12:5)\n');
  assert.equal(redact('src/utils/short-name.ts failed\n'), 'src/utils/short-name.ts failed\n');
});
