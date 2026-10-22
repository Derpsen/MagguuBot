import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BRAND_COLOR, WEBSITE_LOGO_URL } from '../src/embeds/colors.ts';
import {
  CARDS,
  CARD_FOOTER_TEXT,
  buildCommandsCard,
  buildTicketPanelCard,
  buildWelcomeCard,
  TICKET_SELECT_CUSTOM_ID,
  commandIndex,
  renderCard,
  resolveChannelRefs,
  type CardContext,
} from '../src/embeds/cards.ts';
import { CHANNEL } from '../src/discord/server-layout.ts';
import { auditMessages, findDeadChannelMentions, findUnknownCommands, maskDeep, maskSecrets } from '../src/utils/card-audit.ts';
import { cardLayoutActions, planCards, type LiveMessage, type TrackedCard } from '../src/rollout/cards-plan.ts';
import type { Action } from '../src/rollout/plan.ts';

const BOT = '1498095100000000001';
const HUMAN = '1400000000000000001';

const noCommands: CardContext = { channels: {}, commands: new Map() };
const someCommands = commandIndex([
  { name: 'help' },
  { name: 'search', options: [{ type: 1, name: 'movie' }, { type: 1, name: 'show' }] },
  { name: 'tag', options: [{ type: 2, name: 'admin', options: [{ type: 1, name: 'add' }] }, { type: 1, name: 'get' }] },
  { name: 'rank', options: [{ type: 3, name: 'user' }] },
]);

test('every card uses the website style and stays inside Discord limits', () => {
  assert.ok(CARDS.length >= 18);
  assert.equal(new Set(CARDS.map((c) => c.planName)).size, CARDS.length, 'plan names are unique');
  for (const spec of CARDS) {
    const { body, hash } = renderCard(spec, noCommands);
    const embeds = body.embeds as Array<{ color?: number; footer?: { text: string; icon_url?: string }; description?: string; fields?: Array<{ value: string }> }>;
    assert.equal(embeds[0]?.color, BRAND_COLOR, spec.planName);
    assert.equal(embeds[0]?.footer?.text, CARD_FOOTER_TEXT, spec.planName);
    assert.equal(embeds[0]?.footer?.icon_url, WEBSITE_LOGO_URL, spec.planName);
    assert.ok((embeds[0]?.description ?? '').length <= 4096, spec.planName);
    assert.ok((embeds[0]?.fields ?? []).every((f) => f.value.length <= 1024), spec.planName);
    assert.match(hash, /^[a-f0-9]{16}$/);
    assert.equal(spec.pin, true);
  }
});

test('welcome channel order is welcome, rules, roles, commands', () => {
  const inWelcome = CARDS.filter((c) => c.channel === CHANNEL.welcome).map((c) => c.planName);
  assert.deepEqual(inWelcome, [CHANNEL.welcome, `${CHANNEL.welcome}#regeln`, `${CHANNEL.welcome}#rollen`, `${CHANNEL.welcome}#hilfe`]);
});

test('missing channels never produce a mention (no #unbekannt)', () => {
  for (const spec of CARDS) {
    const text = JSON.stringify(renderCard(spec, noCommands).body);
    assert.equal(/<#\d+>/.test(text), false, spec.planName);
  }
  const ctx: CardContext = { channels: { requests: '111111111111111111' }, commands: new Map() };
  const welcome = JSON.stringify(buildWelcomeCard(ctx).embeds[0]!.toJSON());
  assert.match(welcome, /<#111111111111111111>/);
});

test('command cards only list registered commands', () => {
  const desc = buildCommandsCard({ channels: {}, commands: someCommands }).embeds[0]!.toJSON().description ?? '';
  assert.match(desc, /`\/search movie`/);
  assert.match(desc, /`\/rank`/);
  assert.equal(/\/queue|\/plex-top|\/wrapped/.test(desc), false);
  assert.equal(/\/movie-night/.test(desc), false);
  const empty = buildCommandsCard(noCommands).embeds[0]!.toJSON().description ?? '';
  assert.equal(/`\/[a-z]/.test(empty), false);
});

test('commandIndex keeps subcommands and groups', () => {
  assert.deepEqual([...someCommands.get('search')!.subcommands].sort(), ['movie', 'show']);
  assert.deepEqual([...someCommands.get('tag')!.subcommands].sort(), ['admin add', 'get']);
  assert.equal(someCommands.get('rank')!.subcommands.size, 0);
});

test('resolveChannelRefs ignores channels that do not exist (archived or deleted)', () => {
  const refs = resolveChannelRefs({ [CHANNEL.requests]: '1', [CHANNEL.blizzard]: '2', [CHANNEL.updates]: '3' }, new Set(['1', '3']));
  assert.equal(refs.requests, '1');
  assert.equal(refs.addonUpdates, '3');
  assert.equal(refs.blizzard, undefined);
});

test('audit flags dead channel mentions and unknown commands', () => {
  assert.deepEqual(findDeadChannelMentions('siehe <#111111111111111111> und <#222222222222222222>', new Set(['111111111111111111'])), ['<#222222222222222222>']);
  assert.deepEqual(findUnknownCommands('`/search movie` `/search book` `/nope` `/rank user`', someCommands), ['/search book', '/nope']);
  assert.deepEqual(findUnknownCommands('</tag get:123456789012345678> </ghost:123456789012345679>', someCommands), ['/ghost']);
  assert.deepEqual(findUnknownCommands('Im Spiel `/mui` oder `/reload`', someCommands), [], 'WoW commands are ignored');
  const findings = auditMessages([
    { channelId: 'c', channelName: 'x', messageId: 'm1', embeds: [{ description: '<#999999999999999999> `/nope`' }] },
    { channelId: 'c', channelName: 'x', messageId: 'm1', embeds: [{ description: '<#999999999999999999>' }] },
  ], new Set(), someCommands);
  assert.deepEqual(findings.map((f) => `${f.kind}:${f.token}`), ['deadChannel:<#999999999999999999>', 'unknownCommand:/nope']);
});

test('export masking hides tokens, webhooks and api keys', () => {
  const fake = ['MTQ5ODA5NTEwMDAwMDAwMDAwMQ', 'GaBcDe', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('.');
  const masked = maskSecrets(`token ${fake} https://discord.com/api/webhooks/123/abcDEF_ghi ?apikey=deadbeef Bearer abcdefghijklmnopqrstuvwx ${'a1'.repeat(16)}`);
  assert.equal(masked.includes(fake), false);
  assert.equal(masked.includes('abcDEF_ghi'), false);
  assert.equal(masked.includes('deadbeef'), false);
  assert.equal(masked.includes('a1'.repeat(16)), false);
  assert.deepEqual(maskDeep({ a: [{ b: 'password=hunter2xx' }] }), { a: [{ b: 'password=[masked]' }] });
});

// ─── planCards ────────────────────────────────────────────────────────────

const ctx: CardContext = { channels: {}, commands: someCommands };
const rendered = CARDS.map((spec) => renderCard(spec, ctx));
const channelIds = new Map(CARDS.map((c, i) => [c.channel, String(2_000 + i)]));
const cards = rendered.map((r) => ({ rendered: r, channelId: channelIds.get(r.spec.channel) }));

let nextId = 10_000n;
function postedState(): { tracked: TrackedCard[]; live: Map<string, LiveMessage> } {
  const tracked: TrackedCard[] = [];
  const live = new Map<string, LiveMessage>();
  for (const { rendered: r, channelId } of cards) {
    const id = String(nextId++);
    tracked.push({ planName: r.spec.planName, channelId: channelId!, messageId: id, contentHash: r.hash });
    live.set(id, { id, channelId: channelId!, authorId: BOT, pinned: true, embeds: r.body.embeds as LiveMessage['embeds'] });
  }
  return { tracked, live };
}

test('planCards is a no-op when every card is live, ordered and unchanged', () => {
  const { tracked, live } = postedState();
  assert.deepEqual(planCards({ botUserId: BOT, cards, tracked, live, protectedIds: new Set() }), []);
});

test('planCards edits on hash change and re-pins an unpinned card', () => {
  const { tracked, live } = postedState();
  tracked[0]!.contentHash = 'old';
  live.get(tracked[1]!.messageId)!.pinned = false;
  const ops = planCards({ botUserId: BOT, cards, tracked, live, protectedIds: new Set() });
  assert.deepEqual(ops.map((o) => o.op), ['edit', 'pin']);
});

test('planCards re-posts a channel set when a card is missing or out of order', () => {
  const { tracked, live } = postedState();
  const welcomeRows = tracked.filter((t) => t.channelId === channelIds.get(CHANNEL.welcome));
  live.delete(welcomeRows[2]!.messageId);
  const ops = planCards({ botUserId: BOT, cards, tracked, live, protectedIds: new Set() });
  assert.equal(ops.filter((o) => o.op === 'delete').length, 3);
  assert.deepEqual(ops.filter((o) => o.op === 'post').map((o) => (o as { planName: string }).planName), welcomeRows.map((r) => r.planName));
  const firstPost = ops.findIndex((o) => o.op === 'post');
  assert.ok(ops.slice(firstPost).every((o) => o.op === 'post'), 'deletes come before posts');
});

test('planCards removes old cards, unpins foreign bot pins and never touches humans or protected', () => {
  const { tracked, live } = postedState();
  const ch = channelIds.get(CHANNEL.chat)!;
  const add = (id: string, m: Partial<LiveMessage>): void => {
    live.set(id, { id, channelId: ch, authorId: BOT, pinned: true, embeds: [], ...m });
  };
  add('900001', { embeds: [{ title: '❓  Alles rund ums Addon', footer: { text: 'MagguuBot  ·  x' } }] });
  add('900002', { embeds: [{ title: 'Server-Wartung Samstag' }] });
  add('900003', { authorId: HUMAN, embeds: [{ title: '📜 Regeln', footer: { text: 'MagguuBot' } }] });
  add('900004', { embeds: [{ title: '🎬 Filmabend', footer: { text: 'MagguuBot · ui.magguu.xyz' } }] });
  add('900005', { pinned: false, embeds: [{ title: '📜 Server-Regeln', footer: { text: 'MagguuBot' } }] });
  tracked.push({ planName: '🎭・rollen-colors', channelId: ch, messageId: '900006', contentHash: null });
  add('900006', { pinned: false, embeds: [{ title: '🎨 Nickname-Farbe wählen', footer: { text: 'MagguuBot' } }] });
  const ops = planCards({ botUserId: BOT, cards, tracked, live, protectedIds: new Set(['900004']) });
  const byId = (id: string): string[] => ops.filter((o) => 'messageId' in o && o.messageId === id).map((o) => o.op);
  assert.deepEqual(byId('900001'), ['delete']);
  assert.deepEqual(byId('900002'), ['unpin']);
  assert.deepEqual(byId('900003'), []);
  assert.deepEqual(byId('900004'), []);
  assert.deepEqual(byId('900005'), ['delete']);
  assert.deepEqual(byId('900006'), ['delete']);
  assert.ok(ops.some((o) => o.op === 'forget' && o.planName === '🎭・rollen-colors'));
});

test('planCards reports cards whose channel does not exist', () => {
  const ops = planCards({ botUserId: BOT, cards: [{ rendered: rendered[0]!, channelId: undefined }], tracked: [], live: new Map(), protectedIds: new Set() });
  assert.deepEqual(ops.map((o) => o.op), ['missingChannel']);
});

test('cardLayoutActions blocks until the rollout created its dependencies', () => {
  const plexRef = '1522315377428791527';
  const refs = (blizzard: string) => ({ [CHANNEL.blizzard]: blizzard, [CHANNEL.plexActivity]: plexRef });
  const create: Action = { kind: 'createChannel', ref: 'new:channel:blizzard', name: CHANNEL.blizzard, type: 0, parent: 'new:category:ui', overwrites: [] };
  const key: Action = { kind: 'setChannelKey', key: 'blizzard', target: 'new:channel:blizzard', targetName: CHANNEL.blizzard, previous: null };
  const blocked = cardLayoutActions({ actions: [create, key], channelRefs: refs('new:channel:blizzard') });
  assert.match(blocked.blocker ?? '', /discord-rollout/);
  assert.deepEqual(blocked.actions, []);

  const rename: Action = { kind: 'updateChannel', id: '1496130817129447456', current: '📰・blue-tracker', changes: { name: CHANNEL.blizzard, parent: '1496166299414433983' }, why: ['umbenennen'] };
  const plexMove: Action = { kind: 'updateChannel', id: plexRef, current: '🎬・aktivität', changes: { name: CHANNEL.plexActivity, parent: '1496166299414433984' }, why: ['umbenennen'] };
  const other: Action = { kind: 'updateChannel', id: '42', current: 'x', changes: { name: 'y' }, why: [] };
  const starboard: Action = { kind: 'setChannelKey', key: 'starboard', target: '1495831168745213972', targetName: CHANNEL.chat, previous: '1' };
  const pendingKey: Action = { kind: 'setChannelKey', key: 'faq', target: 'new:channel:help', targetName: CHANNEL.help, previous: null };
  const community: Action = { kind: 'enableCommunity', rules: '1', updates: '2', verificationLevel: 1, explicitContentFilter: 2 };
  const ready = cardLayoutActions({
    actions: [rename, plexMove, other, { ...key, target: '1496130817129447456' }, starboard, pendingKey, community],
    channelRefs: refs('1496130817129447456'),
  });
  assert.equal(ready.blocker, null);
  assert.deepEqual(ready.actions.map((a) => a.kind), ['updateChannel', 'updateChannel', 'setChannelKey', 'setChannelKey']);
  assert.ok(!ready.actions.some((a) => a.kind === 'enableCommunity'), 'never touches guild settings');
});

test('planCards deletes misplaced Plex-activity cards and duplicate live panels, pins the live panel', () => {
  const downloads = '1522173079055372308';
  const plex = '1522315377428791527';
  const live = new Map<string, LiveMessage>();
  const add = (id: string, m: Partial<LiveMessage>): void => {
    live.set(id, { id, channelId: downloads, authorId: BOT, pinned: false, embeds: [], ...m });
  };
  add('1530000000000000001', { embeds: [{ title: '▶️ Spielt ab', author: { name: 'Plex-Aktivität · Server' }, footer: { text: 'MagguuBot · Plex-Aktivität' } }] });
  add('1530000000000000002', { channelId: plex, embeds: [{ title: '▶️ Spielt ab', author: { name: 'Plex-Aktivität · Server' }, footer: { text: 'MagguuBot · Plex-Aktivität' } }] });
  add('1530000000000000003', { embeds: [{ title: '⏸️ Pausiert', author: { name: 'Plex · Tautulli' }, footer: { text: 'MagguuBot · pause' } }] });
  add('1530000000000000004', { pinned: true, embeds: [{ title: '📡 Live-Downloads', description: 'Admin: /downloads-live', footer: { text: 'MagguuBot' } }] });
  add('1530000000000000005', { embeds: [{ title: '📡 Live-Downloads', footer: { text: 'MagguuBot · aktualisiert jede Minute' } }] });
  add('1530000000000000006', { embeds: [{ title: '📥 Grab', footer: { text: 'MagguuBot  ·  Download gestartet' } }] });
  add('1530000000000000007', { authorId: HUMAN, embeds: [{ title: '▶️ Spielt ab', footer: { text: 'MagguuBot · Plex-Aktivität' } }] });
  const ops = planCards({
    botUserId: BOT, cards: [], tracked: [], live,
    protectedIds: new Set(['1530000000000000001', '1530000000000000005']),
    transient: new Map([['1530000000000000001', 'plex_activity_messages']]),
    routes: { plexActivity: plex, downloadLive: downloads, grabs: downloads },
    livePanel: { channelId: downloads, messageId: '1530000000000000005' },
  });
  const byId = (id: string): string[] => ops.filter((o) => 'messageId' in o && o.messageId === id).map((o) => o.op);
  assert.deepEqual(byId('1530000000000000001'), ['delete']);
  assert.equal(ops.find((o) => o.op === 'delete' && o.messageId === '1530000000000000001' && o.untrack === 'plex_activity_messages')?.op, 'delete');
  assert.deepEqual(byId('1530000000000000002'), [], 'right channel stays');
  assert.deepEqual(byId('1530000000000000003'), ['delete']);
  assert.deepEqual(byId('1530000000000000004'), ['delete'], 'old admin-hint live card goes');
  assert.deepEqual(byId('1530000000000000005'), ['pin'], 'the tracked panel is the one pinned card');
  assert.deepEqual(byId('1530000000000000006'), [], 'Sonarr/Radarr history is never deleted');
  assert.deepEqual(byId('1530000000000000007'), [], 'humans are never touched');
});

test('ticket panel card: website style, category select, no admin hints', () => {
  const ctx: CardContext = {
    ...noCommands,
    ticketCategories: [
      { key: 'support', label: 'Allgemeiner Support', emoji: '❓', description: 'Fragen zum Server' },
      { key: 'addon', label: 'MagguuUI', emoji: '🎨', description: '' },
    ],
  };
  const payload = buildTicketPanelCard(ctx);
  const embed = payload.embeds[0]!.toJSON();
  assert.equal(embed.color, BRAND_COLOR);
  assert.equal(embed.footer?.text, CARD_FOOTER_TEXT);
  assert.match(embed.description ?? '', /Allgemeiner Support/);
  assert.doesNotMatch(embed.description ?? '', /Admin|\/ticket-panel/);
  const row = payload.components[0]!.toJSON() as { components: Array<{ custom_id: string; options: Array<{ value: string }> }> };
  assert.equal(row.components[0]!.custom_id, TICKET_SELECT_CUSTOM_ID);
  assert.deepEqual(row.components[0]!.options.map((o) => o.value), ['support', 'addon']);
  assert.ok(CARDS.some((c) => c.channel === CHANNEL.help && c.build === buildTicketPanelCard));
  assert.ok(!CARDS.some((c) => c.channel === CHANNEL.downloads), '📡・downloads carries only the live panel');
});
