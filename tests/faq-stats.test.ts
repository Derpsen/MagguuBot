import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

// FAQ statistics: hooks (/faq, autocomplete selection, auto-answer), retention, status block and privacy.
// Throwaway env + DB, fake interactions, no network.
const dir = mkdtempSync(join(tmpdir(), 'magguu-faqstats-'));
Object.assign(process.env, {
  DISCORD_TOKEN: 'test-token-not-used',
  DISCORD_CLIENT_ID: '1498095100000000001',
  DISCORD_GUILD_ID: '1400000000000000099',
  WEBHOOK_SECRET: 'test-secret-0123456789abcdef',
  DATABASE_PATH: join(dir, 'bot.db'),
  FAQ_AUTOANSWER_CHANNEL_IDS: '1400000000000000555',
  STATUS_API_TOKEN: 'status-token-0123456789abcdef',
});

const { ensureSchema, sqliteHandle } = await import('../src/db/client.ts');
const stats = await import('../src/discord/faq-stats.ts');
const { faqCommand } = await import('../src/discord/commands/faq.ts');
const { setFaqCacheForTests, runFaqAutoanswer } = await import('../src/discord/faq-autoanswer.ts');
const { pruneFaqUsageDaily } = await import('../src/discord/faq-top.ts');
const { buildStatusSnapshot } = await import('../src/embeds/status.ts');
type FaqEntry = import('../src/utils/faq-matcher.ts').FaqEntry;

ensureSchema();
after(() => {
  setFaqCacheForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

const USER_ID = '1400000000000007777';
const CHANNEL_ID = '1400000000000000555';
const entries: FaqEntry[] = [
  { id: 11, category: 'Allgemein', question: 'Wie installiere ich MagguuUI?', answer: 'Mit WowUp oder CurseForge.' },
  { id: 12, category: 'Allgemein', question: 'Wie setze ich das Profil zurück?', answer: 'Per Reset-Button.' },
];
const rows = () =>
  sqliteHandle.prepare('SELECT day, faq_id AS faqId, source, count FROM faq_usage_daily ORDER BY faq_id, source').all() as Array<{
    day: string; faqId: number; source: string; count: number;
  }>;
const wipe = () => sqliteHandle.prepare('DELETE FROM faq_usage_daily').run();

let userSeq = 0;
function fakeInteraction(search: string) {
  const replies: unknown[] = [];
  userSeq += 1;
  const i = {
    // a fresh user per call: the /faq cooldown is per user and must not skip the reply
    user: { id: `${USER_ID}${userSeq}` },
    options: {
      getBoolean: () => false,
      getString: () => search,
    },
    reply: async (p: unknown) => { replies.push(p); },
    deferReply: async () => {},
    editReply: async (p: unknown) => { replies.push(p); },
  };
  return { i, replies };
}

test('/faq: free text counts as "command", a picked autocomplete id as "autocomplete", the entry id is the only key', async () => {
  wipe();
  setFaqCacheForTests(entries);
  const a = fakeInteraction('installiere MagguuUI');
  await faqCommand.execute(a.i as never);
  const b = fakeInteraction('12');
  await faqCommand.execute(b.i as never);
  const c = fakeInteraction('12');
  await faqCommand.execute(c.i as never);
  assert.equal(a.replies.length + b.replies.length + c.replies.length, 3);
  const got = rows().map((r) => `${r.faqId}:${r.source}:${r.count}`);
  assert.deepEqual(got, ['11:command:1', '12:autocomplete:2']);
});

test('/faq: not-found searches, unknown ids and an unreachable FAQ are not counted', async () => {
  wipe();
  setFaqCacheForTests(entries);
  for (const q of ['qqqqzzzz unauffindbar', '999', '   ']) {
    const x = fakeInteraction(q);
    await faqCommand.execute(x.i as never);
  }
  assert.deepEqual(rows(), []);
});

test('a failing counter never breaks /faq or the auto-answer', async () => {
  setFaqCacheForTests(entries);
  sqliteHandle.exec('ALTER TABLE faq_usage_daily RENAME TO faq_usage_daily_gone');
  try {
    const x = fakeInteraction('installiere MagguuUI');
    await faqCommand.execute(x.i as never);
    assert.equal(x.replies.length, 1, 'reply still sent');
    assert.doesNotThrow(() => stats.recordFaqUse(11, 'command'));
  } finally {
    sqliteHandle.exec('ALTER TABLE faq_usage_daily_gone RENAME TO faq_usage_daily');
  }
});

test('auto-answer counts "autoanswer" only after the reply was sent', async () => {
  wipe();
  setFaqCacheForTests(entries);
  const sent: unknown[] = [];
  const msg = (reply: () => Promise<unknown>) => ({
    channelId: CHANNEL_ID,
    content: 'Wie installiere ich MagguuUI?',
    author: { id: `${USER_ID}-aa${sent.length}` },
    reply: async (p: unknown) => { sent.push(p); return reply(); },
  });
  const ok = await runFaqAutoanswer(msg(async () => ({})) as never);
  assert.equal(ok, true);
  assert.deepEqual(rows().map((r) => `${r.faqId}:${r.source}:${r.count}`), ['11:autoanswer:1']);

  // a different channel entry: the repeat gate blocks a second answer for the same entry, so it is not counted twice
  const again = await runFaqAutoanswer({ ...msg(async () => ({})), author: { id: `${USER_ID}-other` } } as never);
  assert.equal(again, false);
  assert.deepEqual(rows().map((r) => `${r.faqId}:${r.source}:${r.count}`), ['11:autoanswer:1']);
});

test('retention: rows older than 90 local days are deleted once per day, newer ones stay', () => {
  wipe();
  const now = new Date('2026-10-25T12:00:00Z');
  const ins = sqliteHandle.prepare('INSERT INTO faq_usage_daily (day, faq_id, source, count) VALUES (?, 1, ?, 2)');
  ins.run('2026-07-26', 'command'); // 91 days before: gone
  ins.run('2026-07-27', 'command'); // 90 days before: kept
  ins.run('2026-10-24', 'autocomplete');
  assert.equal(stats.pruneFaqUsage(now), 1);
  assert.deepEqual(rows().map((r) => r.day).sort(), ['2026-07-27', '2026-10-24']);
  // daily wrapper: first call of a local day prunes, the second one the same day is a no-op
  ins.run('2026-01-01', 'command');
  assert.equal(pruneFaqUsageDaily(now), 1);
  ins.run('2026-01-02', 'command');
  assert.equal(pruneFaqUsageDaily(now), 0);
  assert.equal(pruneFaqUsageDaily(new Date('2026-10-26T12:00:00Z')), 2, 'next day: the leftover 2026-01-02 row and 2026-07-27 (now 91 days old)');
});

test('status block: last 7 local days, counts per source, top 5 with clipped titles, unknown entry has null title', () => {
  wipe();
  const now = new Date('2026-10-25T12:00:00Z');
  const ins = sqliteHandle.prepare('INSERT INTO faq_usage_daily (day, faq_id, source, count) VALUES (?, ?, ?, ?)');
  ins.run('2026-10-19', 11, 'command', 4); // inside (today - 6)
  ins.run('2026-10-18', 11, 'command', 50); // outside
  ins.run('2026-10-25', 12, 'autocomplete', 3);
  ins.run('2026-10-24', 99, 'autoanswer', 1);
  const long = [{ id: 11, question: `  ${'x'.repeat(200)}\n` }, { id: 12, question: 'Kurz' }];
  const block = stats.faqStatusBlock(long, now);
  assert.equal(block.windowDays, 7);
  assert.equal(block.total, 8);
  assert.deepEqual(block.bySource, { command: 4, autocomplete: 3, autoanswer: 1 });
  assert.deepEqual(block.top.map((t) => [t.id, t.count]), [[11, 4], [12, 3], [99, 1]]);
  assert.equal(block.top[0]?.title?.length, 80);
  assert.equal(block.top[2]?.title, null);
});

test('status snapshot carries the faq block (counts only) and stays null without one', () => {
  const base = { uptimeSeconds: 1, build: { sha: null, date: null }, lastWebhookAt: new Map(), staleHours: 24, now: new Date('2026-10-25T12:00:00Z') };
  assert.equal(buildStatusSnapshot(base).faq, null);
  const snap = buildStatusSnapshot({ ...base, faq: stats.faqStatusBlock(entries, base.now) });
  assert.equal(snap.faq?.windowDays, 7);
  assert.doesNotMatch(JSON.stringify(snap), /token|secret/i);
});

test('privacy: the counter table has no person/channel/text column and holds no id of a user or channel', async () => {
  wipe();
  setFaqCacheForTests(entries);
  await faqCommand.execute(fakeInteraction('installiere MagguuUI').i as never);
  await runFaqAutoanswer({
    channelId: CHANNEL_ID,
    content: 'Wie setze ich das Profil zurück?',
    author: { id: `${USER_ID}-priv` },
    reply: async () => ({}),
  } as never);
  const columns = (sqliteHandle.prepare('PRAGMA table_info(faq_usage_daily)').all() as Array<{ name: string }>).map((c) => c.name);
  assert.deepEqual(columns.sort(), ['count', 'day', 'faq_id', 'source']);
  const dump = JSON.stringify(rows());
  assert.ok(!dump.includes(USER_ID), 'no user id');
  assert.ok(!dump.includes(CHANNEL_ID), 'no channel id');
  assert.ok(!/installiere|Profil/i.test(dump), 'no text');
  assert.ok(!JSON.stringify(stats.faqStatusBlock(entries)).includes(USER_ID));
});
