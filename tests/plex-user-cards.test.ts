import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { EmbedBuilder, MessagePayload, type MessageCreateOptions } from 'discord.js';

// The card module pulls in config/DB: throwaway env, no network, no Discord login.
const dir = mkdtempSync(join(tmpdir(), 'plex-user-cards-'));
after(() => rmSync(dir, { recursive: true, force: true }));
Object.assign(process.env, {
  DATABASE_PATH: join(dir, 'bot.db'),
  DISCORD_TOKEN: 'test-token-not-used',
  DISCORD_CLIENT_ID: '1498095100000000001',
  DISCORD_GUILD_ID: '1400000000000000099',
  WEBHOOK_SECRET: 'test-secret-0123456789abcdef',
});

const { PlexCardManager } = await import('../src/discord/plex-card-manager.ts');
const { createDiscordCardGateway, plexCardStore, migrateLegacyPlexCard } = await import('../src/discord/plex-card.ts');
const { sqliteHandle } = await import('../src/db/client.ts');
const { buildPlexUserCardEmbed, PLEX_USER_CARD_FOOTER, applyPlexCardEvent, emptyPlexCardState } = await import('../src/utils/plex-card.ts');
const {
  parsePlexCardAliases, parsePlexCardExclude, parsePlexCardUserConfig, resolvePlexCardUser, plexCardTag, PLEX_CARD_MAX_USERS,
} = await import('../src/utils/plex-card-users.ts');
import type { PlexCardGateway, PlexCardRecord, PlexCardStore } from '../src/discord/plex-card-manager.ts';
import type { PlexCardEvent } from '../src/utils/plex-card.ts';

const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);
const CH = '111';

function ev(user: string, kind: string, at: number, extra: Partial<PlexCardEvent> = {}): PlexCardEvent {
  return { kind, key: `${user}|tv`, sessionKey: '1', user, player: 'Apple TV', title: 'Dune', mediaType: 'movie', at, ...extra };
}
const err = (code: number) => Object.assign(new Error(`discord ${code}`), { code });

class MemStore implements PlexCardStore {
  rows = new Map<string, PlexCardRecord>();
  load(c: string, u: string) { const r = this.rows.get(`${c}|${u}`); return r ? structuredClone(r) : null; }
  save(r: PlexCardRecord) { this.rows.set(`${r.channelId}|${r.userKey}`, structuredClone(r)); }
  list(c: string) { return [...this.rows.values()].filter((r) => r.channelId === c).map((r) => structuredClone(r)); }
}

class Gateway implements PlexCardGateway {
  posts: Array<{ channelId: string; embed: EmbedBuilder; at: number; id: string }> = [];
  edits: Array<{ messageId: string; embed: EmbedBuilder }> = [];
  deletes: string[] = [];
  /** per message id: error to throw on edit */
  editErrors = new Map<string, unknown>();
  postError: unknown = null;
  private n = 1000;
  constructor(private readonly clock: () => number) {}
  async post(channelId: string, embed: EmbedBuilder) {
    if (this.postError) throw this.postError;
    const id = String(this.n++);
    this.posts.push({ channelId, embed, at: this.clock(), id });
    return id;
  }
  async edit(_c: string, messageId: string, embed: EmbedBuilder) {
    const e = this.editErrors.get(messageId);
    if (e) throw e;
    this.edits.push({ messageId, embed });
  }
  async delete(_c: string, messageId: string) { this.deletes.push(messageId); }
}

function rig(options: Partial<ConstructorParameters<typeof PlexCardManager>[0]> = {}) {
  let now = T0;
  let seq = 0;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  const timers = {
    setTimeout: (fn: () => void, ms: number) => { jobs.set(++seq, { at: now + ms, fn }); return seq; },
    clearTimeout: (h: unknown) => void jobs.delete(h as number),
  };
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  const store = new MemStore();
  const gateway = new Gateway(() => now);
  const logs: Array<{ level: string; msg: string; data?: Record<string, unknown> }> = [];
  const make = () => new PlexCardManager({
    store, gateway, timers, now: () => now,
    debounceMs: 4000, maxWaitMs: 15_000, retryMs: 30_000, postSpacingMs: 0, editSpacingMs: 0,
    log: (level, msg, data) => logs.push({ level, msg, ...(data ? { data } : {}) }),
    ...options,
  });
  const manager = make();
  async function run(ms: number, tickEveryMs = 0, m = manager): Promise<void> {
    const end = now + ms;
    let nextTick = tickEveryMs > 0 ? now + tickEveryMs : Number.POSITIVE_INFINITY;
    while (now < end) {
      now += 1000;
      for (const [id, j] of [...jobs.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (j.at <= now) { jobs.delete(id); j.fn(); await settle(); }
      }
      if (now >= nextTick) { nextTick += tickEveryMs; await m.tick(CH); await settle(); }
    }
  }
  return { manager, make, store, gateway, logs, run, now: () => now, advance: (ms: number) => { now += ms; } };
}

// ─── per-user lifecycle ─────────────────────────────────────────────────────

test('every user gets exactly one message; start/stop edits only that user\'s card', async () => {
  const t = rig();
  t.manager.handleEvent(CH, ev('Anna', 'play', t.now()));
  await t.run(5000);
  t.manager.handleEvent(CH, ev('Ben', 'play', t.now(), { title: 'Alien' }));
  await t.run(5000);
  assert.equal(t.gateway.posts.length, 2, 'one message per user');
  const annaId = t.store.load(CH, 'anna')?.messageId;
  const benId = t.store.load(CH, 'ben')?.messageId;
  assert.ok(annaId && benId && annaId !== benId);

  // Anna pauses, stops, plays again: only Anna's message is edited, nothing is posted, Ben stays untouched
  t.manager.handleEvent(CH, ev('Anna', 'pause', t.now()));
  await t.run(5000);
  t.manager.handleEvent(CH, ev('Anna', 'stop', t.now()));
  await t.run(5000);
  t.manager.handleEvent(CH, ev('Anna', 'play', t.now(), { sessionKey: '2', title: 'Heat' }));
  await t.run(5000);
  assert.equal(t.gateway.posts.length, 2, 'no new message for returning users');
  assert.ok(t.gateway.edits.length >= 3);
  assert.ok(t.gateway.edits.every((e) => e.messageId === annaId), 'Ben\'s card was never edited');
  assert.equal(t.store.load(CH, 'ben')?.messageId, benId);
});

test('card content: active state in title, "Zuletzt geguckt", own footer; idle user shows last activity', async () => {
  const t = rig();
  t.manager.handleEvent(CH, ev('Anna', 'play', t.now()));
  await t.run(5000);
  let embed = t.gateway.posts[0]!.embed.toJSON();
  assert.match(embed.title ?? '', /^▶️ Anna · gerade aktiv$/);
  assert.match(embed.description ?? '', /Dune · Apple TV · seit <t:\d+:R>/);
  assert.equal(embed.footer?.text, PLEX_USER_CARD_FOOTER);
  assert.equal(embed.fields, undefined);

  t.manager.handleEvent(CH, ev('Anna', 'pause', t.now()));
  await t.run(5000);
  assert.match(t.gateway.edits.at(-1)!.embed.toJSON().title ?? '', /^⏸️ Anna · pausiert$/);

  t.manager.handleEvent(CH, ev('Anna', 'stop', t.now()));
  await t.run(5000);
  embed = t.gateway.edits.at(-1)!.embed.toJSON();
  assert.match(embed.title ?? '', /^💤 Anna · gerade nicht aktiv$/);
  assert.match(embed.description ?? '', /^Gerade läuft nichts · zuletzt aktiv <t:\d+:R>$/);
  assert.equal(embed.fields?.[0]?.name, 'Zuletzt geguckt');
  assert.match(embed.fields?.[0]?.value ?? '', /^⏹️ Dune · <t:\d+:R>$/);
});

test('a restart edits the stored messages of every user, nothing is re-posted', async () => {
  const t = rig();
  t.manager.handleEvent(CH, ev('Anna', 'play', t.now()));
  t.manager.handleEvent(CH, ev('Ben', 'play', t.now()));
  await t.run(5000);
  const ids = t.store.list(CH).map((r) => r.messageId);
  assert.equal(ids.length, 2);

  const restarted = t.make();
  assert.deepEqual(await restarted.tick(CH), ['unchanged', 'unchanged'], 'boot tick: hashes match, no call');
  restarted.handleEvent(CH, ev('Ben', 'stop', t.now()));
  await t.run(5000, 0, restarted);
  assert.equal(t.gateway.posts.length, 2);
  assert.deepEqual(t.gateway.edits.map((e) => e.messageId), [ids[1]]);
});

test('a deleted message (10008) is re-created for that user only, after the cooldown', async () => {
  const t = rig({ goneCooldownMs: 60_000 });
  t.manager.handleEvent(CH, ev('Anna', 'play', t.now()));
  t.manager.handleEvent(CH, ev('Ben', 'play', t.now()));
  await t.run(5000);
  const annaOld = t.store.load(CH, 'anna')!.messageId!;
  const benOld = t.store.load(CH, 'ben')!.messageId!;
  await t.run(70_000);
  t.gateway.editErrors.set(annaOld, err(10_008));
  t.manager.handleEvent(CH, ev('Anna', 'pause', t.now()));
  t.manager.handleEvent(CH, ev('Ben', 'pause', t.now()));
  await t.run(6000);
  assert.equal(t.gateway.posts.length, 3, 'exactly one replacement');
  assert.notEqual(t.store.load(CH, 'anna')?.messageId, annaOld);
  assert.equal(t.store.load(CH, 'ben')?.messageId, benOld);
  assert.equal(t.gateway.deletes.length, 0, 'the message is gone, nothing to delete');
});

test('backoff is per card: one failing card does not hold back the others', async () => {
  const t = rig({ maxEditFailures: 5 });
  t.manager.handleEvent(CH, ev('Anna', 'play', t.now()));
  t.manager.handleEvent(CH, ev('Ben', 'play', t.now()));
  await t.run(5000);
  await t.run(11 * 60_000);
  t.gateway.editErrors.set(t.store.load(CH, 'anna')!.messageId!, Object.assign(new Error('429 rate limited'), { status: 429 }));
  t.manager.handleEvent(CH, ev('Anna', 'pause', t.now()));
  t.manager.handleEvent(CH, ev('Ben', 'pause', t.now()));
  await t.run(5000);
  assert.equal(t.logs.filter((l) => l.msg === 'Plex card edit failed').length, 1, 'Anna: one failure, backoff armed');
  assert.equal(t.gateway.edits.length, 1, 'Ben was edited anyway');
  assert.equal(await t.manager.flushCard(CH, 'anna'), 'retry', 'inside the backoff: no Discord call');
  assert.equal(await t.manager.flushCard(CH, 'ben'), 'unchanged');
  t.gateway.editErrors.clear();
  await t.run(40_000, 30_000);
  assert.equal(t.gateway.edits.length, 2, 'Anna recovers after her own backoff');
  assert.equal(t.gateway.posts.length, 2, 'no repost');
});

test('a permanent error (50013) pauses all cards of the channel with one quiet warn, then recovers', async () => {
  const t = rig({ permanentPauseMs: 10 * 60_000 });
  t.manager.handleEvent(CH, ev('Anna', 'play', t.now()));
  t.manager.handleEvent(CH, ev('Ben', 'play', t.now()));
  await t.run(5000);
  await t.run(11 * 60_000);
  for (const r of t.store.list(CH)) t.gateway.editErrors.set(r.messageId!, err(50_013));
  t.manager.handleEvent(CH, ev('Anna', 'pause', t.now()));
  t.manager.handleEvent(CH, ev('Ben', 'pause', t.now()));
  await t.run(5000, 30_000);
  assert.equal(t.logs.filter((l) => /blocked by Discord/.test(l.msg)).length, 1, 'one warn for the whole channel');
  assert.equal(await t.manager.flushCard(CH, 'ben'), 'paused');
  assert.equal(t.gateway.posts.length, 2, 'a permanent error never reposts');
  assert.equal(t.manager.syncStatus(CH).paused, true);
  t.gateway.editErrors.clear();
  await t.run(11 * 60_000, 30_000);
  assert.equal(t.gateway.edits.length, 2);
  assert.equal(t.manager.syncStatus(CH).unsynced, 0);
});

test('no burst: new cards are posted one after another with spacing, edits are spaced too', async () => {
  const waits: number[] = [];
  const t = rig({
    postSpacingMs: 3000,
    editSpacingMs: 400,
    sleep: async (ms) => { waits.push(ms); t.advance(ms); },
  });
  for (const name of ['A', 'B', 'C', 'D', 'E']) t.manager.handleEvent(CH, ev(name, 'play', t.now()));
  await t.run(5000);
  assert.equal(t.gateway.posts.length, 5);
  const gaps = t.gateway.posts.slice(1).map((p, i) => p.at - t.gateway.posts[i]!.at);
  assert.ok(gaps.every((g) => g >= 3000), `post gaps ${gaps.join(',')}`);
  assert.ok(waits.length >= 4);
});

test('user cap: users over the limit get no card, one warn, no name in the log', async () => {
  const t = rig({ maxUsers: 3 });
  for (const name of ['u1', 'u2', 'u3']) t.manager.handleEvent(CH, ev(name, 'play', t.now()));
  assert.equal(t.manager.handleEvent(CH, ev('GeheimerName', 'play', t.now())), false);
  assert.equal(t.manager.handleEvent(CH, ev('NochEiner', 'play', t.now())), false);
  await t.run(10_000);
  assert.equal(t.gateway.posts.length, 3);
  const warns = t.logs.filter((l) => l.level === 'warn' && /user limit/.test(l.msg));
  assert.equal(warns.length, 1, 'throttled, no spam');
  assert.deepEqual(warns[0]?.data, { max: 3 });
  assert.equal(PLEX_CARD_MAX_USERS, 25);
  // existing users keep working at the cap
  assert.equal(t.manager.handleEvent(CH, ev('u1', 'pause', t.now())), true);
});

test('logs never contain user names or ids, only a short tag', async () => {
  const t = rig({ maxEditFailures: 2, repostCooldownMs: 1000 });
  t.manager.handleEvent(CH, ev('Geheim Marco', 'play', t.now()));
  await t.run(5000);
  await t.run(11 * 60_000);
  const messageId = t.store.load(CH, 'geheim marco')!.messageId!;
  t.gateway.editErrors.set(messageId, new Error('boom'));
  t.manager.handleEvent(CH, ev('Geheim Marco', 'pause', t.now()));
  await t.run(120_000, 30_000);
  assert.ok(t.logs.length > 0);
  const text = JSON.stringify(t.logs);
  assert.ok(!/geheim|marco/i.test(text), text);
  assert.ok(!text.includes(messageId));
  assert.ok(text.includes(plexCardTag('geheim marco')));
  assert.match(plexCardTag('x'), /^[0-9a-f]{8}$/);
});

test('events without a user leave no card', async () => {
  const t = rig();
  assert.equal(t.manager.handleEvent(CH, ev('', 'play', t.now(), { user: undefined })), false);
  assert.equal(t.manager.handleEvent(CH, ev('  ', 'play', t.now())), false);
  await t.run(10_000);
  assert.equal(t.gateway.posts.length, 0);
  assert.equal(t.store.list(CH).length, 0);
});

test('syncStatus: unsynced until every card shows its state, synced after the flush', async () => {
  const t = rig();
  assert.deepEqual(t.manager.syncStatus(CH), { cards: 0, posted: 0, unsynced: 0, paused: false, lastPostAt: 0 });
  t.manager.handleEvent(CH, ev('Anna', 'play', t.now()));
  assert.equal(t.manager.syncStatus(CH).unsynced, 1);
  await t.run(5000);
  const s = t.manager.syncStatus(CH);
  assert.equal(s.unsynced, 0);
  assert.equal(s.posted, 1);
  assert.ok(s.lastPostAt >= T0);
});

// ─── aliases / exclude ──────────────────────────────────────────────────────

test('alias and exclude env parsing (JSON, pairs, junk) and resolution', () => {
  assert.deepEqual([...parsePlexCardAliases('marco_home=Marco, anna.k = Anna ,broken,=x,y=')], [['marco_home', 'Marco'], ['anna.k', 'Anna']]);
  assert.deepEqual([...parsePlexCardAliases('{"Marco_Home":"Marco","x":1}')], [['marco_home', 'Marco']]);
  assert.equal(parsePlexCardAliases('{not json').size, 0);
  assert.equal(parsePlexCardAliases('[1,2]').size, 0);
  assert.equal(parsePlexCardAliases('').size, 0);
  assert.deepEqual([...parsePlexCardExclude(' Gast , ,Server ')], ['gast', 'server']);
  assert.equal(parsePlexCardExclude('').size, 0);

  const cfg = parsePlexCardUserConfig('marco_home=Marco,marco_tv=Marco', 'Gast');
  assert.deepEqual(resolvePlexCardUser('Marco_Home', cfg), { key: 'marco', name: 'Marco' });
  assert.deepEqual(resolvePlexCardUser('marco_tv', cfg), { key: 'marco', name: 'Marco' }, 'two Plex accounts, one card');
  assert.equal(resolvePlexCardUser('GAST', cfg), null);
  assert.equal(resolvePlexCardUser('', cfg), null);
  assert.equal(resolvePlexCardUser(undefined, cfg), null);
  const byAlias = parsePlexCardUserConfig('a=Gast2', 'gast2');
  assert.equal(resolvePlexCardUser('a', byAlias), null, 'exclude also matches the alias');
  assert.deepEqual(resolvePlexCardUser('Eva', parsePlexCardUserConfig('', '')), { key: 'eva', name: 'Eva' }, 'defaults: no aliases, nobody excluded');
});

test('manager with aliases/exclude: alias merges accounts into one card, excluded users get none', async () => {
  const cfg = parsePlexCardUserConfig('marco_home=Marco,marco_tv=Marco', 'Gast');
  const t = rig({ resolveUser: (raw) => resolvePlexCardUser(raw, cfg) });
  t.manager.handleEvent(CH, ev('marco_home', 'play', t.now()));
  t.manager.handleEvent(CH, ev('marco_tv', 'play', t.now(), { key: 'm2|tv', title: 'Alien' }));
  t.manager.handleEvent(CH, ev('Gast', 'play', t.now()));
  await t.run(6000);
  assert.equal(t.gateway.posts.length, 1);
  const card = t.gateway.posts[0]!.embed.toJSON();
  assert.match(card.title ?? '', /^▶️ Marco · gerade aktiv$/);
  assert.match(card.description ?? '', /Dune/);
  assert.match(card.description ?? '', /Alien/);
  assert.equal(t.store.list(CH).length, 1);
});

// ─── real discord.js payloads ───────────────────────────────────────────────

const target = {
  client: { options: { allowedMentions: { parse: ['users', 'roles', 'everyone'] }, jsonTransformer: (v: unknown) => v } },
};
function wire(options: MessageCreateOptions) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new MessagePayload(target as any, options).resolveBody().body as {
    content?: string; allowed_mentions?: unknown;
    embeds?: Array<{ title?: string; description?: string; footer?: { text: string }; author?: { name: string }; fields?: Array<{ name: string; value: string }> }>;
  };
}

test('real discord.js payload of a user card: embed only, no pings, hostile names/titles inert, within 6000 characters', async () => {
  const sent: MessageCreateOptions[] = [];
  const channel = {
    isSendable: () => true,
    send: async (o: MessageCreateOptions) => { sent.push(o); return { id: '555' }; },
    messages: { edit: async () => undefined, delete: async () => undefined },
  };
  const gateway = createDiscordCardGateway(async () => channel as never);
  const hostile = '@everyone <@123456789012345678> **x** ';
  let state = emptyPlexCardState();
  for (let i = 0; i < 8; i++) {
    state = applyPlexCardEvent(state, ev(hostile, 'play', T0 + i, { key: `k${i}`, player: `p${i}`, title: `${hostile}${'T'.repeat(300)}` }));
    state = applyPlexCardEvent(state, ev(hostile, 'stop', T0 + i + 1, { key: `k${i}`, player: `p${i}`, title: `${hostile}${'T'.repeat(300)}` }));
  }
  await gateway.post(CH, buildPlexUserCardEmbed(hostile.repeat(5), state));
  const body = wire(sent[0]!);
  assert.equal(body.content, undefined);
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  const e = body.embeds![0]!;
  const chars = (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0) + (e.author?.name.length ?? 0)
    + (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
  assert.ok(chars <= 6000, `${chars}`);
  assert.doesNotMatch(`${e.title}${e.description}${e.fields?.[0]?.value}`, /(?<![\\])@/, 'every @ is escaped');
  assert.equal(e.footer?.text, PLEX_USER_CARD_FOOTER);
});

test('the real manager + gateway produce one message per user through discord.js send/edit', async () => {
  const calls: Array<{ kind: string; id?: string }> = [];
  let n = 700;
  const channel = {
    isSendable: () => true,
    send: async (o: MessageCreateOptions) => { wire(o); calls.push({ kind: 'send' }); return { id: String(n++) }; },
    messages: {
      edit: async (id: string, o: { embeds?: unknown[]; allowedMentions?: unknown }) => {
        assert.deepEqual(o.allowedMentions, { parse: [] });
        calls.push({ kind: 'edit', id });
      },
      delete: async () => undefined,
    },
  };
  const store = new MemStore();
  const manager = new PlexCardManager({
    store, gateway: createDiscordCardGateway(async () => channel as never), postSpacingMs: 0, editSpacingMs: 0, log: () => {},
  });
  manager.handleEvent(CH, ev('Anna', 'play', T0));
  manager.handleEvent(CH, ev('Ben', 'play', T0));
  await manager.flush(CH);
  manager.handleEvent(CH, ev('Ben', 'stop', T0 + 1));
  await manager.flush(CH);
  assert.deepEqual(calls.map((c) => c.kind), ['send', 'send', 'edit']);
  assert.equal(calls[2]?.id, store.load(CH, 'ben')?.messageId);
});

// ─── real SQLite: tables, store, migration ──────────────────────────────────

const cols = (table: string) => (sqliteHandle.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

test('real SQLite: new tables exist, store round-trips, list keeps first-post order, corrupt state degrades', () => {
  assert.deepEqual(cols('plex_user_card'), ['guild_id', 'channel_id', 'user_key', 'display_name', 'message_id', 'content_hash', 'state_json', 'posted_at', 'created_at', 'updated_at']);
  assert.deepEqual(cols('plex_cleanup_state'), ['guild_id', 'channel_id', 'status', 'attempts', 'scanned', 'candidates', 'deleted', 'skipped', 'errors', 'scan_limit', 'finished_at']);

  const ch = 'store-ch';
  const mk = (userKey: string, extra: Partial<PlexCardRecord> = {}): PlexCardRecord => ({
    channelId: ch, userKey, displayName: userKey.toUpperCase(), messageId: null, contentHash: null,
    state: applyPlexCardEvent(emptyPlexCardState(), ev(userKey, 'play', T0)), postedAt: null, ...extra,
  });
  assert.equal(plexCardStore.load(ch, 'zoe'), null);
  plexCardStore.save(mk('zoe'));
  plexCardStore.save(mk('adam'));
  plexCardStore.save(mk('zoe', { messageId: '900', contentHash: 'h', postedAt: T0 }));
  assert.deepEqual(plexCardStore.list(ch).map((r) => r.userKey), ['zoe', 'adam'], 'first-post order, an update does not move a card');
  assert.equal(plexCardStore.load(ch, 'zoe')?.messageId, '900');
  assert.equal(plexCardStore.load(ch, 'zoe')?.postedAt, T0);
  assert.equal(plexCardStore.list('other').length, 0);
  sqliteHandle.prepare("UPDATE plex_user_card SET state_json = '{not json' WHERE user_key = 'adam'").run();
  assert.deepEqual(plexCardStore.load(ch, 'adam')?.state, emptyPlexCardState());
});

test('migration from the old single card: split by user, idempotent, old card untouched, then posted one by one', async () => {
  const ch = 'migrate-ch';
  const guild = process.env.DISCORD_GUILD_ID!;
  let old = emptyPlexCardState();
  old = applyPlexCardEvent(old, ev('Anna', 'play', T0, { key: 'a|tv', title: 'Dune' }));
  old = applyPlexCardEvent(old, ev('Ben', 'play', T0 + 1, { key: 'b|tv', title: 'Alien' }));
  old = applyPlexCardEvent(old, ev('Ben', 'stop', T0 + 2, { key: 'b|tv', title: 'Alien' }));
  old = applyPlexCardEvent(old, ev('Gast', 'play', T0 + 3, { key: 'g|tv', title: 'Heat' }));
  sqliteHandle.prepare('INSERT INTO plex_activity_card (guild_id, channel_id, message_id, content_hash, state_json, posted_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(guild, ch, '4242', 'oldhash', JSON.stringify(old), T0, T0);

  const cfg = parsePlexCardUserConfig('', 'Gast');
  assert.equal(migrateLegacyPlexCard(ch, cfg), 2, 'Anna and Ben; the excluded user is not seeded');
  const cards = plexCardStore.list(ch);
  assert.deepEqual(cards.map((c) => c.userKey), ['anna', 'ben']);
  assert.ok(cards.every((c) => c.messageId === null && c.contentHash === null), 'new messages, the old one is never reused');
  assert.equal(cards[0]!.state.sessions[0]?.title, 'Dune');
  assert.equal(cards[1]!.state.sessions.length, 0);
  assert.equal(cards[1]!.state.recent[0]?.title, 'Alien');
  assert.equal(migrateLegacyPlexCard(ch, cfg), 0, 'second run: nothing to do');
  assert.equal(plexCardStore.list(ch).length, 2);
  const legacyRow = sqliteHandle.prepare('SELECT message_id m, content_hash h FROM plex_activity_card WHERE channel_id = ?').get(ch) as { m: string; h: string };
  assert.deepEqual(legacyRow, { m: '4242', h: 'oldhash' }, 'the old card row is not modified');

  // the tick posts the seeded cards sequentially; the old message id is never edited
  const gateway = new Gateway(() => Date.now());
  const manager = new PlexCardManager({ store: plexCardStore, gateway, now: () => T0 + 60_000, postSpacingMs: 0, editSpacingMs: 0, log: () => {} });
  assert.deepEqual(await manager.tick(ch), ['posted', 'posted']);
  assert.equal(gateway.edits.length, 0);
  assert.deepEqual(gateway.posts.map((p) => p.embed.toJSON().title), ['▶️ Anna · gerade aktiv', '💤 Ben · gerade nicht aktiv']);
  assert.equal(manager.syncStatus(ch).unsynced, 0);
  assert.equal(migrateLegacyPlexCard(ch, cfg), 0, 'still idempotent once the cards have message ids');
});

test('migration: nothing to migrate without a legacy row or with an empty legacy state', () => {
  assert.equal(migrateLegacyPlexCard('no-legacy'), 0);
  const guild = process.env.DISCORD_GUILD_ID!;
  sqliteHandle.prepare('INSERT INTO plex_activity_card (guild_id, channel_id, message_id, content_hash, state_json, posted_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(guild, 'empty-legacy', '1', 'h', JSON.stringify(emptyPlexCardState()), T0, T0);
  assert.equal(migrateLegacyPlexCard('empty-legacy'), 0);
  assert.equal(plexCardStore.list('empty-legacy').length, 0);
});
