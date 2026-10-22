import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHANNEL_CATALOG } from '../src/discord/channel-catalog.js';
import { findLayoutRole } from '../src/discord/role-lookup.js';
import {
  ARCHIVE_CATEGORY_NAME,
  CHANNEL,
  PERM,
  ROLES,
  STRUCTURE,
  allChannelPlans,
  canonicalRoleName,
  channelPlanForRef,
} from '../src/discord/server-layout.js';
import {
  planDeletion,
  planRollout,
  simulate,
  type Action,
  type GuildSnapshot,
  type SnapChannel,
} from '../src/rollout/plan.js';

const GUILD = '1495814768504864999';
const BOT = '1498095100000000001';
const DEFAULT_PERMS = '2248473465835073';

// Live state from the read-only audit (22.10.2026): 13 categories, 37 channels, 19 roles.
const LIVE: Array<[string, string, Array<[string, string, number]>]> = [
  ['1495846161129541833', '📊 STATISTIK', [
    ['1496166277494866102', '👥 Mitglieder: 2', 2], ['1495846164841369706', '📈 Boosts: 0', 2],
    ['1496140962903359669', '🎙 In Voice: 0', 2], ['1495846165793603639', '🤖 Bot-Uptime: 0h', 2],
    ['1498074674838638634', '🎬 Plex: 0', 2],
  ]],
  ['1495831146360082526', '🏠 INFO', [
    ['1495831148280938667', '👋・willkommen', 0], ['1495831151187853404', '📜・regeln', 0],
    ['1495831154849349803', '📢・ankündigungen', 0], ['1495831157063946452', '🤖・bot-hilfe', 0],
    ['1495831160843010088', '🎭・rollen', 0], ['1498074686783754262', '💡・vorschläge', 0],
  ]],
  ['1496130815665504287', '🎮 WOW', [['1496130817129447456', '📰・blue-tracker', 0]]],
  ['1496166299414433983', '🎨 MAGGUU UI', [['1496166301302001685', '🎨・addon-updates', 0], ['1496166312341143667', '❓・faq', 0]]],
  ['1495819595028758780', '🎬 MEDIA', [
    ['1495819596173672508', '📝・anfragen', 0], ['1522173041423941753', '📊・wochenrückblick', 0],
    ['1495819598329548970', '⏳・freigaben', 0], ['1495819601840443624', '✨・neu-auf-plex', 0],
    ['1522315377428791527', '🎬・aktivität', 0], ['1495919611525468320', '🗑️・gelöscht', 0],
  ]],
  ['1495819605602729994', '📥 DOWNLOADS', [
    ['1495819606777008219', '📥・grabs', 0], ['1495819609776066673', '✅・imports', 0],
    ['1522173079055372308', '📡・live-downloads', 0], ['1495819613995274271', '⚠️・fehler', 0],
  ]],
  ['1495831162944225321', '🔧 STATUS', [['1495831164848443413', '🩺・health', 0]]],
  ['1495831167612485724', '💬 CHAT', [
    ['1495831168745213972', '💬・chat', 0], ['1495831169424556157', '⌨️・bot-befehle', 0],
    ['1495831171039367269', '🔇・spoiler-zone', 0], ['1522173111796109372', '🎬・movie-night', 0],
  ]],
  ['1495831172197126465', '🎧 VOICE', [
    ['1495831173308485683', '🔊 General', 2], ['1495831174835077220', '🎬 Movie Night', 2], ['1495831177074966528', '💤 AFK', 2],
  ]],
  ['1495835998301585490', '🛡️ MOD', [['1495835999652282388', '🛡️・mod-log', 0], ['1495836009638924448', '📋・audit-log', 0]]],
  ['1495836011048210564', '🔨 DEV', [['1495836012536922203', '🔨・github', 0]]],
  ['1541170839633002546', '🎫 TICKETS', [['1541170841641816095', 'ticket-logs', 0]]],
  ['1495905925502861333', '⭐ HIGHLIGHTS', [['1495905926345920643', '⭐・starboard', 0]]],
];

const ROLE_ROWS: Array<[string, string, number, boolean?]> = [
  ['1495819583402147920', 'Admin', 18], ['1495819583985029304', 'Moderator', 17], ['1498095177393373238', 'MagguuBot', 16, true],
  ['1495819585595642017', 'VIP', 15], ['1495819586627440821', 'Plex-User', 14], ['1495819587877470468', 'Regular', 13],
  ['1495819589404328018', 'Newcomer', 12], ['1495819590805098546', 'ping-movies', 11], ['1495819592373899454', 'ping-series', 10],
  ['1495819593535586554', 'ping-4k', 9], ['1496140954665615395', 'ping-anime', 8], ['1496140956397863076', 'ping-wow-tuning', 7],
  ['1496140957253374166', 'ping-wow-ptr', 6], ['1496140958184636429', 'ping-announcements', 5], ['1496140959702847488', 'ping-github', 4],
  ['1496180510609637549', 'Plex-Fan', 3], ['1496180511662411916', 'WoW-Fan', 2], ['1496180512622907402', 'MagguuUI', 1],
  [GUILD, '@everyone', 0],
];

function liveSnapshot(): GuildSnapshot {
  const channels: SnapChannel[] = [];
  let catPos = 0;
  for (const [catId, catName, children] of LIVE) {
    channels.push({ id: catId, name: catName, type: 4, parent_id: null, position: catPos++, topic: null, permission_overwrites: [] });
    children.forEach(([id, name, type], idx) => {
      channels.push({ id, name, type, parent_id: catId, position: idx, topic: null, permission_overwrites: [] });
    });
  }
  const keyIds: Record<string, string> = {
    addonUpdates: '1496166301302001685', approvals: '1495819598329548970', auditLog: '1495836009638924448',
    blizzard: '1496130817129447456', downloadLive: '1522173079055372308', failures: '1495819613995274271',
    faq: '1496166312341143667', github: '1495836012536922203', grabs: '1495819606777008219', health: '1495831164848443413',
    imports: '1495819609776066673', modLog: '1495835999652282388',
    movieNight: '1522173111796109372', newOnPlex: '1495819601840443624', plexActivity: '1522315377428791527',
    requests: '1495819596173672508', starboard: '1495905926345920643', suggestions: '1498074686783754262',
    ticketLogs: '1541170841641816095', weeklyDigest: '1522173041423941753', welcome: '1495831148280938667',
  };
  return {
    guildId: GUILD,
    botUserId: BOT,
    botHighestRolePosition: 16,
    features: [],
    rulesChannelId: null,
    publicUpdatesChannelId: null,
    verificationLevel: 0,
    explicitContentFilter: 0,
    channels,
    roles: ROLE_ROWS.map(([id, name, position, managed]) => ({
      id, name, position, color: 0, managed: managed ?? false, hoist: false, mentionable: name.startsWith('ping-'),
      permissions: managed ? PERM.ADMINISTRATOR.toString() : DEFAULT_PERMS,
    })),
    members: { '1000000000000000001': ['1495819583402147920'], [BOT]: ['1498095177393373238'] },
    channelConfig: keyIds,
    autoRoleSetting: '__magguu_newcomer__',
    onboarding: { enabled: false, promptTitles: [], defaultChannelIds: [] },
    welcomeScreen: null,
  };
}

const kinds = (actions: Action[]): string[] => actions.map((a) => a.kind);

test('layout: 5 categories, 16 channels, 11 roles, every bot key has exactly one home', () => {
  assert.equal(STRUCTURE.length, 5);
  assert.equal(allChannelPlans().length, 16);
  assert.equal(ROLES.length, 11);
  for (const entry of CHANNEL_CATALOG) {
    const homes = allChannelPlans().filter(({ channel }) => channel.refs?.includes(entry.key));
    assert.equal(homes.length, 1, `${entry.key} must map to exactly one channel`);
  }
  const names = allChannelPlans().map(({ channel }) => channel.name);
  const oldNames = allChannelPlans().flatMap(({ channel }) => channel.oldNames ?? []);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(oldNames).size, oldNames.length);
  for (const old of oldNames) assert.ok(!names.includes(old), `${old} is both old and new`);
  assert.equal(channelPlanForRef('ticketLogs')?.name, CHANNEL.logs);
  assert.equal(channelPlanForRef('blizzard')?.name, CHANNEL.blizzard);
  assert.equal(channelPlanForRef('addonUpdates')?.name, CHANNEL.updates);
});

test('legacy role names resolve to their layout role', () => {
  assert.equal(canonicalRoleName('ping-4k'), 'ping-extras');
  assert.equal(canonicalRoleName('ping-anime'), 'ping-extras');
  assert.equal(canonicalRoleName('ping-wow-ptr'), 'ping-wow');
  assert.equal(canonicalRoleName('ping-github'), 'ping-magguuui');
  const before = [{ name: 'ping-4k' }, { name: 'ping-github' }];
  assert.equal(findLayoutRole(before, 'ping-extras')?.name, 'ping-4k');
  assert.equal(findLayoutRole(before, 'ping-magguuui')?.name, 'ping-github');
  assert.equal(findLayoutRole([{ name: 'ping-extras' }, { name: 'ping-4k' }], 'ping-extras')?.name, 'ping-extras');
});

test('rollout plan on the live server renames/reuses and archives, never deletes', () => {
  const snap = liveSnapshot();
  const plan = planRollout(snap);
  const all = plan.actions;
  assert.ok(!kinds(all).some((k) => /delete/i.test(k)));
  // IDs survive: reused channels keep their id
  assert.equal(plan.channelRefs[CHANNEL.updates], '1496166301302001685');
  assert.equal(plan.channelRefs[CHANNEL.blizzard], '1496130817129447456');
  assert.equal(plan.channelRefs[CHANNEL.help], '1496166312341143667');
  assert.equal(plan.channelRefs[CHANNEL.downloads], '1522173079055372308');
  assert.equal(plan.channelRefs[CHANNEL.status], '1495831164848443413');
  assert.equal(plan.channelRefs[CHANNEL.logs], '1495836009638924448');
  assert.equal(plan.channelRefs[CHANNEL.voice], '1495831173308485683');
  // Nothing new is created except the archive category
  assert.deepEqual(all.filter((a) => a.kind === 'createChannel').length, 0);
  assert.deepEqual(all.filter((a) => a.kind === 'createCategory').map((a) => a.kind === 'createCategory' && a.name), [ARCHIVE_CATEGORY_NAME]);
  // Roles: 3 renames, no new roles
  assert.equal(all.filter((a) => a.kind === 'createRole').length, 0);
  const renamed = all.flatMap((a) => (a.kind === 'updateRole' && a.changes.name ? [`${a.current}→${a.changes.name}`] : []));
  assert.deepEqual(renamed.sort(), ['ping-4k→ping-extras', 'ping-github→ping-magguuui', 'ping-wow-tuning→ping-wow']);
  // Admin/Moderator sit above the bot role → reported as manual, not attempted
  const blocked = all.filter((a) => a.kind === 'updateRole' && a.blocked).map((a) => a.kind === 'updateRole' && a.current);
  assert.deepEqual(blocked, ['Admin', 'Moderator']);
  assert.ok(plan.manual.some((m) => m.includes('Admin')));
  // MENTION_EVERYONE stripped from @everyone
  const everyone = all.find((a) => a.kind === 'updateRole' && a.id === GUILD);
  assert.ok(everyone && everyone.kind === 'updateRole');
  assert.equal(BigInt(everyone.changes.permissions ?? '0') & PERM.MENTION_EVERYONE, 0n);
  // 22 legacy channels archived, incl. stats counters and ticket-logs
  const archived = all.flatMap((a) => (a.kind === 'archiveChannel' ? [a.name] : []));
  assert.equal(archived.length, 21);
  for (const name of ['👥 Mitglieder: 2', '📜・regeln', '🎭・rollen', 'ticket-logs', '💤 AFK', '⭐・starboard']) {
    assert.ok(archived.includes(name), name);
  }
  // Bot keys re-pointed, autoRoleId becomes the real Newcomer id
  const keys = Object.fromEntries(all.flatMap((a) => (a.kind === 'setChannelKey' ? [[a.key, a.target]] : [])));
  assert.equal(keys.blizzard, undefined, 'old 📰・blue-tracker is reused as 🟦・blizzard-updates');
  assert.equal(keys.grabs, '1522173079055372308');
  assert.equal(keys.ticketLogs, '1495836009638924448');
  assert.equal(keys.welcome, undefined, 'unchanged keys are not rewritten');
  const auto = all.find((a) => a.kind === 'setAutoRole');
  assert.ok(auto && auto.kind === 'setAutoRole' && auto.target === '1495819589404328018');
  // Community, onboarding and welcome screen come last
  assert.deepEqual(kinds(all).slice(-3), ['enableCommunity', 'putOnboarding', 'putWelcomeScreen']);
});

test('rollout is idempotent: a second run only repeats the blocked staff-role edits', () => {
  const first = planRollout(liveSnapshot());
  const after = simulate(liveSnapshot(), first.actions);
  const second = planRollout(after);
  assert.deepEqual(
    second.actions.map((a) => (a.kind === 'updateRole' ? `${a.kind}:${a.current}:${Boolean(a.blocked)}` : a.kind)),
    ['updateRole:Admin:true', 'updateRole:Moderator:true'],
  );
  // With the bot role moved above staff, everything converges to zero actions.
  const third = planRollout(simulate({ ...after, botHighestRolePosition: 19 }, second.actions.map((a) => (a.kind === 'updateRole' ? { ...a, blocked: undefined } : a))));
  assert.deepEqual(third.actions, []);
});

test('deletion only touches the archive, skips open cards and keeps roles with members', () => {
  const after = simulate(liveSnapshot(), planRollout(liveSnapshot()).actions);
  after.members = { ...after.members, '1000000000000000002': ['1495819585595642017'] }; // someone still has VIP
  const blockers = { '1522315377428791527': ['Plex-Aktivitätskarte < 7 T.'] };
  const del = planDeletion(after, blockers);
  assert.equal(del.channels.length, 20);
  assert.deepEqual(del.skippedChannels.map((c) => c.name), ['🎬・aktivität']);
  const archiveId = after.channels.find((c) => c.name === ARCHIVE_CATEGORY_NAME)?.id;
  for (const c of del.channels) assert.equal(after.channels.find((x) => x.id === c.id)?.parent_id, archiveId);
  // Empty legacy categories go, layout/protected categories and the still-used archive stay.
  const cats = del.categories.map((c) => c.name).sort();
  assert.deepEqual(cats, ['⭐ HIGHLIGHTS', '🎧 VOICE', '🎮 WOW', '📊 STATISTIK', '📥 DOWNLOADS', '🔧 STATUS', '🔨 DEV'].sort());
  // Roles: retired + empty only; VIP has a member, layout and managed roles never.
  assert.deepEqual(del.roles.map((r) => r.name).sort(), ['MagguuUI', 'Plex-Fan', 'WoW-Fan', 'ping-anime', 'ping-wow-ptr'].sort());
  assert.ok(del.skippedRoles.some((r) => r.name === 'VIP'));
  for (const name of ROLES.map((r) => r.name)) assert.ok(!del.roles.some((r) => r.name === name));
});

test('deletion before --apply refuses to touch roles that are only renamed', () => {
  const del = planDeletion(liveSnapshot(), {});
  assert.equal(del.channels.length, 0, 'no archive yet → nothing to delete');
  assert.ok(del.skippedRoles.some((r) => r.name === 'ping-4k' && r.reason.includes('umbenannt')));
});
