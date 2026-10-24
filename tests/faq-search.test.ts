import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'faq-search-'));
Object.assign(process.env, {
  DISCORD_TOKEN: 'test-token',
  DISCORD_CLIENT_ID: '1',
  DISCORD_GUILD_ID: '2',
  WEBHOOK_SECRET: 'test-webhook-secret-0123456789abcdef',
  DATABASE_PATH: join(dir, 'test.db'),
});

const { searchFaq, faqChoices, clipChoiceText, neutralizeMentions, editDistance, searchTokens, MAX_FAQ_CHOICES } =
  await import('../src/utils/faq-search.ts');
const { buildFaqReply, resolveFaq, autocompleteFaq, faqCommand } = await import('../src/discord/commands/faq.ts');
const { setFaqCacheForTests } = await import('../src/discord/faq-autoanswer.ts');
const { commands } = await import('../src/discord/commands/index.ts');

type Entry = { id: number; category: string; question: string; answer: string };
const FAQ: Entry[] = [
  { id: 2, category: 'general', question: 'Is MagguuUI free?', answer: 'Yes, MagguuUI is free and non-commercial.' },
  { id: 6, category: 'installation', question: 'How do I install MagguuUI?', answer: 'Use the WowUp collection or the addon folder.' },
  { id: 10, category: 'addons', question: 'How do class layouts work?', answer: 'Layouts are stored per character.' },
  { id: 11, category: 'addons', question: 'How do I use Whisper Messenger?', answer: 'Whisper Messenger is the whisper chat. Open it with /wm.' },
  { id: 15, category: 'troubleshooting', question: 'How do I reset MagguuUI and start fresh?', answer: 'Use the reset button in the settings.' },
  { id: 16, category: 'troubleshooting', question: 'Where can I report a bug or ask for help?', answer: 'Write to contact@magguu.xyz or open an issue.' },
  { id: 25, category: 'addons', question: 'Warum ist die UI-Skalierung 0.58?', answer: 'Für 4K gestaltet. Größe lässt sich ändern.' },
];

test('tokens: umlauts, plurals, short noise', () => {
  assert.deepEqual(searchTokens('Größe & Fenster!'), ['grosse', 'fenster']);
  assert.deepEqual(searchTokens('a b layouts'), ['layout']);
});

test('edit distance is bounded and handles transposition', () => {
  assert.equal(editDistance('install', 'instal', 2), 1);
  assert.equal(editDistance('instlal', 'install', 2), 1);
  assert.equal(editDistance('abcdef', 'uvwxyz', 2), 3);
});

test('ranking: title beats answer keyword, prefix and typo match', () => {
  assert.equal(searchFaq('install', FAQ)[0]?.entry.id, 6);
  assert.equal(searchFaq('instal', FAQ)[0]?.entry.id, 6);
  assert.equal(searchFaq('instalation', FAQ)[0]?.entry.id, 6);
  assert.equal(searchFaq('reset', FAQ)[0]?.entry.id, 15);
  assert.equal(searchFaq('bug report', FAQ)[0]?.entry.id, 16);
  assert.equal(searchFaq('whisper', FAQ)[0]?.entry.id, 11);
  // category and answer keywords are searchable too
  assert.equal(searchFaq('wowup', FAQ)[0]?.entry.id, 6);
  assert.equal(searchFaq('contact@magguu.xyz', FAQ)[0]?.entry.id, 16);
  // diacritics-insensitive, German
  assert.equal(searchFaq('skalierung', FAQ)[0]?.entry.id, 25);
  assert.equal(searchFaq('grosse', FAQ)[0]?.entry.id, 25);
});

test('ranking: full coverage beats partial, unrelated words give no hits', () => {
  const hits = searchFaq('reset magguuui', FAQ);
  assert.equal(hits[0]?.entry.id, 15);
  assert.deepEqual(searchFaq('xqzvwy', FAQ), []);
  assert.deepEqual(searchFaq('xqzvwy plmokn', FAQ), []);
});

test('empty input lists the first entries in site order, capped', () => {
  const hits = searchFaq('   ', FAQ);
  assert.equal(hits.length, FAQ.length);
  assert.deepEqual(hits.slice(0, 3).map((h) => h.entry.id), [10, 11, 25]);
  const many: Entry[] = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, category: 'c', question: `Frage ${i}`, answer: 'x' }));
  assert.equal(searchFaq('', many).length, 25);
  assert.equal(searchFaq('frage', many).length, 25);
  assert.deepEqual(searchFaq('anything', []), []);
});

test('autocomplete choices: max 25, name and value <= 100, single line', () => {
  const long = 'x'.repeat(300);
  const many: Entry[] = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    category: 'cat',
    question: `Frage ${i} ${long}\nzweite Zeile\u202E`,
    answer: 'a',
  }));
  const choices = faqChoices('frage', many);
  assert.equal(choices.length, MAX_FAQ_CHOICES);
  for (const c of choices) {
    assert.ok(c.name.length >= 1 && Array.from(c.name).length <= 100, `name length ${c.name.length}`);
    assert.ok(c.value.length >= 1 && c.value.length <= 100);
    assert.match(c.value, /^\d+$/);
    assert.doesNotMatch(c.name, /[\n\r\u202E]/);
  }
  assert.equal(faqChoices('', many).length, 25);
  assert.equal(clipChoiceText('ä'.repeat(150)).length, 100);
  assert.equal(Array.from(clipChoiceText('😀'.repeat(150))).length, 100);
});

test('autocomplete reads only the in-memory cache (cold cache → empty, warm → results)', () => {
  setFaqCacheForTests(null);
  assert.deepEqual(autocompleteFaq('install'), []);
  setFaqCacheForTests(FAQ);
  assert.equal(autocompleteFaq('install')[0]?.value, '6');
  setFaqCacheForTests(null);
});

test('escaping: mentions neutralised, markdown escaped in echoed input', () => {
  assert.doesNotMatch(neutralizeMentions('@everyone @here <@123> <@!4> <@&5> <#6>'), /@everyone|@here|<@\d|<@!\d|<@&\d|<#\d/);
  const embed = buildFaqReply('@everyone <@123> **fett** [x](http://evil) xqzvwy', FAQ).toJSON();
  const text = embed.description ?? '';
  assert.doesNotMatch(text, /@everyone|<@123>/);
  assert.doesNotMatch(text, /\*\*fett\*\*(?!\\)/);
  assert.match(text, /contact@magguu\.xyz/);
  const evil: Entry[] = [{ id: 1, category: 'x', question: 'Ping @everyone <@999> now', answer: '@here <@&7> hello' }];
  const json = buildFaqReply('ping', evil).toJSON();
  assert.doesNotMatch(`${json.title}${json.description}`, /@everyone|@here|<@999>|<@&7>/);
});

test('unknown entry, unknown id, empty and unreachable FAQ give friendly embeds', () => {
  assert.equal(resolveFaq('9999', FAQ).entry, null);
  assert.match(buildFaqReply('9999', FAQ).toJSON().description ?? '', /nicht (mehr )?|gibt es nicht/);
  assert.match(buildFaqReply('nonsense-zzz', FAQ).toJSON().description ?? '', /keinen passenden/);
  assert.match(buildFaqReply('  ', FAQ).toJSON().description ?? '', /Suchbegriff/);
  assert.match(buildFaqReply('install', []).toJSON().description ?? '', /nicht erreichbar/);
});

test('answers: id resolves exactly, free text resolves best hit with similar questions', () => {
  const byId = resolveFaq('11', FAQ);
  assert.equal(byId.entry?.id, 11);
  const text = resolveFaq('wie installiere ich install', FAQ);
  assert.equal(text.entry?.id, 6);
  const json = buildFaqReply('6', FAQ).toJSON();
  assert.match(json.title ?? '', /install/i);
  assert.match(json.description ?? '', /WowUp/);
  const multi = buildFaqReply('magguuui', FAQ).toJSON();
  assert.ok((multi.fields?.length ?? 0) <= 1);
});

test('/faq is a registered utility command with an autocomplete string option and no ping', async () => {
  const json = faqCommand.data.toJSON();
  assert.equal(json.name, 'faq');
  const opt = json.options?.find((o) => o.name === 'suche') as { autocomplete?: boolean; required?: boolean } | undefined;
  assert.equal(opt?.autocomplete, true);
  assert.equal(opt?.required, true);
  assert.equal(faqCommand.category, 'utility');
  assert.equal(commands.get('faq'), faqCommand);

  setFaqCacheForTests(FAQ);
  const replies: Record<string, unknown>[] = [];
  const interaction = {
    user: { id: 'u-faq-1' },
    options: { getBoolean: () => false, getString: () => '6' },
    reply: async (p: Record<string, unknown>) => void replies.push(p),
    deferReply: async () => undefined,
    editReply: async (p: Record<string, unknown>) => void replies.push(p),
  };
  await faqCommand.execute(interaction as never);
  assert.deepEqual((replies[0]?.allowedMentions as { parse: unknown[] }).parse, []);
  assert.equal((replies[0]?.embeds as unknown[]).length, 1);
  // second call within the cooldown → ephemeral notice
  await faqCommand.execute(interaction as never);
  assert.match(String(replies[1]?.content), /warte/);
  setFaqCacheForTests(null);
});
