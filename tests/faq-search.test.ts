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

const { searchFaq, faqChoices, clipChoiceText, clipChoiceValue, neutralizeMentions, editDistance, searchTokens, MAX_FAQ_CHOICES } =
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
  assert.equal(clipChoiceText('😀'.repeat(150)).length, 99, '49 emoji (98 units) + ellipsis, never above 100 UTF-16 units');
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

// ─── Welle f: clipping never cuts inside a surrogate pair / emoji sequence ───

const noLoneSurrogates = (s: string): boolean => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);

test('clipChoiceText: clips by UTF-16 units at every cut position, never leaves a lone surrogate', () => {
  for (let max = 2; max <= 12; max += 1) {
    for (const base of ['😀', 'a😀', 'ab😀c', '𝒳𝒴𝒵', 'ä😀ö']) {
      const out = clipChoiceText(base.repeat(30), max);
      assert.ok(noLoneSurrogates(out), `max=${max} base=${base}: ${JSON.stringify(out)}`);
      assert.ok(out.length <= max, `max=${max} base=${base}`);
      assert.ok(Array.from(out).length <= max, `max=${max} base=${base}`);
      assert.ok(out.endsWith('…'));
    }
  }
  assert.equal(clipChoiceText('😀😀', 4), '😀😀', 'exactly at the limit (4 units) is not clipped');
  assert.equal(clipChoiceText('😀😀😀', 4), '😀…', '3 emoji = 6 units: 1 emoji + ellipsis = 3 units');
  assert.equal(clipChoiceText('😀😀😀😀😀', 5), '😀😀…');
});

test('clipChoiceText: keeps flags, keycaps and skin-tone emoji whole (cut on grapheme boundaries)', () => {
  // (ZWJ is stripped by the invisible-character filter on purpose, so family emoji arrive as separate emoji.)
  const flag = '🇩🇪'; // 2 code points
  for (const unit of [flag, '1️⃣', '👍🏽']) {
    for (let max = 2; max <= 10; max += 1) {
      const out = clipChoiceText(`x${unit}`.repeat(10), max);
      const body = out.slice(0, -1);
      assert.ok(noLoneSurrogates(out));
      assert.ok(out.length <= max);
      // every kept grapheme is either an `x` or a complete unit
      const rest = body.split('x').join('');
      assert.ok(rest === '' || unit.repeat(rest.length / unit.length) === rest, `${JSON.stringify(unit)} max=${max}: ${JSON.stringify(out)}`);
    }
  }
});

test('faqChoices: a long emoji-heavy question is clipped to a valid, whole-character name ≤ 100 code points', () => {
  const entries = [{ id: 1, category: 'general', question: `Wie geht ${'😀'.repeat(120)} das`, answer: 'x' }];
  const [choice] = faqChoices('wie geht', entries as never);
  assert.ok(choice);
  assert.ok(noLoneSurrogates(choice.name));
  assert.ok(Array.from(choice.name).length <= 100);
});

test('truncate (embed titles/descriptions/fields used by /faq): no lone surrogate when the cut falls inside an emoji', async () => {
  const { truncate } = await import('../src/embeds/colors.ts');
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 4), 'abc');
  for (let max = 2; max <= 9; max += 1) {
    const out = truncate('a😀'.repeat(20), max);
    assert.ok(noLoneSurrogates(out), `max=${max}: ${JSON.stringify(out)}`);
    assert.ok(out.length <= max, 'UTF-16 length bound still holds (Discord counts conservatively)');
  }
  assert.equal(truncate('😀😀😀', 4), '😀…');
});

// ---- Discord choice limit: UTF-16 units AND grapheme boundaries -------------------------------------------------

test('faqChoices: name and value stay <= 100 UTF-16 units for emoji-heavy, flag, keycap and combining-mark questions', () => {
  const nasty = [
    '😀'.repeat(150),
    '🇩🇪'.repeat(80),
    '1️⃣'.repeat(60),
    '👍🏽'.repeat(70),
    `e${'\u0301'.repeat(150)}`,
    '𝒳'.repeat(120),
    `${'a'.repeat(98)}😀tail`,
    `${'a'.repeat(97)}🇩🇪tail`,
    'frage '.repeat(40),
  ];
  const entries = nasty.map((question, i) => ({ id: i + 1, category: 'allgemein', question: `frage ${question}`, answer: 'x' }));
  const choices = faqChoices('frage', entries);
  assert.equal(choices.length, entries.length);
  for (const c of choices) {
    assert.ok(c.name.length <= 100, `name ${c.name.length} units`);
    assert.ok(c.value.length <= 100);
    assert.ok(c.name.length > 0);
    assert.ok(noLoneSurrogates(c.name), JSON.stringify(c.name));
  }
});

test('clipChoiceText: every cut position of mixed text is <= max UTF-16 units and on a grapheme boundary', () => {
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const samples = ['a🇩🇪b😀1️⃣👍🏽ä'.repeat(20), `x${'\u0301'.repeat(40)}y`.repeat(10), '𝒳a'.repeat(60)];
  for (const sample of samples) {
    const whole = [...seg.segment(sample.replace(/\s+/g, ' ').trim())].map((g) => g.segment);
    for (let max = 1; max <= 40; max += 1) {
      const out = clipChoiceText(sample, max);
      assert.ok(out.length <= max, `max=${max}: ${out.length} units`);
      assert.ok(noLoneSurrogates(out));
      if (!out.endsWith('…')) continue;
      const body = out.slice(0, -1);
      // the kept text is a whole-grapheme prefix of the input (nothing split in the middle)
      let prefix = '';
      let ok = body === '';
      for (const g of whole) {
        prefix += g;
        if (prefix === body) {
          ok = true;
          break;
        }
        if (prefix.length > body.length) break;
      }
      assert.ok(ok, `max=${max}: ${JSON.stringify(out)} is not a grapheme prefix`);
    }
  }
});

test('clipChoiceText: a single grapheme larger than the limit degrades to just the ellipsis (never above max)', () => {
  const zalgo = `e${'\u0301'.repeat(200)}`;
  const out = clipChoiceText(zalgo, 100);
  assert.equal(out, '…');
  assert.ok(out.length <= 100);
});

test('clipChoiceValue: numeric ids pass through, anything longer is cut at a grapheme boundary to <= 100 units without ellipsis', () => {
  assert.equal(clipChoiceValue('123456789'), '123456789');
  assert.equal(clipChoiceValue('7\u0000\u200b'), '7');
  const long = clipChoiceValue('😀'.repeat(150));
  assert.equal(long.length, 100);
  assert.ok(noLoneSurrogates(long));
  assert.equal(clipChoiceValue('1'.repeat(150)).length, 100);
  const flags = clipChoiceValue('🇩🇪'.repeat(40));
  assert.ok(flags.length <= 100);
  assert.equal(flags.length % 4, 0, 'only whole flags');
});
