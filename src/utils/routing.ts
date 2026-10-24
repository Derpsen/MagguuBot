/**
 * Routing matrix: which bot source posts to which channel key, and which layout
 * channel that key must resolve to. Pure — used by tests, /doctor, the daily
 * self-check and `dist/rollout/discord-acceptance.js`.
 */
import { CHANNEL_CATALOG, type ChannelKey } from '../discord/channel-catalog.js';
import { TICKET_CATEGORY_NAME, allChannelPlans } from '../discord/server-layout.js';

export type RouteDelivery = 'channel' | 'dm' | 'none';

export interface RouteSpec {
  /** Display name in the matrix (German, as in the report). */
  source: string;
  keys: ChannelKey[];
  integrated: boolean;
  delivery: RouteDelivery;
  note?: string;
}

export const ROUTES: readonly RouteSpec[] = [
  { source: 'Sonarr', keys: ['grabs', 'imports', 'failures', 'health'], integrated: true, delivery: 'channel' },
  { source: 'Radarr', keys: ['grabs', 'imports', 'failures', 'health'], integrated: true, delivery: 'channel' },
  { source: 'SABnzbd', keys: ['imports', 'failures', 'health'], integrated: true, delivery: 'channel' },
  { source: 'Live-Queue (Sonarr/Radarr/SABnzbd)', keys: ['downloadLive'], integrated: true, delivery: 'channel' },
  { source: 'Sonarr/Radarr Library-Löschungen', keys: ['health'], integrated: true, delivery: 'channel', note: 'gebündelt: 1 Sammelkarte pro Burst' },
  { source: 'Sonarr/Radarr/SABnzbd Burst (Grabs/Imports)', keys: ['grabs', 'imports'], integrated: true, delivery: 'channel', note: 'je Item 1 Karte (dedupliziert, SAB+Arr = 1), ab 6 pro Burst 1 Sammelkarte' },
  { source: 'Neu auf Plex Burst', keys: ['newOnPlex'], integrated: true, delivery: 'channel', note: 'dedupliziert, ab 6 pro Burst 1 Sammelkarte' },
  { source: 'Plex/Tautulli Aktivität', keys: ['plexActivity'], integrated: true, delivery: 'channel' },
  { source: 'Plex/Tautulli Neu auf Plex', keys: ['newOnPlex'], integrated: true, delivery: 'channel' },
  { source: 'Wochenrückblick', keys: ['weeklyDigest'], integrated: true, delivery: 'channel' },
  { source: 'Plex-Wochenstatistik (1 Karte, editiert)', keys: ['weeklyDigest'], integrated: true, delivery: 'channel', note: 'Kanal-Override: DISCORD_CHANNEL_PLEX_WEEKLY' },
  { source: 'Seerr', keys: ['requests', 'approvals', 'failures'], integrated: true, delivery: 'channel' },
  { source: 'Prowlarr', keys: ['health'], integrated: true, delivery: 'channel' },
  { source: 'GitHub (CI, PRs, Issues)', keys: ['github'], integrated: true, delivery: 'channel' },
  { source: 'MagguuUI Releases', keys: ['addonUpdates'], integrated: true, delivery: 'channel' },
  { source: 'Blizzard/Blue-Tracker', keys: ['blizzard'], integrated: true, delivery: 'channel' },
  { source: 'Join (Willkommen)', keys: ['welcome'], integrated: true, delivery: 'channel', note: 'plus einmalige DM' },
  { source: 'Join/Leave/Rollen (Audit)', keys: ['auditLog'], integrated: true, delivery: 'channel' },
  { source: 'Moderation', keys: ['modLog'], integrated: true, delivery: 'channel' },
  { source: 'Tickets (Transkripte)', keys: ['ticketLogs'], integrated: true, delivery: 'channel', note: `Ticket-Kanäle on demand in ${TICKET_CATEGORY_NAME}` },
  { source: 'Health/Status', keys: ['health'], integrated: true, delivery: 'channel' },
  { source: 'FAQ', keys: ['faq'], integrated: true, delivery: 'channel' },
  { source: 'Vorschläge', keys: ['suggestions'], integrated: true, delivery: 'channel' },
  { source: 'Movie-Night', keys: ['movieNight'], integrated: true, delivery: 'channel' },
  { source: 'Starboard', keys: ['starboard'], integrated: true, delivery: 'channel' },
  { source: 'Level/XP', keys: [], integrated: true, delivery: 'none', note: 'vergibt nur Rollen, kein Kanal-Post' },
  { source: 'Erinnerungen (/remindme)', keys: [], integrated: true, delivery: 'dm', note: 'DM, Fallback im Kanal des Befehls' },
  { source: 'Bazarr', keys: [], integrated: false, delivery: 'none', note: 'nicht integriert' },
  { source: 'Uptime Kuma', keys: [], integrated: false, delivery: 'none', note: 'nicht integriert' },
  { source: 'Twitch', keys: [], integrated: false, delivery: 'none', note: 'nicht integriert' },
];

/** Keys that may land in 📡・downloads: only Sonarr, Radarr and SABnzbd output. */
export const DOWNLOADS_KEYS: ReadonlySet<ChannelKey> = new Set(['downloadLive', 'grabs', 'imports']);

/**
 * Keys whose posts are short-lived status cards. A misplaced one is deleted on
 * `--apply`; misplaced history (grabs, releases …) is only reported.
 */
export const TRANSIENT_KEYS: ReadonlySet<ChannelKey> = new Set(['plexActivity', 'downloadLive']);

/** Layout channel name each channel key must resolve to (from `refs` in server-layout). */
export function expectedChannelName(key: ChannelKey): string | undefined {
  return allChannelPlans().find(({ channel }) => channel.refs?.includes(key))?.channel.name;
}

export function expectedChannelNames(): Record<ChannelKey, string | undefined> {
  return Object.fromEntries(CHANNEL_CATALOG.map(({ key }) => [key, expectedChannelName(key)])) as Record<
    ChannelKey,
    string | undefined
  >;
}

export interface LiveChannelInfo {
  id: string;
  name: string;
  parentId: string | null;
}

export type RoutingProblem = 'unset' | 'missing' | 'archived' | 'wrong-channel' | 'no-layout';

export interface RoutingRow {
  key: ChannelKey;
  expected: string | undefined;
  channelId: string | undefined;
  actual: string | undefined;
  problem: RoutingProblem | null;
}

/**
 * Check every channel key: configured → exists → not archived → matches the
 * layout channel that is meant to carry it (flags sources mapped to unrelated channels).
 */
export function checkRouting(
  resolveKey: (key: ChannelKey) => string | undefined,
  channels: ReadonlyMap<string, LiveChannelInfo>,
  archivedCategoryIds: ReadonlySet<string>,
): RoutingRow[] {
  return CHANNEL_CATALOG.map(({ key }) => {
    const expected = expectedChannelName(key);
    const channelId = resolveKey(key);
    const live = channelId ? channels.get(channelId) : undefined;
    let problem: RoutingProblem | null = null;
    if (!expected) problem = 'no-layout';
    else if (!channelId) problem = 'unset';
    else if (!live) problem = 'missing';
    else if (live.parentId && archivedCategoryIds.has(live.parentId)) problem = 'archived';
    else if (live.name !== expected) problem = 'wrong-channel';
    return { key, expected, channelId, actual: live?.name, problem };
  });
}

export function describeRoutingProblem(row: RoutingRow): string {
  switch (row.problem) {
    case 'unset':
      return `${row.key}: nicht gesetzt (Soll ${row.expected})`;
    case 'missing':
      return `${row.key}: Kanal ${row.channelId} existiert nicht (Soll ${row.expected})`;
    case 'archived':
      return `${row.key}: zeigt auf archivierten Kanal #${row.actual} (Soll ${row.expected})`;
    case 'wrong-channel':
      return `${row.key}: zeigt auf #${row.actual}, Soll ${row.expected}`;
    case 'no-layout':
      return `${row.key}: kein Layout-Kanal trägt diesen Key`;
    default:
      return `${row.key}: ok`;
  }
}

/** Minimal embed view used to recognise which source posted a bot message. */
export interface EmbedView {
  title?: string | null;
  author?: string | null;
  footer?: string | null;
}

const PLEX_ACTIVITY_KINDS = /^MagguuBot · (play|pause|resume|stop|watched|buffer|error)$/;

/**
 * Recognise the routed source of a bot-authored (non-interaction) message by its
 * stable embed markers. Returns the channel keys it may live under, or null if the
 * message is not a routed feed post (cards, command replies, …).
 */
export function classifyBotEmbed(embed: EmbedView): ChannelKey[] | null {
  const title = embed.title ?? '';
  const author = embed.author ?? '';
  const footer = (embed.footer ?? '').replace(/\s+·\s+/g, ' · ');
  if (title === '📡 Live-Downloads') return ['downloadLive'];
  if (author.startsWith('Plex-Aktivität') || footer === 'MagguuBot · Plex-Aktivität') return ['plexActivity'];
  if (author.startsWith('Plex · ') && PLEX_ACTIVITY_KINDS.test(footer)) return ['plexActivity'];
  if (footer === 'MagguuBot · recently_added' || footer === 'MagguuBot · now available') return ['newOnPlex'];
  if (footer === 'MagguuBot · automatisch jeden Sonntag') return ['weeklyDigest'];
  if (footer === 'MagguuBot · Plex-Wochenstatistik') return ['weeklyDigest'];
  if (footer.startsWith('MagguuBot · WoW Blue-Tracker')) return ['blizzard'];
  if (/^MagguuUI · (neues Release|Vorabversion|stabiles Update)$/.test(footer)) return ['addonUpdates', 'github'];
  if (footer.startsWith('GitHub · ')) return ['github', 'addonUpdates'];
  if (footer === 'MagguuBot · Library-Löschungen gebündelt') return ['health'];
  if (/^MagguuBot · (File aus der Library entfernt|inkl\. Files auf Disk|nur aus der Library entfernt)$/.test(footer)) return ['health'];
  if (footer === 'MagguuBot · Imports gebündelt') return ['imports'];
  if (footer === 'MagguuBot · Grabs gebündelt') return ['grabs'];
  if (footer === 'MagguuBot · Neu auf Plex gebündelt') return ['newOnPlex'];
  if (footer === 'MagguuBot · Download gestartet') return ['grabs'];
  if (footer === 'MagguuBot · auf Plex verfügbar') return ['imports'];
  if (footer === 'MagguuBot · SABnzbd') return ['imports', 'failures', 'health'];
  if (footer.startsWith('Suggestion #')) return ['suggestions'];
  if (footer.startsWith('Eine Stimme pro Person')) return ['movieNight'];
  if (/^\S+ \d+ · \d{17,20}$/.test(footer)) return ['starboard'];
  return null;
}

/** Channel names a classified post may live in (layout names for its keys). */
export function allowedChannelNames(keys: readonly ChannelKey[]): Set<string> {
  return new Set(keys.map(expectedChannelName).filter((n): n is string => !!n));
}
