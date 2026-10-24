import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_SCRUB_LENGTH, scrubString } from '../src/utils/scrub.ts';

// Pathological inputs for every scrub pattern. Before the USERINFO fix 200 kB of `a.a.a.` ran >20 s (quadratic).
// The limit is deliberately generous (linear code needs well under 0.5 s even on a slow CI runner), so the test only
// trips on a real complexity regression, not on machine noise.
const SIZE = 200_000;
const LIMIT_MS = 3000;

function rep(unit: string, size = SIZE): string {
  return unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
}

const CASES: Record<string, string> = {
  'USERINFO dots': rep('a.'),
  'USERINFO dashes': rep('-token'),
  'USERINFO trailing dash': rep('token-'),
  'USERINFO plus/digits': rep('a1+'),
  'USERINFO scheme run + many ://': rep('a.b://'),
  'USERINFO long userinfo without @': `http://${'a:'.repeat(SIZE / 2)}`,
  'USERINFO repeated userinfo start': rep('x://a:'),
  'FREETEXT_KEY token repeated': rep('token '),
  'FREETEXT_KEY colon repeated': rep('token:'),
  'FREETEXT_KEY dash repeated': rep('x-api-key-'),
  'FREETEXT_KEY spaces after key': `token${' '.repeat(SIZE)}`,
  'FREETEXT_KEY spaces after colon': `token:${' '.repeat(SIZE)}`,
  'FREETEXT_KEY unterminated quote': rep("token:'"),
  'FREETEXT_KEY unterminated dquote': rep('token:"'),
  'FREETEXT_KEY bearer repeated': rep('token: bearer '),
  'FREETEXT_KEY bearer + spaces': `token: bearer${' '.repeat(SIZE)}`,
  'FREETEXT_KEY access-': rep('access-'),
  'FREETEXT_SECRET repeated': rep('password: "'),
  'FREETEXT_SECRET is': rep('secret is '),
  'FREETEXT_SECRET spaces': `password${' '.repeat(SIZE)}`,
  'PARAM repeated': rep('&token'),
  'PARAM key': rep(' key'),
  'PARAM long value': `?apikey=${'a'.repeat(SIZE)}`,
  'JSON_SECRET escapes': `"password" : "${'\\\\'.repeat(SIZE / 2)}`,
  'JSON_SECRET repeated': rep('"token":"'),
  'BEARER repeated': rep('bearer '),
  'BEARER long value': `bearer ${'a'.repeat(SIZE)}`,
  'GITHUB_TOKEN repeated': rep('ghp_'),
  'GITHUB_TOKEN pat': rep('github_pat_'),
  'JWT repeated': rep('eyJabcd.'),
  'JWT long': `eyJ${'a'.repeat(SIZE)}`,
  'DISCORD_WEBHOOK repeated': rep('/webhooks/1/'),
  'DISCORD_WEBHOOK long id': `/webhooks/${'1'.repeat(SIZE)}`,
  'DISCORD_BOT_TOKEN M run': 'M'.repeat(SIZE),
  'DISCORD_BOT_TOKEN dots': rep(`M${'a'.repeat(24)}.`),
  'DISCORD_BOT_TOKEN partial': rep(`M${'a'.repeat(24)}.aaaaaa.`),
  'whitespace only': ' '.repeat(SIZE),
  'newlines only': '\n'.repeat(SIZE),
};

for (const [name, input] of Object.entries(CASES)) {
  test(`scrub stays fast on 200 kB pathological input: ${name}`, () => {
    assert.ok(input.length >= SIZE);
    const started = performance.now();
    const out = scrubString(input);
    const ms = performance.now() - started;
    assert.ok(typeof out === 'string');
    assert.ok(ms < LIMIT_MS, `${name}: ${Math.round(ms)} ms (limit ${LIMIT_MS} ms)`);
  });
}

test('scrub: input above MAX_SCRUB_LENGTH is cut with a marker before any pattern runs (a 5 MB input stays fast)', () => {
  const huge = rep('a.', 5_000_000);
  const started = performance.now();
  const out = scrubString(huge);
  const ms = performance.now() - started;
  assert.ok(ms < LIMIT_MS, `${Math.round(ms)} ms`);
  assert.ok(out.length < MAX_SCRUB_LENGTH + 64);
  assert.match(out, /…\[truncated \d+ chars\]$/);
  // Everything that is kept is still scrubbed, a secret past the cut simply does not appear at all.
  const withSecret = `${'x '.repeat(MAX_SCRUB_LENGTH / 2)}apikey=SECRETVALUE1 `;
  assert.ok(!scrubString(withSecret).includes('SECRETVALUE1'));
  const early = `apikey=SECRETVALUE2 ${'x '.repeat(MAX_SCRUB_LENGTH)}`;
  const earlyOut = scrubString(early);
  assert.ok(earlyOut.startsWith('apikey=[redacted] '));
  assert.ok(!earlyOut.includes('SECRETVALUE2'));
});

test('scrub: the cut never splits a surrogate pair; normal sizes are untouched', () => {
  const edge = `${'a'.repeat(MAX_SCRUB_LENGTH - 1)}😀tail`;
  const out = scrubString(edge);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(out), 'no lone high surrogate');
  assert.equal(scrubString('a'.repeat(MAX_SCRUB_LENGTH)), 'a'.repeat(MAX_SCRUB_LENGTH), 'exactly the limit is not cut');
});

test('USERINFO coverage is unchanged by the linear rewrite', () => {
  const cases: Array<[string, string]> = [
    ['https://user:pw@host.example/x', 'https://[redacted]@host.example/x'],
    ['postgres://u:p@db:5432/x', 'postgres://[redacted]@db:5432/x'],
    ['git+ssh://token@github.com/x', 'git+ssh://[redacted]@github.com/x'],
    ['svn+http.v2://u:p@h', 'svn+http.v2://[redacted]@h'],
    ['1a.b://u:p@h', '1a.b://[redacted]@h'],
    ['see (HTTP://U:P@H/x) now', 'see (HTTP://[redacted]@H/x) now'],
    ['a://u:p@h and b://x:y@z', 'a://[redacted]@h and b://[redacted]@z'],
    ['https://host.example/path@notuserinfo', 'https://host.example/path@notuserinfo'],
    ['no scheme ://u:p@h', 'no scheme ://u:p@h'],
    ['1+://u:p@h', '1+://u:p@h'],
    ['mail me at user@example.com', 'mail me at user@example.com'],
  ];
  for (const [input, expected] of cases) assert.equal(scrubString(input), expected, input);
});
