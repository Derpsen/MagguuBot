/**
 * Shared live-guild helpers for the rollout CLIs (discord-cards.js, discord-acceptance.js):
 * raw message access via REST, card DB rows, guild view and pin handling.
 * Bot token comes from the container env and is never printed.
 */
import { config } from '../config.js';
import { sqliteHandle } from '../db/client.js';
import { CHANNEL_CATALOG, type ChannelKey } from '../discord/channel-catalog.js';
import { listTicketCategories } from '../discord/ticket-categories.js';
import { ARCHIVE_CATEGORY_NAME } from '../discord/server-layout.js';
import { commandIndex, resolveChannelRefs, type CardContext } from '../embeds/cards.js';
import { expectedChannelName } from '../utils/routing.js';
import type { LiveMessage, TrackedCard, TransientTable } from './cards-plan.js';
import { isNewRef, planRollout, type GuildSnapshot } from './plan.js';
import { DiscordError, type DiscordRest } from './rest.js';

// ─── Raw message access ──────────────────────────────────────────────────
export interface RawMessage {
  id: string;
  channel_id: string;
  type: number;
  author: { id: string; username?: string; bot?: boolean };
  content: string;
  pinned: boolean;
  timestamp: string;
  edited_timestamp?: string | null;
  embeds: Array<Record<string, unknown>>;
  components?: unknown[];
  attachments?: Array<{ filename?: string; url?: string }>;
  interaction_metadata?: unknown;
  interaction?: unknown;
}

export const TEXT_TYPES = new Set([0, 5]);

export function toLive(m: RawMessage): LiveMessage {
  return { id: m.id, channelId: m.channel_id, authorId: m.author.id, pinned: m.pinned, type: m.type, embeds: m.embeds as LiveMessage['embeds'] };
}

export interface PinPage { items: Array<{ pinned_at: string; message: RawMessage }>; has_more: boolean }

export async function fetchPins(rest: DiscordRest, channelId: string): Promise<RawMessage[]> {
  const out: RawMessage[] = [];
  let before: string | null = null;
  try {
    for (let page = 0; page < 5; page++) {
      const q: string = `?limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`;
      const res: PinPage | null = await rest.request<PinPage>(
        'GET', `/channels/${channelId}/messages/pins${q}`,
      );
      for (const item of res?.items ?? []) out.push({ ...item.message, pinned: true });
      if (!res?.has_more || !res.items.length) break;
      before = res.items[res.items.length - 1]?.pinned_at ?? null;
    }
    return out;
  } catch (err) {
    if (err instanceof DiscordError && err.status === 404) {
      const legacy = await rest.request<RawMessage[]>('GET', `/channels/${channelId}/pins`);
      return (legacy ?? []).map((m) => ({ ...m, pinned: true }));
    }
    throw err;
  }
}

export async function fetchHistory(rest: DiscordRest, channelId: string, limit: number, onlyAuthor?: string): Promise<RawMessage[]> {
  const out: RawMessage[] = [];
  let before: string | undefined;
  let scanned = 0;
  while (scanned < limit) {
    const n = Math.min(100, limit - scanned);
    const page = (await rest.request<RawMessage[]>('GET', `/channels/${channelId}/messages?limit=${n}${before ? `&before=${before}` : ''}`)) ?? [];
    scanned += page.length;
    for (const m of page) if (!onlyAuthor || m.author.id === onlyAuthor) out.push(m);
    if (page.length < n) break;
    before = page[page.length - 1]?.id;
  }
  return out;
}

export async function fetchMessage(rest: DiscordRest, channelId: string, messageId: string): Promise<RawMessage | null> {
  return rest.request<RawMessage>('GET', `/channels/${channelId}/messages/${messageId}`, undefined, [403, 404]);
}

// ─── DB ──────────────────────────────────────────────────────────────────
export function trackedCards(guildId: string): TrackedCard[] {
  return (sqliteHandle.prepare('SELECT plan_name, channel_id, message_id, content_hash FROM welcome_messages WHERE guild_id = ?').all(guildId) as Array<{
    plan_name: string; channel_id: string; message_id: string; content_hash: string | null;
  }>).map((r) => ({ planName: r.plan_name, channelId: r.channel_id, messageId: r.message_id, contentHash: r.content_hash }));
}

export function saveCard(guildId: string, planName: string, channelId: string, messageId: string, hash: string): void {
  sqliteHandle.prepare(`INSERT INTO welcome_messages (guild_id, plan_name, channel_id, message_id, content_hash, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, plan_name) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id,
      content_hash = excluded.content_hash, updated_at = excluded.updated_at`).run(guildId, planName, channelId, messageId, hash, Date.now());
}

export function forgetCard(guildId: string, planName: string): void {
  sqliteHandle.prepare('DELETE FROM welcome_messages WHERE guild_id = ? AND plan_name = ?').run(guildId, planName);
}

/** Every message id referenced by another bot feature (any *message_id column outside welcome_messages). */
export function protectedMessageIds(): Set<string> {
  const ids = new Set<string>();
  const tables = sqliteHandle.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
  for (const { name } of tables) {
    if (name === 'welcome_messages') continue;
    const cols = (sqliteHandle.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all() as Array<{ name: string }>)
      .map((c) => c.name).filter((c) => /message_id$/.test(c));
    for (const col of cols) {
      const rows = sqliteHandle.prepare(`SELECT "${col}" AS v FROM "${name.replace(/"/g, '""')}" WHERE "${col}" IS NOT NULL`).all() as Array<{ v: unknown }>;
      for (const r of rows) if (typeof r.v === 'string' && /^\d{17,20}$/.test(r.v)) ids.add(r.v);
    }
  }
  return ids;
}

// ─── Context ─────────────────────────────────────────────────────────────
export interface GuildView {
  snap: GuildSnapshot;
  names: Map<string, string>;
  /** Text channels outside 🗄️ ARCHIV (mention targets that count as existing). */
  activeIds: Set<string>;
  textChannels: Array<{ id: string; name: string; archived: boolean }>;
  layoutIds: Record<string, string | undefined>;
}

export function viewOf(snap: GuildSnapshot): GuildView {
  const archive = snap.channels.find((c) => c.type === 4 && c.name === ARCHIVE_CATEGORY_NAME)?.id ?? null;
  const names = new Map(snap.channels.map((c) => [c.id, c.name]));
  const activeIds = new Set(snap.channels.filter((c) => c.type !== 4 && (archive === null || c.parent_id !== archive)).map((c) => c.id));
  const textChannels = snap.channels.filter((c) => TEXT_TYPES.has(c.type)).map((c) => ({ id: c.id, name: c.name, archived: archive !== null && c.parent_id === archive }));
  const plan = planRollout(snap);
  const layoutIds: Record<string, string | undefined> = {};
  for (const [name, ref] of Object.entries(plan.channelRefs)) if (!isNewRef(ref)) layoutIds[name] = ref;
  return { snap, names, activeIds, textChannels, layoutIds };
}

export async function registeredCommands(rest: DiscordRest): Promise<CardContext['commands']> {
  const list = (await rest.request<Array<{ name: string; options?: Array<{ type: number; name: string }> }>>(
    'GET', `/applications/${config.DISCORD_CLIENT_ID}/guilds/${config.DISCORD_GUILD_ID}/commands`,
  )) ?? [];
  return commandIndex(list);
}

// ─── Live state for plan / check ────────────────────────────────────────
export async function collectLive(rest: DiscordRest, view: GuildView, scanLimit: number, tracked: TrackedCard[]): Promise<Map<string, LiveMessage>> {
  const botId = view.snap.botUserId;
  const live = new Map<string, LiveMessage>();
  for (const row of tracked) {
    const m = await fetchMessage(rest, row.channelId, row.messageId).catch(() => null);
    if (m) live.set(m.id, toLive(m));
  }
  for (const ch of view.textChannels) {
    if (ch.archived) continue;
    for (const m of await fetchPins(rest, ch.id).catch(() => [] as RawMessage[])) if (m.author.id === botId) live.set(m.id, toLive(m));
    if (scanLimit > 0) {
      for (const m of await fetchHistory(rest, ch.id, scanLimit, botId).catch(() => [] as RawMessage[])) {
        if (!live.has(m.id)) live.set(m.id, toLive(m));
      }
    }
  }
  return live;
}

export function cardContext(view: GuildView, commands: CardContext['commands']): CardContext {
  return { channels: resolveChannelRefs(view.layoutIds, view.activeIds), commands, ticketCategories: listTicketCategories() };
}

/** Target channel per key: the layout channel that carries it (the state --apply establishes). */
export function layoutRoutes(view: GuildView): Partial<Record<ChannelKey, string>> {
  const out: Partial<Record<ChannelKey, string>> = {};
  for (const { key } of CHANNEL_CATALOG) {
    const name = expectedChannelName(key);
    const id = name ? view.layoutIds[name] : undefined;
    if (id) out[key] = id;
  }
  return out;
}

export function transientMessages(): Map<string, TransientTable> {
  const out = new Map<string, TransientTable>();
  try {
    for (const r of sqliteHandle.prepare('SELECT message_id FROM plex_activity_messages').all() as Array<{ message_id: string }>) {
      out.set(r.message_id, 'plex_activity_messages');
    }
  } catch { /* table missing on very old DBs */ }
  return out;
}

export function trackedLivePanel(guildId: string): { channelId: string; messageId: string } | null {
  const row = sqliteHandle.prepare("SELECT channel_id, message_id FROM live_panels WHERE guild_id = ? AND kind = 'downloads' AND enabled = 1")
    .get(guildId) as { channel_id: string; message_id: string } | undefined;
  return row && /^\d{17,20}$/.test(row.message_id) ? { channelId: row.channel_id, messageId: row.message_id } : null;
}

// ─── Apply ───────────────────────────────────────────────────────────────
export async function deletePinNotice(rest: DiscordRest, channelId: string, messageId: string, botId: string): Promise<void> {
  const recent = (await rest.request<RawMessage[]>('GET', `/channels/${channelId}/messages?limit=5&after=${messageId}`).catch(() => null)) ?? [];
  for (const m of recent) {
    if (m.type === 6 && m.author.id === botId) await rest.request('DELETE', `/channels/${channelId}/messages/${m.id}`, undefined, [404]).catch(() => null);
  }
}

export async function pin(rest: DiscordRest, channelId: string, messageId: string, botId: string): Promise<void> {
  try {
    await rest.request('PUT', `/channels/${channelId}/messages/pins/${messageId}`);
  } catch (err) {
    if (!(err instanceof DiscordError) || err.status !== 404) throw err;
    await rest.request('PUT', `/channels/${channelId}/pins/${messageId}`);
  }
  await deletePinNotice(rest, channelId, messageId, botId);
}

export async function unpin(rest: DiscordRest, channelId: string, messageId: string): Promise<void> {
  try {
    await rest.request('DELETE', `/channels/${channelId}/messages/pins/${messageId}`, undefined, [404]);
  } catch (err) {
    if (!(err instanceof DiscordError) || err.status !== 404) throw err;
    await rest.request('DELETE', `/channels/${channelId}/pins/${messageId}`, undefined, [404]);
  }
}


/** Every message newer than `sinceMs` (newest first), capped at `max` per channel. */
export async function fetchHistorySince(rest: DiscordRest, channelId: string, sinceMs: number, max: number): Promise<{ messages: RawMessage[]; truncated: boolean }> {
  const out: RawMessage[] = [];
  let before: string | undefined;
  while (out.length < max) {
    const page = (await rest.request<RawMessage[]>('GET', `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`)) ?? [];
    for (const m of page) {
      if (Date.parse(m.timestamp) < sinceMs) return { messages: out, truncated: false };
      out.push(m);
    }
    if (page.length < 100) return { messages: out, truncated: false };
    before = page[page.length - 1]?.id;
  }
  return { messages: out, truncated: true };
}
