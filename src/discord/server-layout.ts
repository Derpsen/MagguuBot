/**
 * Single source of truth for the Discord server layout (categories, channels,
 * roles) shared by `/setup-server` and the one-shot rollout CLI
 * (`dist/rollout/discord-rollout.js`). Pure data — no discord.js runtime
 * import, so planning logic stays unit-testable.
 *
 * `oldNames` lists live names that are renamed/reused instead of recreated,
 * so channel/role IDs, history and DB references survive the overhaul.
 */
import type { ChannelKey } from './channel-catalog.js';

export type ChannelKind = 'text' | 'voice';

/** Channel keys that cards in `src/embeds/cards.ts` mention (resolved at post time). */
export type ChannelRefKey =
  | ChannelKey
  | 'rules'
  | 'roles'
  | 'botHelp'
  | 'announcements'
  | 'general'
  | 'botCommands';

export interface ChannelPlan {
  name: string;
  /** Live names that are renamed to `name` (searched guild-wide, then moved under the category). */
  oldNames?: string[];
  /** Purpose text; the single source for rollout, acceptance and the live-counter updater. */
  topic?: string;
  /** Topic is `topic · <counter>` kept current by src/discord/channel-topics.ts. */
  liveCounter?: boolean;
  kind?: ChannelKind;
  readOnly?: boolean;
  adminOnly?: boolean;
  allowedRoles?: string[];
  /** Embed mention refs and persistent `channel_config` keys this channel serves. */
  refs?: ChannelRefKey[];
}

export interface CategoryPlan {
  name: string;
  oldNames?: string[];
  channels: ChannelPlan[];
}

export interface RolePlan {
  name: string;
  color: number;
  mentionable?: boolean;
  hoist?: boolean;
  /** Live role renamed to `name` (keeps the ID and its members). */
  oldNames?: string[];
  /** Retired roles whose members are additionally granted this role during rollout. */
  mergeFrom?: string[];
  /**
   * Role permission bitfield as decimal string. Non-staff roles: '0' (inherit @everyone).
   * Colors only apply when a role is created; existing roles keep their color.
   */
  permissions: string;
}

// ─── Permission bits (Discord API v10) ────────────────────────────────────
export const PERM = {
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  CONNECT: 1n << 20n,
  KICK_MEMBERS: 1n << 1n,
  MANAGE_THREADS: 1n << 34n,
  MODERATE_MEMBERS: 1n << 40n,
} as const;

export const ADMIN_PERMISSIONS = PERM.ADMINISTRATOR.toString();
export const MODERATOR_PERMISSIONS = (
  PERM.MANAGE_MESSAGES | PERM.MODERATE_MEMBERS | PERM.KICK_MEMBERS | PERM.MANAGE_THREADS
).toString();

// ─── Name constants for name-based lookups ────────────────────────────────
export const ROLE = {
  admin: 'Admin',
  moderator: 'Moderator',
  plexUser: 'Plex-User',
  regular: 'Regular',
  newcomer: 'Newcomer',
  pingMovies: 'ping-movies',
  pingSeries: 'ping-series',
  pingExtras: 'ping-extras',
  pingWow: 'ping-wow',
  pingAnnouncements: 'ping-announcements',
  pingMagguuui: 'ping-magguuui',
} as const;

export const STAFF_ROLE_NAMES = [ROLE.admin, ROLE.moderator] as const;
const TRUSTED_ROLES = [ROLE.regular, ROLE.plexUser] as const;
const PLEX_ACCESS = [ROLE.plexUser] as const;

export const CHANNEL = {
  welcome: '👋・willkommen',
  announcements: '📢・ankündigungen',
  updates: '📰・updates',
  blizzard: '🟦・blizzard-updates',
  help: '❓・hilfe',
  suggestions: '💡・vorschläge',
  chat: '💬・chat',
  botCommands: '⌨️・bot-befehle',
  movieNight: '🎬・movie-night',
  voice: '🔊 Voice',
  requests: '📝・anfragen',
  newOnPlex: '✨・neu-auf-plex',
  downloads: '📡・downloads',
  plexActivity: '🎬・plex-aktivität',
  approvals: '⏳・freigaben',
  status: '🩺・status',
  logs: '📋・logs',
} as const;

/** Fallback lookup for ticket transcripts when the `ticketLogs` key is missing. */
export const TICKET_LOG_CHANNEL_NAME = CHANNEL.logs;
export const TICKET_CATEGORY_NAME = '🎫 TICKETS';
export const JTC_CATEGORY_NAME = '🎙️ VOICE-CREATE';
export const JTC_TRIGGER_CHANNEL_NAME = '➕ Voice erstellen';
export const ARCHIVE_CATEGORY_NAME = '🗄️ ARCHIV';

/** Dynamic, bot-managed categories that are never archived or deleted. */
export const PROTECTED_CATEGORY_NAMES: ReadonlySet<string> = new Set([
  TICKET_CATEGORY_NAME,
  JTC_CATEGORY_NAME,
  ARCHIVE_CATEGORY_NAME,
]);
export const PROTECTED_CHANNEL_NAMES: ReadonlySet<string> = new Set([JTC_TRIGGER_CHANNEL_NAME]);

// ─── Roles: 17 → 11 ───────────────────────────────────────────────────────
export const ROLES: RolePlan[] = [
  { name: ROLE.admin, color: 0xef4444, hoist: true, permissions: ADMIN_PERMISSIONS },
  { name: ROLE.moderator, color: 0x3b82f6, hoist: true, permissions: MODERATOR_PERMISSIONS },
  { name: ROLE.plexUser, color: 0xe5a00d, hoist: true, permissions: '0' },
  { name: ROLE.regular, color: 0x22c55e, hoist: true, permissions: '0', mergeFrom: ['VIP'] },
  { name: ROLE.newcomer, color: 0x94a3b8, hoist: true, permissions: '0' },
  { name: ROLE.pingMovies, color: 0xffc230, mentionable: true, permissions: '0', mergeFrom: ['Plex-Fan'] },
  { name: ROLE.pingSeries, color: 0x35c5f4, mentionable: true, permissions: '0' },
  { name: ROLE.pingExtras, color: 0x0cd29d, mentionable: true, permissions: '0', oldNames: ['ping-4k'], mergeFrom: ['ping-anime'] },
  {
    name: ROLE.pingWow,
    color: 0x0cd29d,
    mentionable: true,
    permissions: '0',
    oldNames: ['ping-wow-tuning'],
    mergeFrom: ['ping-wow-ptr', 'WoW-Fan'],
  },
  { name: ROLE.pingAnnouncements, color: 0x0cd29d, mentionable: true, permissions: '0' },
  {
    name: ROLE.pingMagguuui,
    color: 0x0cd29d,
    mentionable: true,
    permissions: '0',
    oldNames: ['ping-github'],
    mergeFrom: ['MagguuUI'],
  },
];

// ─── Channels: 13 → 5 categories, 37 → 17 channels ────────────────────────
export const STRUCTURE: CategoryPlan[] = [
  {
    name: '🏠 START',
    oldNames: ['🏠 INFO'],
    channels: [
      {
        name: CHANNEL.welcome,
        oldNames: ['willkommen'],
        topic: 'Start hier: Regeln, Befehle und Ping-Rollen.',
        readOnly: true,
        refs: ['welcome', 'rules', 'roles', 'botHelp'],
      },
      {
        name: CHANNEL.announcements,
        oldNames: ['ankündigungen'],
        topic: 'Server-Updates und Wartungsfenster.',
        readOnly: true,
        refs: ['announcements'],
      },
    ],
  },
  {
    name: '🎨 MAGGUU UI',
    channels: [
      {
        name: CHANNEL.updates,
        oldNames: ['🎨・addon-updates'],
        topic: 'MagguuUI-Releases. Automatisch.',
        readOnly: true,
        refs: ['addonUpdates'],
      },
      {
        name: CHANNEL.blizzard,
        oldNames: ['📰・blue-tracker'],
        topic: 'WoW Blue-Posts, Hotfixes und PTR von Blizzard. Automatisch.',
        readOnly: true,
        refs: ['blizzard'],
      },
      {
        name: CHANNEL.help,
        oldNames: ['❓・faq'],
        topic: 'Fragen zu MagguuUI. `/tag list` zeigt alle FAQ-Einträge.',
        refs: ['faq'],
      },
      {
        name: CHANNEL.suggestions,
        topic: 'Vorschläge mit Vote-Buttons. Einreichen mit /suggest.',
        refs: ['suggestions'],
      },
    ],
  },
  {
    name: '💬 COMMUNITY',
    oldNames: ['💬 CHAT'],
    channels: [
      {
        name: CHANNEL.chat,
        oldNames: ['general'],
        topic: 'Allgemeiner Chat und ⭐-Highlights. Spoiler bitte in Threads.',
        refs: ['general', 'starboard'],
      },
      {
        name: CHANNEL.botCommands,
        oldNames: ['bot-commands'],
        topic: 'Für /queue, /search usw.',
        allowedRoles: [...TRUSTED_ROLES],
        refs: ['botCommands'],
      },
      {
        name: CHANNEL.movieNight,
        topic: 'Filmabend planen, nominieren, abstimmen.',
        allowedRoles: [...TRUSTED_ROLES],
        refs: ['movieNight'],
      },
      { name: CHANNEL.voice, oldNames: ['🔊 General'], kind: 'voice' },
    ],
  },
  {
    name: '🎬 PLEX',
    oldNames: ['🎬 MEDIA'],
    channels: [
      { name: CHANNEL.requests, oldNames: ['requests'], topic: 'Film oder Serie anfragen.', liveCounter: true, refs: ['requests'] },
      {
        name: CHANNEL.newOnPlex,
        oldNames: ['new-on-plex'],
        topic: 'Neu auf Plex und der Wochenrückblick.',
        readOnly: true,
        refs: ['newOnPlex', 'weeklyDigest'],
      },
      {
        name: CHANNEL.downloads,
        oldNames: ['📡・live-downloads'],
        topic: 'Live-Queue, Grabs und Imports von Sonarr, Radarr und SABnzbd. Automatisch.',
        liveCounter: true,
        readOnly: true,
        allowedRoles: [...PLEX_ACCESS],
        refs: ['downloadLive', 'grabs', 'imports'],
      },
      {
        name: CHANNEL.plexActivity,
        oldNames: ['🎬・aktivität'],
        topic: 'Wer gerade was auf Plex schaut (Tautulli). Automatisch.',
        readOnly: true,
        allowedRoles: [...PLEX_ACCESS],
        refs: ['plexActivity'],
      },
    ],
  },
  {
    name: '🛡️ ADMIN',
    oldNames: ['🛡️ MOD'],
    channels: [
      {
        name: CHANNEL.approvals,
        oldNames: ['approvals'],
        topic: 'Freigaben für Anfragen.',
        liveCounter: true,
        readOnly: true,
        adminOnly: true,
        refs: ['approvals'],
      },
      {
        name: CHANNEL.status,
        oldNames: ['🩺・health'],
        topic: 'Fehler, Health, Library-Löschungen und GitHub.',
        liveCounter: true,
        readOnly: true,
        adminOnly: true,
        refs: ['health', 'failures', 'github'],
      },
      {
        name: CHANNEL.logs,
        oldNames: ['📋・audit-log'],
        topic: 'Mod-, Audit- und Ticket-Logs.',
        readOnly: true,
        adminOnly: true,
        refs: ['modLog', 'auditLog', 'ticketLogs'],
      },
    ],
  },
];

export const LAYOUT_CATEGORY_NAMES: ReadonlySet<string> = new Set(STRUCTURE.map((c) => c.name));

export function allChannelPlans(): Array<{ category: CategoryPlan; channel: ChannelPlan }> {
  return STRUCTURE.flatMap((category) => category.channels.map((channel) => ({ category, channel })));
}

export const LAYOUT_CHANNEL_NAMES: ReadonlySet<string> = new Set(allChannelPlans().map(({ channel }) => channel.name));

/** Which layout channel serves a given ref / channel_config key. */
export function channelPlanForRef(ref: ChannelRefKey): ChannelPlan | undefined {
  return allChannelPlans().find(({ channel }) => channel.refs?.includes(ref))?.channel;
}

/** All names a layout role may currently carry on the live server (new name first). */
export function roleNameCandidates(name: string): string[] {
  const plan = ROLES.find((r) => r.name === name || r.oldNames?.includes(name));
  if (!plan) return [name];
  return [plan.name, ...(plan.oldNames ?? [])];
}

/** Resolve a (possibly legacy) role name to its layout role name. */
export function canonicalRoleName(name: string): string {
  const plan = ROLES.find((r) => r.name === name || r.oldNames?.includes(name) || r.mergeFrom?.includes(name));
  return plan?.name ?? name;
}

/** Self-assignable ping roles — the single role-button set (welcome channel + join DM). */
export const PING_ROLE_BUTTONS: ReadonlyArray<{ role: string; label: string; emoji: string }> = [
  { role: ROLE.pingMagguuui, label: 'MagguuUI', emoji: '🎨' },
  { role: ROLE.pingWow, label: 'WoW', emoji: '🎮' },
  { role: ROLE.pingMovies, label: 'Filme', emoji: '🎬' },
  { role: ROLE.pingSeries, label: 'Serien', emoji: '📺' },
  { role: ROLE.pingExtras, label: '4K & Anime', emoji: '✨' },
  { role: ROLE.pingAnnouncements, label: 'Ankündigungen', emoji: '📢' },
];
