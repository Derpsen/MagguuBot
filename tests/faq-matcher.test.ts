import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CooldownGate, faqAnswerToDiscord, looksLikeQuestion, matchFaq, tokenize, type FaqEntry } from '../src/utils/faq-matcher.ts';

const FAQ: FaqEntry[] = [
  { id: 2, category: 'general', question: 'Is MagguuUI free?', answer: '**Yes** — free.' },
  { id: 6, category: 'installation', question: 'How do I open MagguuUI?', answer: 'Type `/mui`.' },
  { id: 10, category: 'addons', question: 'How do class layouts work?', answer: 'Per character.' },
  { id: 16, category: 'troubleshooting', question: 'Where can I report a bug or ask for help?', answer: 'GitHub issues.' },
  { id: 25, category: 'addons', question: 'Why is the UI scale 0.58?', answer: 'Designed for 4K.' },
  { id: 15, category: 'troubleshooting', question: 'How do I reset MagguuUI and start fresh?', answer: 'Reset.' },
];

test('question detection ignores commands and chatter', () => {
  assert.equal(looksLikeQuestion('Is MagguuUI free?'), true);
  assert.equal(looksLikeQuestion('wie öffne ich das addon'), true);
  assert.equal(looksLikeQuestion('lol nice'), false);
  assert.equal(looksLikeQuestion('/status?'), false);
  assert.equal(looksLikeQuestion('gg everyone, great raid tonight'), false);
});

test('tokenizer drops stopwords and the product name', () => {
  assert.deepEqual(tokenize('How do I open MagguuUI?'), ['open']);
  assert.deepEqual(tokenize('Why is the UI scale 0.58?'), ['ui', 'scale', '0.58']);
});

test('confident matches answer', () => {
  assert.equal(matchFaq('Is MagguuUI free?', FAQ)?.entry.id, 2);
  assert.equal(matchFaq('is magguuui free to use?', FAQ)?.entry.id, 2);
  assert.equal(matchFaq('why is the ui scale 0.58?', FAQ)?.entry.id, 25);
  assert.equal(matchFaq('how do class layouts work', FAQ)?.entry.id, 10);
  assert.equal(matchFaq('where can i report a bug?', FAQ)?.entry.id, 16);
});

test('weak, off-topic, or rambling messages stay silent', () => {
  assert.equal(matchFaq('anyone free tonight for mythic?', FAQ), null);
  assert.equal(matchFaq('what is the best raid boss?', FAQ), null);
  assert.equal(matchFaq('how do I reset it?', FAQ), null);
  assert.equal(
    matchFaq('I installed it yesterday and the ui scale looks weird and my keybinds are tinted and class layouts broke, why?', FAQ),
    null,
  );
  assert.equal(matchFaq('???', FAQ), null);
});

test('ambiguous matches without a clear lead stay silent', () => {
  const twins: FaqEntry[] = [
    { id: 1, category: 'a', question: 'How do class layouts work?', answer: 'a' },
    { id: 2, category: 'a', question: 'How do class layouts load?', answer: 'b' },
  ];
  assert.equal(matchFaq('class layouts?', twins), null);
});

test('answers are trimmed to Discord limits', () => {
  assert.equal(faqAnswerToDiscord('<p>Hi</p><p>there</p>'), 'Hi\n\nthere');
  const long = faqAnswerToDiscord(`${'word '.repeat(2000)}`);
  assert.ok(long.length <= 3800);
});

test('cooldown gate blocks repeats within the window only', () => {
  const gate = new CooldownGate();
  assert.equal(gate.tryClaim('c:1', 1000, 0), true);
  assert.equal(gate.tryClaim('c:1', 1000, 500), false);
  assert.equal(gate.isBlocked('c:1', 999), true);
  assert.equal(gate.tryClaim('c:1', 1000, 1001), true);
});
