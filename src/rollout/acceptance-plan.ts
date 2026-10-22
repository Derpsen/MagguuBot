/**
 * Pure parts of `dist/rollout/discord-acceptance.js`: routing matrix, 90-day
 * scan classification, slash-command diff and the Markdown report. All Discord
 * I/O lives in discord-acceptance.ts.
 */
import type { ChannelKey } from '../discord/channel-catalog.js';
import type { CommandInfo } from '../embeds/cards.js';
import { auditMessages, type AuditFinding } from '../utils/card-audit.js';
import type { CommandDiff } from '../utils/command-diff.js';
import type { EnrichedBluePost } from '../services/blue-tracker-enrich.js';
import type { RssItem } from '../services/rss.js';
import { ROUTES, TRANSIENT_KEYS, classifyBotEmbed, type RoutingRow } from '../utils/routing.js';
import { LIVE_PANEL_TITLE, findDuplicateCards, isBotCard, type DuplicateCard, type LiveMessage, type TransientTable } from './cards-plan.js';

/** Every acceptance test message starts with this; leftovers are deleted on --apply. */
export const TEST_MARKER = '🧪 MagguuBot-Abnahmetest';

// ─── 1. Routing matrix ───────────────────────────────────────────────────

export interface TestResult {
  ok: boolean;
  detail: string;
}

export interface MatrixRow {
  source: string;
  key: string;
  channel: string;
  routing: 'ok' | string;
  test: 'ok' | 'offen' | 'nicht integriert' | 'kein Kanal' | string;
}

export function routingMatrix(
  rows: readonly RoutingRow[],
  tests: ReadonlyMap<string, TestResult>,
): MatrixRow[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out: MatrixRow[] = [];
  for (const route of ROUTES) {
    if (!route.integrated) {
      out.push({ source: route.source, key: '–', channel: '–', routing: 'nicht integriert', test: 'nicht integriert' });
      continue;
    }
    if (route.keys.length === 0) {
      out.push({ source: route.source, key: '–', channel: route.note ?? route.delivery, routing: 'ok', test: 'kein Kanal' });
      continue;
    }
    for (const key of route.keys) {
      const row = byKey.get(key);
      const test = tests.get(key);
      out.push({
        source: route.source,
        key,
        channel: row?.actual ? `#${row.actual}` : row?.channelId ?? 'nicht gesetzt',
        routing: row?.problem ? `${row.problem} (Soll ${row.expected ?? '?'})` : 'ok',
        test: test ? (test.ok ? 'ok' : `FEHLER: ${test.detail}`) : 'offen',
      });
    }
  }
  return out;
}

/** Unique keys that get a test post (integrated sources with a channel). */
export function testKeys(): ChannelKey[] {
  return [...new Set(ROUTES.filter((r) => r.integrated && r.delivery === 'channel').flatMap((r) => r.keys))];
}

export function matrixGreen(rows: readonly MatrixRow[]): boolean {
  return rows.every((r) => (r.routing === 'ok' || r.routing === 'nicht integriert') && ['ok', 'nicht integriert', 'kein Kanal'].includes(r.test));
}

// ─── 2. 90-day scan ──────────────────────────────────────────────────────

export interface ScanMessage extends LiveMessage {
  timestamp: string;
  content: string;
  /** Reply to a slash command / component (never routed, never touched). */
  interaction: boolean;
}

export type ScanKind = 'misrouted' | 'duplicatePanel' | 'staleCard' | 'leftoverTest' | 'deadChannel' | 'deadRole' | 'unknownCommand';

export interface ScanFinding {
  kind: ScanKind;
  channelId: string;
  messageId: string;
  detail: string;
  /** Deleted by --apply (bot-authored, not protected or transient). */
  deletable: boolean;
  untrack?: TransientTable;
  /** Card/pin (must be fixed) vs. history post (informational). */
  severity: 'error' | 'info';
}

export interface ScanInput {
  botUserId: string;
  messages: readonly ScanMessage[];
  routes: Partial<Record<ChannelKey, string>>;
  trackedCardIds: ReadonlySet<string>;
  livePanelId: string | null;
  protectedIds: ReadonlySet<string>;
  transient: ReadonlyMap<string, TransientTable>;
  activeChannelIds: ReadonlySet<string>;
  roleIds: ReadonlySet<string>;
  commands: ReadonlyMap<string, CommandInfo>;
}

const ROLE_MENTION = /<@&(\d{17,20})>/g;

const normFooter = (t: string | null | undefined): string => (t ?? '').replace(/\s+·\s+/g, ' · ').trim();

/** A MagguuUI addon release card (release poller or addon-repo GitHub release). */
export function isAddonReleaseEmbed(e: { footer?: { text?: string } | null }): boolean {
  return /^MagguuUI · (neues Release|Vorabversion|stabiles Update)$/.test(normFooter(e.footer?.text));
}

/** A Blizzard/Blue-Tracker post in any format the bot has used. */
export function isBlizzardEmbed(e: { footer?: { text?: string } | null; author?: { name?: string } | null }): boolean {
  return /^MagguuBot · WoW Blue-Tracker/.test(normFooter(e.footer?.text)) || /^Blizzard · /.test(e.author?.name ?? '');
}

export function scanMessages(input: ScanInput): { findings: ScanFinding[]; duplicates: DuplicateCard[] } {
  const findings: ScanFinding[] = [];
  const own = input.messages.filter((m) => m.authorId === input.botUserId);
  const handled = new Set<string>();
  const push = (msg: ScanMessage, f: Omit<ScanFinding, 'channelId' | 'messageId'>): void => {
    findings.push({ channelId: msg.channelId, messageId: msg.id, ...f });
  };

  for (const msg of own) {
    if (msg.type === 6) continue;
    if (msg.content.startsWith(TEST_MARKER)) {
      push(msg, { kind: 'leftoverTest', detail: 'übrig gebliebene Abnahme-Testnachricht', deletable: true, severity: 'error' });
      handled.add(msg.id);
      continue;
    }
    if (msg.interaction) continue;
    const first = msg.embeds[0];
    if (!first) continue;
    if (first.title === LIVE_PANEL_TITLE || /\/downloads-live\b/.test(first.description ?? '')) {
      if (msg.id !== input.livePanelId) {
        push(msg, { kind: 'duplicatePanel', detail: 'doppelte/alte Live-Karte', deletable: !input.protectedIds.has(msg.id), severity: 'error' });
        handled.add(msg.id);
      }
      continue;
    }
    if (isBotCard(msg)) {
      if (!input.trackedCardIds.has(msg.id)) {
        push(msg, { kind: 'staleCard', detail: `alte Karte „${first.title ?? ''}“`, deletable: !input.protectedIds.has(msg.id), severity: 'error' });
        handled.add(msg.id);
      }
      continue;
    }
    const keys = classifyBotEmbed({ title: first.title, author: first.author?.name, footer: first.footer?.text });
    // 📰・updates carries MagguuUI addon releases only; anything else the bot posted there is a finding.
    if (input.routes.addonUpdates && msg.channelId === input.routes.addonUpdates && !isAddonReleaseEmbed(first)) {
      const blizzard = !!keys?.includes('blizzard') || isBlizzardEmbed(first);
      push(msg, {
        kind: 'misrouted',
        detail: blizzard ? 'Blizzard-Post in #updates (verschieben: --move-misrouted blizzard)' : `${keys?.join('/') ?? 'Nicht-Addon'}-Post in #updates (nur MagguuUI-Releases erlaubt)`,
        deletable: false,
        severity: 'error',
      });
      handled.add(msg.id);
      continue;
    }
    if (!keys) continue;
    const targets = keys.map((k) => input.routes[k]).filter((id): id is string => !!id);
    if (targets.length === 0 || targets.includes(msg.channelId)) continue;
    const transient = keys.every((k) => TRANSIENT_KEYS.has(k));
    const table = input.transient.get(msg.id);
    const deletable = transient && (!input.protectedIds.has(msg.id) || !!table);
    push(msg, {
      kind: 'misrouted',
      detail: `${keys.join('/')}-Post im falschen Kanal`,
      deletable,
      ...(deletable && table ? { untrack: table } : {}),
      severity: transient ? 'error' : 'info',
    });
    handled.add(msg.id);
  }

  // Dead channel mentions / unknown commands / dead role mentions.
  const audit: AuditFinding[] = auditMessages(
    own.filter((m) => !m.interaction && !handled.has(m.id)).map((m) => ({ channelId: m.channelId, messageId: m.id, pinned: m.pinned, content: m.content, embeds: m.embeds })),
    input.activeChannelIds,
    input.commands,
  );
  const byId = new Map(own.map((m) => [m.id, m]));
  for (const f of audit) {
    const msg = byId.get(f.messageId);
    const important = !!msg && (msg.pinned || input.trackedCardIds.has(msg.id));
    findings.push({
      kind: f.kind,
      channelId: f.channelId,
      messageId: f.messageId,
      detail: f.kind === 'deadChannel' ? `Kanal ${f.token} existiert nicht mehr` : `Befehl ${f.token} ist nicht registriert`,
      deletable: false,
      severity: important ? 'error' : 'info',
    });
  }
  for (const msg of own) {
    if (msg.interaction || handled.has(msg.id)) continue;
    const text = [msg.content, ...msg.embeds.flatMap((e) => [e.title, e.description, ...(e.fields ?? []).map((x) => x.value)])].filter(Boolean).join('\n');
    for (const m of text.matchAll(ROLE_MENTION)) {
      if (input.roleIds.has(m[1] as string)) continue;
      const important = msg.pinned || input.trackedCardIds.has(msg.id);
      findings.push({ kind: 'deadRole', channelId: msg.channelId, messageId: msg.id, detail: `Rolle ${m[0]} existiert nicht mehr`, deletable: false, severity: important ? 'error' : 'info' });
      break;
    }
  }

  const duplicates = findDuplicateCards(own.filter((m) => m.pinned || input.trackedCardIds.has(m.id)), input.botUserId);
  return { findings, duplicates };
}

// ─── 3. Slash commands ───────────────────────────────────────────────────

export { REMOVED_SERVICES, diffCommands, normText, type CommandDiff, type CommandShape } from '../utils/command-diff.js';

export function commandsGreen(d: CommandDiff): boolean {
  return !d.missing.length && !d.extra.length && !d.changed.length && !d.removedService.length && !d.global.length;
}

// ─── Report ──────────────────────────────────────────────────────────────

export interface SectionResult {
  title: string;
  ok: boolean;
  lines: string[];
}

const cell = (s: string): string => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function matrixMarkdown(rows: readonly MatrixRow[]): string[] {
  return [
    '| Quelle | Key | Ziel-Channel | Routing | Test ok |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${cell(r.source)} | ${cell(r.key)} | ${cell(r.channel)} | ${cell(r.routing)} | ${cell(r.test)} |`),
  ];
}

export function reportMarkdown(meta: { mode: string; startedAt: string; guildId: string }, sections: readonly SectionResult[]): string {
  const green = sections.every((s) => s.ok);
  return [
    `# MagguuBot Abnahme · ${green ? '✅ grün' : '⚠️ nicht grün'}`,
    '',
    `Modus: ${meta.mode} · Start: ${meta.startedAt} · Guild: ${meta.guildId}`,
    '',
    ...sections.flatMap((s) => [`## ${s.ok ? '✅' : '⚠️'} ${s.title}`, '', ...s.lines, '']),
  ].join('\n');
}

// ─── Window cleanup (flood removal) ─────────────────────────────────────

/** Footers of Sonarr/Radarr library-delete cards (single and bundled). GitHub etc. never match. */
export const DELETE_CARD_FOOTER = /^MagguuBot · (File aus der Library entfernt|inkl\. Files auf Disk|nur aus der Library entfernt|Library-Löschungen gebündelt)$/;

export interface WindowCleanupInput {
  botUserId: string;
  messages: readonly ScanMessage[];
  fromMs: number;
  toMs: number;
  /** Only these channels (default: the status channel). */
  channelIds: ReadonlySet<string>;
  /** Pinned cards, panels and other feature-referenced ids. */
  protectedIds: ReadonlySet<string>;
}

/** Bot-authored delete cards in [from, to): never human messages, pins, interactions or other cards. */
export function planWindowCleanup(i: WindowCleanupInput): ScanMessage[] {
  return i.messages.filter((m) => {
    if (m.authorId !== i.botUserId || m.interaction || m.pinned || i.protectedIds.has(m.id)) return false;
    if (!i.channelIds.has(m.channelId)) return false;
    const t = Date.parse(m.timestamp);
    if (!(t >= i.fromMs && t < i.toMs)) return false;
    return m.embeds.length > 0 && m.embeds.every((e) => DELETE_CARD_FOOTER.test((e.footer?.text ?? '').replace(/\s+·\s+/g, ' · ').trim()));
  });
}

// ─── Move misrouted Blizzard posts (📰・updates → 🟦・blizzard-updates) ───

/** The raw Discord embed fields the rebuild needs. */
export interface RawBlueEmbed {
  title?: string;
  url?: string;
  description?: string;
  timestamp?: string;
  author?: { name?: string; icon_url?: string };
  image?: { url?: string };
  fields?: Array<{ name?: string; value?: string }>;
  footer?: { text?: string };
}

const BLUE_BADGE = /^\S+\s+(Hotfix|Tuning|Balance|PTR|Patch Notes|Maintenance) · /;
const READ_MORE_TAIL = /\n*\*\*\[→ Weiterlesen auf bluetracker\.gg\]\([^)]*\)\*\*\s*$/;

/** Rebuild the blue-tracker input from a posted embed (any version); keeps the original publish date. */
export function blueItemFromEmbed(e: RawBlueEmbed, fallbackTimestamp: string): { item: RssItem; enriched: EnrichedBluePost } {
  const title = (e.title ?? '').replace(/^🔵\s*/u, '').replace(/\s+·\s+/g, ' · ').replace(BLUE_BADGE, '').trim();
  const authorName = e.author?.name ?? '';
  const author = /^Blizzard · /.test(authorName) && !/^Blizzard · Blue-Tracker$/.test(authorName) ? authorName.replace(/^Blizzard · /, '').trim() : undefined;
  const body = (e.description ?? '').replace(READ_MORE_TAIL, '').trimEnd();
  const cats = e.fields?.find((f) => f.name === 'Kategorien')?.value ?? '';
  const categories = [...cats.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
  const pub = new Date(e.timestamp ?? fallbackTimestamp);
  const item: RssItem = {
    guid: e.url ?? title,
    title,
    ...(e.url ? { link: e.url } : {}),
    ...(body ? { description: body } : {}),
    ...(author ? { author } : {}),
    ...(Number.isFinite(pub.getTime()) ? { pubDate: pub } : {}),
    ...(categories.length ? { categories } : {}),
  };
  const enriched: EnrichedBluePost = {
    body,
    ...(author ? { author } : {}),
    ...(e.author?.icon_url ? { avatarUrl: e.author.icon_url } : {}),
    ...(e.image?.url ? { firstImage: e.image.url } : {}),
  };
  return { item, enriched };
}

const blueIdentity = (e: RawBlueEmbed): string => e.url ? `url:${e.url}` : `title:${blueItemFromEmbed(e, '1970-01-01T00:00:00Z').item.title.toLowerCase()}`;

export interface MoveMessage {
  id: string;
  channelId: string;
  authorId: string;
  pinned: boolean;
  timestamp: string;
  interaction: boolean;
  embeds: RawBlueEmbed[];
}

export interface PlannedMove {
  messageId: string;
  item: RssItem;
  enriched: EnrichedBluePost;
  /** Already present in the target channel: no repost, only delete the original. */
  existingId: string | null;
}

/** Bot-authored Blizzard posts in `source`, with their repost plan for `target`. Pins, interactions, humans: never. */
export function planBlizzardMove(botUserId: string, source: readonly MoveMessage[], target: readonly MoveMessage[]): PlannedMove[] {
  const existing = new Map<string, string>();
  for (const m of target) {
    const e = m.embeds[0];
    if (m.authorId === botUserId && e && isBlizzardEmbed(e)) existing.set(blueIdentity(e), m.id);
  }
  return source
    .filter((m) => m.authorId === botUserId && !m.interaction && !m.pinned && m.embeds.length === 1 && isBlizzardEmbed(m.embeds[0]!))
    .map((m) => {
      const e = m.embeds[0]!;
      const { item, enriched } = blueItemFromEmbed(e, m.timestamp);
      return { messageId: m.id, item, enriched, existingId: existing.get(blueIdentity(e)) ?? null };
    });
}
