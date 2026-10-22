/**
 * Pure planner for `dist/rollout/discord-cards.js --apply`.
 *
 * Only ever touches messages authored by the bot. Never touches messages
 * referenced by other bot features (live panels, giveaways, suggestions …),
 * passed in as `protectedIds`. Idempotent: a second run with unchanged cards
 * plans no writes (message IDs + content hash live in `welcome_messages`).
 */
import { CARD_PLAN_NAMES, type RenderedCard } from '../embeds/cards.js';
import type { AuditEmbed } from '../utils/card-audit.js';
import { CHANNEL } from '../discord/server-layout.js';
import { isNewRef, type Action, type RolloutPlan } from './plan.js';
import type { ChannelKey } from '../discord/channel-catalog.js';
import { TRANSIENT_KEYS, classifyBotEmbed } from '../utils/routing.js';

export interface LiveMessage {
  id: string;
  channelId: string;
  authorId: string;
  pinned: boolean;
  /** Discord message type (0 default, 19 reply, 6 pin notice …). */
  type?: number;
  embeds: AuditEmbed[];
}

/** Tables whose rows point at short-lived status cards (safe to drop with the message). */
export type TransientTable = 'plex_activity_messages';

export interface TrackedCard {
  planName: string;
  channelId: string;
  messageId: string;
  contentHash: string | null;
}

export type CardOp =
  | { op: 'delete'; channelId: string; messageId: string; reason: string; untrack?: TransientTable }
  | { op: 'unpin'; channelId: string; messageId: string; reason: string }
  | { op: 'post'; planName: string; channelId: string; pin: boolean }
  | { op: 'edit'; planName: string; channelId: string; messageId: string; pin: boolean }
  | { op: 'pin'; planName: string; channelId: string; messageId: string }
  | { op: 'forget'; planName: string }
  | { op: 'missingChannel'; planName: string; channel: string };

export const LIVE_PANEL_TITLE = '📡 Live-Downloads';

/** Titles of every bot card generation (current and historical). */
export const CARD_TITLES: ReadonlySet<string> = new Set([
  // current generation (src/embeds/cards.ts)
  '👋 Willkommen im Magguu Homelab', '📜 Regeln', '🎭 Ping-Rollen', '⌨️ Befehle', '📢 Ankündigungen',
  '📰 MagguuUI-Updates', '🟦 Blizzard-Updates', '❓ Hilfe zu MagguuUI', '💡 Vorschläge', '💬 Chat',
  '📦 MagguuUI: Installation & FAQ', '⌨️ Bot-Befehle', '🎬 Filmabend', '📝 Anfragen', '✨ Neu auf Plex', '📡 Downloads', '⏳ Freigaben',
  '🩺 Status', '📋 Logs', '🎬 Plex-Aktivität', '🎫 Support-Tickets',
  // earlier generations (git history of src/embeds/welcome.ts)
  '⌨️ Bot-Befehle ausführen', '⌨️ Bot-Befehle hier', '⏳ Pending Approvals', '⚠️ Failures',
  '⚠️ Failures & Issues', '✅ Imports', '❓  Alles rund ums Addon', '❓ FAQ', '⭐ Starboard — Highlights',
  '🎨 MagguuUI Addon — Updates', '🎨 Nickname-Farbe wählen', '🎬 Movie-Night', '🎬 Plex Activity',
  '🎭 Deine Benachrichtigungen', '🎭 Deine Rollen', '💬 General', '💬 General Chat', '📋 Audit-Log',
  '📜 Server-Regeln', '📝 Film oder Serie requesten', '📝 Film / Serie requesten', '📥 Grabs',
  '📰 WoW Blue-Tracker', '🔇 Spoiler-Zone', '🔨 GitHub-Feed', '🗑️ Gelöscht — Library Cleanup',
  '🗑️ Maintainerr', '🤖 Bot-Befehle', '🤖 Bot-Befehle — Quick Reference', '🩺 Service-Health',
  '🩺 Service-Health & Updates', '🛡️ Mod-Log', 'Ping-Rollen',
]);

/** A bot card of any generation: known title and the MagguuBot footer. */
export function isBotCard(msg: Pick<LiveMessage, 'embeds'>): boolean {
  const first = msg.embeds[0];
  if (!first?.title || !CARD_TITLES.has(first.title)) return false;
  return (first.footer?.text ?? '').startsWith('MagguuBot');
}

export interface DuplicateCard {
  channelId: string;
  title: string;
  messageIds: string[];
}

/** Bot cards / live panels that exist more than once in the same channel. */
export function findDuplicateCards(
  messages: Iterable<Pick<LiveMessage, 'id' | 'channelId' | 'authorId' | 'embeds'>>,
  botUserId: string,
): DuplicateCard[] {
  const groups = new Map<string, DuplicateCard>();
  for (const msg of messages) {
    if (msg.authorId !== botUserId) continue;
    const title = msg.embeds[0]?.title ?? '';
    if (title !== LIVE_PANEL_TITLE && !isBotCard(msg)) continue;
    const key = `${msg.channelId}|${title}`;
    const group = groups.get(key) ?? { channelId: msg.channelId, title, messageIds: [] };
    if (!group.messageIds.includes(msg.id)) group.messageIds.push(msg.id);
    groups.set(key, group);
  }
  // The FAQ card and the help card share a channel but not a title; real duplicates only.
  return [...groups.values()].filter((g) => g.messageIds.length > 1);
}

export interface CardPlanInput {
  botUserId: string;
  /** Rendered cards with the resolved target channel (undefined = channel missing). */
  cards: Array<{ rendered: RenderedCard; channelId: string | undefined }>;
  tracked: TrackedCard[];
  /** Every bot-relevant message we could see: tracked lookups, pins, recent history. */
  live: ReadonlyMap<string, LiveMessage>;
  protectedIds: ReadonlySet<string>;
  /** Resolved channel per key (misrouted transient posts are removed). */
  routes?: Partial<Record<ChannelKey, string>>;
  /** Protected ids that are transient status cards, with their table (deletable when misplaced). */
  transient?: ReadonlyMap<string, TransientTable>;
  /** The tracked live downloads panel (`live_panels`); every other copy is a duplicate. */
  livePanel?: { channelId: string; messageId: string } | null;
}


const snowflakeLess = (a: string, b: string): boolean => BigInt(a) < BigInt(b);

export function planCards(input: CardPlanInput): CardOp[] {
  const ops: CardOp[] = [];
  const keep = new Set<string>();
  const deleted = new Set<string>();
  const trackedBy = new Map(input.tracked.map((t) => [t.planName, t]));
  const ownMessage = (id: string | undefined): LiveMessage | undefined => {
    const msg = id ? input.live.get(id) : undefined;
    return msg && msg.authorId === input.botUserId ? msg : undefined;
  };
  const del = (msg: LiveMessage, reason: string): void => {
    if (deleted.has(msg.id) || keep.has(msg.id) || input.protectedIds.has(msg.id)) return;
    deleted.add(msg.id);
    ops.push({ op: 'delete', channelId: msg.channelId, messageId: msg.id, reason });
  };

  // Group cards by target channel, keeping CARDS order.
  const byChannel = new Map<string, Array<{ rendered: RenderedCard }>>();
  for (const { rendered, channelId } of input.cards) {
    if (!channelId) {
      ops.push({ op: 'missingChannel', planName: rendered.spec.planName, channel: rendered.spec.channel });
      continue;
    }
    const list = byChannel.get(channelId) ?? [];
    list.push({ rendered });
    byChannel.set(channelId, list);
  }

  const posts: CardOp[] = [];
  for (const [channelId, list] of byChannel) {
    const current = list.map(({ rendered }) => {
      const row = trackedBy.get(rendered.spec.planName);
      const msg = row && row.channelId === channelId ? ownMessage(row.messageId) : undefined;
      return { rendered, row, msg };
    });
    // Tracked message sitting in another channel (card moved) → remove the old one.
    for (const { row } of current) {
      if (row && row.channelId !== channelId) {
        const old = ownMessage(row.messageId);
        if (old) del(old, `Karte ${row.planName} ist umgezogen`);
      }
    }
    const allLive = current.every((c) => c.msg);
    const ordered = current.every((c, i) => i === 0 || snowflakeLess((current[i - 1]?.msg?.id ?? '0'), c.msg?.id ?? '0'));
    if (allLive && ordered) {
      for (const { rendered, row, msg } of current) {
        if (!msg || !row) continue;
        keep.add(msg.id);
        if (row.contentHash !== rendered.hash) {
          posts.push({ op: 'edit', planName: rendered.spec.planName, channelId, messageId: msg.id, pin: rendered.spec.pin });
        } else if (rendered.spec.pin && !msg.pinned) {
          posts.push({ op: 'pin', planName: rendered.spec.planName, channelId, messageId: msg.id });
        }
      }
    } else {
      // Missing card or wrong order: re-post the whole channel set top-down.
      for (const { msg, rendered } of current) if (msg) del(msg, `Neu posten (Reihenfolge) ${rendered.spec.planName}`);
      for (const { rendered } of current) posts.push({ op: 'post', planName: rendered.spec.planName, channelId, pin: rendered.spec.pin });
    }
  }

  // Tracked rows that are no card anymore.
  for (const row of input.tracked) {
    if (CARD_PLAN_NAMES.has(row.planName)) continue;
    const msg = ownMessage(row.messageId);
    if (msg) del(msg, `alte Karte ${row.planName}`);
    ops.push({ op: 'forget', planName: row.planName });
  }

  // Transient status posts (Plex activity, live queue) in a channel their key does not
  // point to → delete; duplicates of the live panel → delete; tracked panel → pinned.
  const routes = input.routes ?? {};
  for (const msg of input.live.values()) {
    if (msg.authorId !== input.botUserId || keep.has(msg.id) || deleted.has(msg.id)) continue;
    const first = msg.embeds[0];
    if (!first) continue;
    if (first.title === LIVE_PANEL_TITLE || /\/downloads-live\b/.test(first.description ?? '')) {
      const panel = input.livePanel;
      if (panel && panel.messageId === msg.id) {
        keep.add(msg.id);
        if (!msg.pinned && routes.downloadLive === msg.channelId) {
          posts.push({ op: 'pin', planName: 'live-downloads', channelId: msg.channelId, messageId: msg.id });
        }
        continue;
      }
      if (!input.protectedIds.has(msg.id)) del(msg, 'doppelte/alte Live-Karte');
      continue;
    }
    const keys = classifyBotEmbed({ title: first.title, author: first.author?.name, footer: first.footer?.text });
    if (!keys || !keys.every((k) => TRANSIENT_KEYS.has(k))) continue;
    const targets = keys.map((k) => routes[k]).filter((id): id is string => !!id);
    if (targets.length === 0 || targets.includes(msg.channelId)) continue;
    const table = input.transient?.get(msg.id);
    if (input.protectedIds.has(msg.id) && !table) continue;
    deleted.add(msg.id);
    ops.push({
      op: 'delete', channelId: msg.channelId, messageId: msg.id,
      reason: `falscher Kanal (${keys.join('/')})`, ...(table ? { untrack: table } : {}),
    });
  }

  // Untracked old cards → delete; any other stale bot pin → unpin only.
  for (const msg of input.live.values()) {
    if (msg.authorId !== input.botUserId || keep.has(msg.id) || deleted.has(msg.id) || input.protectedIds.has(msg.id)) continue;
    if (isBotCard(msg)) del(msg, `alte Karte „${msg.embeds[0]?.title ?? ''}“`);
    else if (msg.pinned) ops.push({ op: 'unpin', channelId: msg.channelId, messageId: msg.id, reason: 'veralteter Bot-Pin' });
  }

  // Deletes and unpins first (frees pin slots), then posts/edits/pins in order.
  return [...ops, ...posts];
}

export function describeCardOp(op: CardOp, channelName: (id: string) => string): string {
  switch (op.op) {
    case 'delete': return `Löschen ${channelName(op.channelId)} ${op.messageId} (${op.reason})`;
    case 'unpin': return `Lösen ${channelName(op.channelId)} ${op.messageId} (${op.reason})`;
    case 'post': return `Posten ${channelName(op.channelId)} ${op.planName}${op.pin ? ' + anheften' : ''}`;
    case 'edit': return `Bearbeiten ${channelName(op.channelId)} ${op.planName}${op.pin ? ' (angeheftet)' : ''}`;
    case 'pin': return `Anheften ${channelName(op.channelId)} ${op.planName}`;
    case 'forget': return `DB-Eintrag entfernen ${op.planName}`;
    case 'missingChannel': return `Kanal fehlt für ${op.planName}: ${op.channel}`;
  }
}

/** Channels the cards CLI may create / move itself (everything else belongs to discord-rollout.js). */
export const CARD_LAYOUT_CHANNELS: readonly string[] = [CHANNEL.blizzard, CHANNEL.plexActivity];

/**
 * The layout actions the cards CLI runs before posting: create / reuse
 * 🟦・blizzard-updates and 🎬・plex-aktivität, and re-point every channel key at
 * its layout channel (routing). Never touches guild settings (public updates
 * channel, community, onboarding). If an action depends on an object that does
 * not exist yet, the full rollout has to run first.
 */
export function cardLayoutActions(plan: Pick<RolloutPlan, 'actions' | 'channelRefs'>): { actions: Action[]; blocker: string | null } {
  const refs = new Set<string>();
  for (const name of CARD_LAYOUT_CHANNELS) {
    const ref = plan.channelRefs[name];
    if (!ref) return { actions: [], blocker: `${name} nicht im Plan` };
    refs.add(ref);
  }
  const actions = plan.actions.filter((a) =>
    (a.kind === 'createChannel' && refs.has(a.ref))
    || (a.kind === 'updateChannel' && refs.has(a.id))
    || (a.kind === 'setChannelKey' && (!isNewRef(a.target) || refs.has(a.target))));
  const deps = new Set<string>();
  for (const a of actions) {
    if (a.kind === 'createChannel') {
      deps.add(a.parent);
      for (const o of a.overwrites) deps.add(o.target);
    }
    if (a.kind === 'updateChannel') {
      if (a.changes.parent) deps.add(a.changes.parent);
      for (const o of a.changes.overwrites ?? []) deps.add(o.target);
    }
  }
  const missing = [...deps].filter((d) => isNewRef(d) && !refs.has(d));
  return missing.length
    ? { actions: [], blocker: `Erst discord-rollout.js --apply ausführen (fehlt: ${missing.join(', ')})` }
    : { actions, blocker: null };
}
