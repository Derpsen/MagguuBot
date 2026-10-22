import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { PermissionFlagsBits } from 'discord.js';
import { CHANNEL_CATALOG } from '../src/discord/channel-catalog.ts';
import { CHANNEL } from '../src/discord/server-layout.ts';
import { CARD_FOOTER_TEXT } from '../src/embeds/cards.ts';
import {
  TEST_MARKER,
  commandsGreen,
  diffCommands,
  matrixGreen,
  routingMatrix,
  scanMessages,
  testKeys,
  type ScanInput,
  type ScanMessage,
} from '../src/rollout/acceptance-plan.ts';
import { LIVE_PANEL_TITLE } from '../src/rollout/cards-plan.ts';
import { DOWNLOADS_KEYS, ROUTES, checkRouting, classifyBotEmbed, expectedChannelName } from '../src/utils/routing.ts';
import { collectStoredRefs, findStaleRefs, type GuildIndex } from '../src/utils/stale-ids.ts';
import { ticketCategoryOverwrites, ticketChannelOverwrites, verifyTicketOverwrites } from '../src/utils/ticket-perms.ts';

const BOT = '1498095100000000001';
const HUMAN = '1400000000000000001';
const DOWNLOADS = '1500000000000000001';
const PLEX = '1500000000000000002';
const STATUS = '1500000000000000003';

// ─── Routing ─────────────────────────────────────────────────────────────
test('every integrated routing key has a layout channel', () => {
  for (const route of ROUTES.filter((r) => r.integrated)) {
    for (const key of route.keys) assert.ok(expectedChannelName(key), `${route.source} → ${key} has no layout channel`);
  }
  for (const { key } of CHANNEL_CATALOG) assert.ok(expectedChannelName(key), `catalog key ${key} not in layout`);
});

test('📡・downloads only carries Sonarr, Radarr and SABnzbd keys', () => {
  const inDownloads = CHANNEL_CATALOG.map((c) => c.key).filter((k) => expectedChannelName(k) === CHANNEL.downloads);
  assert.deepEqual(new Set(inDownloads), DOWNLOADS_KEYS);
  const allowed = new Set(['Sonarr', 'Radarr', 'SABnzbd', 'Live-Queue (Sonarr/Radarr/SABnzbd)']);
  for (const route of ROUTES) {
    if (route.keys.some((k) => DOWNLOADS_KEYS.has(k))) assert.ok(allowed.has(route.source), `${route.source} would post in downloads`);
  }
  assert.equal(expectedChannelName('plexActivity'), CHANNEL.plexActivity);
  assert.equal(expectedChannelName('blizzard'), CHANNEL.blizzard);
  assert.equal(expectedChannelName('ticketLogs'), CHANNEL.logs);
});

test('non-integrated sources are marked and never get a test post', () => {
  for (const name of ['Bazarr', 'Uptime Kuma', 'Twitch']) {
    const r = ROUTES.find((x) => x.source === name);
    assert.ok(r && !r.integrated && r.keys.length === 0, name);
  }
  const keys = testKeys();
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes('plexActivity') && keys.includes('blizzard') && keys.includes('ticketLogs'));
});

test('classifier recognises routed feed posts and ignores cards', () => {
  assert.deepEqual(classifyBotEmbed({ title: LIVE_PANEL_TITLE }), ['downloadLive']);
  assert.deepEqual(classifyBotEmbed({ author: 'Plex · Marco', footer: 'MagguuBot · play' }), ['plexActivity']);
  assert.deepEqual(classifyBotEmbed({ footer: 'MagguuBot · WoW Blue-Tracker · EU' }), ['blizzard']);
  assert.deepEqual(classifyBotEmbed({ footer: 'MagguuBot · Download gestartet' }), ['grabs']);
  assert.equal(classifyBotEmbed({ title: '🎫 Support-Tickets', footer: CARD_FOOTER_TEXT }), null);
});

test('checkRouting flags unset, missing, archived and wrong channels', () => {
  const live = new Map([
    [DOWNLOADS, { id: DOWNLOADS, name: CHANNEL.downloads, parentId: null }],
    [STATUS, { id: STATUS, name: CHANNEL.status, parentId: '1500000000000000099' }],
  ]);
  const map: Record<string, string> = { grabs: DOWNLOADS, plexActivity: DOWNLOADS, health: STATUS, imports: '1599999999999999999' };
  const rows = new Map(checkRouting((k) => map[k], live, new Set(['1500000000000000099'])).map((r) => [r.key, r.problem]));
  assert.equal(rows.get('grabs'), null);
  assert.equal(rows.get('plexActivity'), 'wrong-channel');
  assert.equal(rows.get('health'), 'archived');
  assert.equal(rows.get('imports'), 'missing');
  assert.equal(rows.get('blizzard'), 'unset');
});

test('routing matrix lists every source with test column', () => {
  const live = new Map([[DOWNLOADS, { id: DOWNLOADS, name: CHANNEL.downloads, parentId: null }]]);
  const rows = checkRouting((k) => (k === 'grabs' ? DOWNLOADS : undefined), live, new Set());
  const matrix = routingMatrix(rows, new Map([['grabs', { ok: true, detail: 'ok' }]]));
  const sonarr = matrix.find((r) => r.source === 'Sonarr' && r.key === 'grabs');
  assert.equal(sonarr?.test, 'ok');
  assert.equal(sonarr?.channel, `#${CHANNEL.downloads}`);
  assert.equal(matrix.find((r) => r.source === 'Twitch')?.test, 'nicht integriert');
  assert.equal(matrix.find((r) => r.source === 'Level/XP')?.test, 'kein Kanal');
  assert.equal(matrixGreen(matrix), false);
});

// ─── 90-day scan ─────────────────────────────────────────────────────────
const msg = (id: string, channelId: string, embed: ScanMessage['embeds'][number] | null, extra: Partial<ScanMessage> = {}): ScanMessage => ({
  id, channelId, authorId: BOT, pinned: false, type: 0, embeds: embed ? [embed] : [], timestamp: '2026-10-01T00:00:00Z', content: '', interaction: false, ...extra,
});

function scanInput(messages: ScanMessage[], extra: Partial<ScanInput> = {}): ScanInput {
  return {
    botUserId: BOT, messages, routes: { plexActivity: PLEX, downloadLive: DOWNLOADS, grabs: DOWNLOADS, health: STATUS },
    trackedCardIds: new Set(['1600000000000000010']), livePanelId: '1600000000000000020', protectedIds: new Set(),
    transient: new Map(), activeChannelIds: new Set([DOWNLOADS, PLEX, STATUS]), roleIds: new Set(['1700000000000000001']),
    commands: new Map(), ...extra,
  };
}

test('scan deletes only bot-authored transient offenders and reports history', () => {
  const plexInDownloads = msg('1600000000000000001', DOWNLOADS, { author: { name: 'Plex · Marco' }, footer: { text: 'MagguuBot · play' } });
  const grabInStatus = msg('1600000000000000002', STATUS, { footer: { text: 'MagguuBot · Download gestartet' } });
  const dupPanel = msg('1600000000000000003', DOWNLOADS, { title: LIVE_PANEL_TITLE });
  const trackedPanel = msg('1600000000000000020', DOWNLOADS, { title: LIVE_PANEL_TITLE });
  const oldCard = msg('1600000000000000004', DOWNLOADS, { title: '🎫 Support-Tickets', footer: { text: CARD_FOOTER_TEXT } });
  const leftover = msg('1600000000000000005', STATUS, null, { content: `${TEST_MARKER} · x` });
  const human = msg('1600000000000000006', DOWNLOADS, { author: { name: 'Plex · Marco' }, footer: { text: 'MagguuBot · play' } }, { authorId: HUMAN });
  const reply = msg('1600000000000000007', STATUS, { title: LIVE_PANEL_TITLE }, { interaction: true });
  const deadRole = msg('1600000000000000008', STATUS, { description: 'Ping <@&1799999999999999999>' }, { pinned: true });
  const { findings } = scanMessages(scanInput([plexInDownloads, grabInStatus, dupPanel, trackedPanel, oldCard, leftover, human, reply, deadRole]));
  const byId = new Map(findings.map((f) => [f.messageId, f]));
  assert.equal(byId.get(plexInDownloads.id)?.kind, 'misrouted');
  assert.equal(byId.get(plexInDownloads.id)?.deletable, true);
  assert.equal(byId.get(grabInStatus.id)?.deletable, false, 'history is report-only');
  assert.equal(byId.get(grabInStatus.id)?.severity, 'info');
  assert.equal(byId.get(dupPanel.id)?.kind, 'duplicatePanel');
  assert.ok(!byId.has(trackedPanel.id));
  assert.equal(byId.get(oldCard.id)?.kind, 'staleCard');
  assert.equal(byId.get(leftover.id)?.kind, 'leftoverTest');
  assert.ok(!byId.has(human.id), 'human messages are never findings');
  assert.ok(!byId.has(reply.id), 'interaction replies are ignored');
  assert.equal(byId.get(deadRole.id)?.kind, 'deadRole');
  assert.equal(byId.get(deadRole.id)?.severity, 'error');
});

test('protected messages are kept unless they are tracked transient posts', () => {
  const a = msg('1600000000000000001', DOWNLOADS, { author: { name: 'Plex · Marco' }, footer: { text: 'MagguuBot · play' } });
  const b = msg('1600000000000000002', DOWNLOADS, { title: LIVE_PANEL_TITLE });
  const { findings } = scanMessages(scanInput([a, b], {
    protectedIds: new Set([a.id, b.id]),
    transient: new Map([[a.id, 'plex_activity_messages']]),
  }));
  const byId = new Map(findings.map((f) => [f.messageId, f]));
  assert.equal(byId.get(a.id)?.deletable, true);
  assert.equal(byId.get(a.id)?.untrack, 'plex_activity_messages');
  assert.equal(byId.get(b.id)?.deletable, false);
});

// ─── Slash diff ──────────────────────────────────────────────────────────
test('command diff finds missing, extra, changed and removed-service commands', () => {
  const local = [
    { name: 'doctor', description: 'Prüft', default_member_permissions: '8' },
    { name: 'queue', description: 'Queue' },
  ];
  assert.ok(commandsGreen(diffCommands(local, local)));
  const d = diffCommands(
    [{ name: 'doctor', description: 'Prüft', default_member_permissions: null }, { name: 'maintainerr', description: 'alt' }],
    local,
    [{ name: 'ping', description: 'x' }],
  );
  assert.deepEqual(d.missing, ['queue']);
  assert.deepEqual(d.extra, ['maintainerr']);
  assert.deepEqual(d.changed, [{ name: 'doctor', what: 'Rechte' }]);
  assert.deepEqual(d.removedService, ['maintainerr']);
  assert.deepEqual(d.global, ['ping']);
  assert.ok(!commandsGreen(d));
  assert.deepEqual(diffCommands([], [{ name: 'tag', description: 'Kombi-Antworten' }]).removedService, []);
});

// ─── Stored IDs ──────────────────────────────────────────────────────────
test('stored ids pointing to deleted channels, categories and roles are flagged', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE channel_config (guild_id TEXT, key TEXT, channel_id TEXT);
    CREATE TABLE live_panels (guild_id TEXT, kind TEXT, channel_id TEXT, message_id TEXT, enabled INTEGER);
    CREATE TABLE ticket_categories (guild_id TEXT, key TEXT, ping_roles TEXT, enabled INTEGER);
    CREATE TABLE tickets (guild_id TEXT, id INTEGER, channel_id TEXT, closed_at INTEGER);
    INSERT INTO channel_config VALUES ('G', 'grabs', '${DOWNLOADS}'), ('G', 'blizzard', '1599999999999999999');
    INSERT INTO live_panels VALUES ('G', 'downloads', '1599999999999999998', '1', 1);
    INSERT INTO ticket_categories VALUES ('G', 'plex', '["Moderator","Gelöscht"]', 1);
    INSERT INTO tickets VALUES ('G', 1, '1599999999999999997', NULL), ('G', 2, '1599999999999999996', 1);
  `);
  const refs = collectStoredRefs(db, 'G', { jtcCategoryId: DOWNLOADS, autoRoleId: '1799999999999999999' });
  const index: GuildIndex = {
    channels: new Map([[DOWNLOADS, { name: CHANNEL.downloads, type: 0, parentId: null }]]),
    roleIds: new Set(),
    roleNames: new Set(['Moderator']),
    archiveId: null,
  };
  const stale = findStaleRefs(refs, index).map((s) => `${s.source}:${s.problem}`).sort();
  const flat = stale.join(' ');
  assert.match(flat, /channel_config\.blizzard:missing/);
  assert.match(flat, /live_panels.*:missing/);
  assert.match(flat, /jtcCategoryId:wrong-type/);
  assert.match(flat, /autoRoleId:missing/);
  assert.match(flat, /ticket_categories.*:missing/);
  assert.equal(stale.filter((s) => s.startsWith('tickets')).length, 1, 'closed tickets are ignored');
  assert.ok(!flat.includes('channel_config.grabs'));
});

// ─── Ticket permissions ──────────────────────────────────────────────────
test('ticket channels are private, staff + bot can see them, bot in the create call', () => {
  const spec = ticketChannelOverwrites({ everyoneId: 'G', openerId: HUMAN, moderatorRoleIds: ['R1', 'R2'], botUserId: BOT });
  const everyone = spec.find((o) => o.id === 'G')!;
  assert.equal(everyone.deny & PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ViewChannel);
  for (const id of [HUMAN, 'R1', 'R2', BOT]) {
    const o = spec.find((x) => x.id === id);
    assert.ok(o && (o.allow & PermissionFlagsBits.ViewChannel) !== 0n, id);
  }
  assert.ok((spec.find((o) => o.id === BOT)!.allow & PermissionFlagsBits.ManageChannels) !== 0n);
  const self = ticketChannelOverwrites({ everyoneId: 'G', openerId: BOT, moderatorRoleIds: [], botUserId: BOT });
  assert.equal(self.filter((o) => o.id === BOT).length, 1, 'bot as opener is merged');

  const cat = ticketCategoryOverwrites({ everyoneId: 'G', moderatorRoleIds: ['R1'], botUserId: BOT });
  assert.equal(cat.find((o) => o.id === 'G')!.deny & PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ViewChannel);
  const api = cat.map((o) => ({ id: o.id, type: o.type, allow: String(o.allow), deny: String(o.deny) }));
  assert.deepEqual(verifyTicketOverwrites(api, cat), []);
  assert.equal(verifyTicketOverwrites(api.filter((o) => o.id !== 'G'), cat).length, 1);
  assert.equal(verifyTicketOverwrites([{ id: 'G', type: 0, allow: '0', deny: '0' }, ...api.slice(1)], cat).length, 1);
});
