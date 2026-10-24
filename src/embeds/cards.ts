/**
 * Bot cards (pinned info posts) in the ui.magguu.xyz style: brand color
 * #0CD29D, short German text, website logo in the footer.
 *
 * Pure builders: every channel mention and every slash command comes from a
 * `CardContext` that is resolved at post time from the live guild + the
 * registered command list. A channel that does not exist renders as plain
 * bold text (never a dead `<#id>` → "#unbekannt"); a command that is not
 * registered is left out entirely.
 *
 * Used by `/setup-server` and `dist/rollout/discord-cards.js`.
 */
import { createHash } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { ResolvedTicketCategory } from '../discord/ticket-categories.js';
import { BRAND_COLOR, WEBSITE_LOGO_URL } from './colors.js';
import {
  CHANNEL,
  PING_ROLE_BUTTONS,
  ROLE,
  allChannelPlans,
  type ChannelRefKey,
} from '../discord/server-layout.js';

export const CARD_FOOTER_TEXT = 'MagguuBot · ui.magguu.xyz';

export interface CommandInfo {
  /** Subcommand (and `group sub`) names. */
  subcommands: ReadonlySet<string>;
}

export interface CardContext {
  /** Mention targets that exist in the guild right now. */
  channels: Partial<Record<ChannelRefKey, string>>;
  /** Registered slash commands by name. */
  commands: ReadonlyMap<string, CommandInfo>;
  /** Ticket categories for the help-channel ticket panel (DB or defaults). */
  ticketCategories?: ReadonlyArray<Pick<ResolvedTicketCategory, 'key' | 'label' | 'emoji' | 'description'>>;
}

export type CardRow = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;

export interface CardPayload {
  embeds: EmbedBuilder[];
  components: CardRow[];
}

export interface CardSpec {
  /** Stable id in `welcome_messages.plan_name`. */
  planName: string;
  /** Layout channel name (`CHANNEL.*`). */
  channel: string;
  /** Pinned so it stays on top of the channel. */
  pin: boolean;
  build: (ctx: CardContext) => CardPayload;
}

// ─── Context helpers ──────────────────────────────────────────────────────

interface RawOption { type: number; name: string; options?: RawOption[] }
interface RawCommand { name: string; options?: RawOption[] }

/** Index of registered commands (from `SlashCommandBuilder#toJSON()` or the REST list). */
export function commandIndex(list: Iterable<RawCommand>): Map<string, CommandInfo> {
  const out = new Map<string, CommandInfo>();
  for (const cmd of list) {
    const subs = new Set<string>();
    for (const opt of cmd.options ?? []) {
      if (opt.type === 1) subs.add(opt.name);
      if (opt.type === 2) for (const sub of opt.options ?? []) if (sub.type === 1) subs.add(`${opt.name} ${sub.name}`);
    }
    out.set(cmd.name, { subcommands: subs });
  }
  return out;
}

/**
 * Map layout channel ids to mention refs, keeping only channels that exist.
 * `layoutIds` is keyed by layout channel name (`CHANNEL.*`).
 */
export function resolveChannelRefs(
  layoutIds: Readonly<Record<string, string | undefined>>,
  existing: ReadonlySet<string>,
): Partial<Record<ChannelRefKey, string>> {
  const refs: Partial<Record<ChannelRefKey, string>> = {};
  for (const { channel } of allChannelPlans()) {
    const id = layoutIds[channel.name];
    if (!id || !existing.has(id)) continue;
    for (const key of channel.refs ?? []) refs[key] ??= id;
  }
  return refs;
}

/** `<#id>` when the channel exists, otherwise its name in bold (no dead mention). */
export function mention(ctx: CardContext, ref: ChannelRefKey, name: string): string {
  const id = ctx.channels[ref];
  return id ? `<#${id}>` : `**${name}**`;
}

/** True when `/name` (optionally `name sub`) is registered. */
export function hasCommand(ctx: CardContext, path: string): boolean {
  const [name, ...rest] = path.split(' ');
  const info = name ? ctx.commands.get(name) : undefined;
  if (!info) return false;
  return rest.length === 0 || info.subcommands.has(rest.join(' '));
}

/** Bullet lines for commands that exist; missing ones are dropped. */
export function commandLines(ctx: CardContext, items: ReadonlyArray<[path: string, text: string]>): string[] {
  return items.filter(([path]) => hasCommand(ctx, path)).map(([path, text]) => `\`/${path}\` ${text}`);
}

function card(title: string, lines: Array<string | null | false | undefined>): EmbedBuilder {
  const body = lines.filter((l): l is string => typeof l === 'string').join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(title)
    .setDescription(body || '—')
    .setFooter({ text: CARD_FOOTER_TEXT, iconURL: WEBSITE_LOGO_URL });
}

function section(heading: string, lines: string[]): string | null {
  return lines.length ? `**${heading}**\n${lines.join('\n')}` : null;
}

const only = (embed: EmbedBuilder, components: CardRow[] = []): CardPayload => ({ embeds: [embed], components });

// ─── Cards ────────────────────────────────────────────────────────────────

export function buildWelcomeCard(ctx: CardContext): CardPayload {
  return only(card('👋 Willkommen im Magguu Homelab', [
    'MagguuUI, Plex und eine kleine Community. Schön, dass du da bist.',
    '',
    '**So startest du**',
    '1. Regeln unten lesen',
    '2. Ping-Rollen per Button holen',
    `3. Fragen zu MagguuUI: ${mention(ctx, 'faq', CHANNEL.help)}`,
    `4. Film oder Serie wünschen: ${mention(ctx, 'requests', CHANNEL.requests)}`,
    '',
    `Neues zu MagguuUI: ${mention(ctx, 'addonUpdates', CHANNEL.updates)} · WoW-News: ${mention(ctx, 'blizzard', CHANNEL.blizzard)}`,
  ]));
}

export function buildRulesCard(_ctx: CardContext): CardPayload {
  return only(card('📜 Regeln', [
    '1. Respektvoll bleiben. Kein Hate, kein Drama.',
    '2. Spoiler nur mit `||Spoiler-Tags||` oder im Thread.',
    '3. Keine Download-Links, Torrents oder NZBs.',
    '4. Ein Thema, ein Kanal. Smalltalk in den Chat.',
    '5. Admins haben das letzte Wort. Kritik gern per DM.',
    '',
    '_Verstöße: Warnung → Timeout → Kick → Ban._',
  ]));
}

export function buildRolesCard(_ctx: CardContext): CardPayload {
  return only(card('🎭 Ping-Rollen', [
    'Ein Klick schaltet die Rolle an oder aus. Du wirst nur gepingt, wenn etwas Passendes kommt.',
    '',
    PING_ROLE_BUTTONS.map((b) => `${b.emoji} ${b.label}`).join(' · '),
    '',
    `_${ROLE.regular} vergibt der Bot nach Aktivität, ${ROLE.plexUser} ein Admin._`,
  ]), buildRoleButtons());
}

/** The single role-button set (welcome channel card and join message). */
export function buildRoleButtons(): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < PING_ROLE_BUTTONS.length; i += 3) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const def of PING_ROLE_BUTTONS.slice(i, i + 3)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`role:toggle:${def.role}`)
          .setLabel(def.label)
          .setEmoji(def.emoji)
          .setStyle(ButtonStyle.Secondary),
      );
    }
    rows.push(row);
  }
  return rows;
}

export function buildCommandsCard(ctx: CardContext): CardPayload {
  const plex = commandLines(ctx, [
    ['search movie', 'Film suchen'],
    ['search show', 'Serie suchen'],
    ['queue', 'laufende Downloads'],
    ['calendar', 'kommende Releases'],
    ['plex-now-playing', 'wer gerade schaut'],
    ['plex-top', 'meistgesehen'],
    ['neu', 'neu auf Plex'],
  ]);
  const community = commandLines(ctx, [
    ['rank', 'dein Level'],
    ['leaderboard', 'Top 10'],
    ['suggest', 'Vorschlag einreichen'],
    ['movie-night nominate', 'Film für den Filmabend'],
    ['remindme', 'Erinnerung per DM'],
    ['erinnerung an', 'Raid-/M+-Erinnerung (wöchentlich)'],
    ['faq', 'FAQ durchsuchen'],
    ['tag get', 'Tag-Antwort abrufen'],
    ['wrapped', 'dein Jahresrückblick'],
  ]);
  return only(card('⌨️ Befehle', [
    `Tipp \`/\` für alle Befehle. Bitte in ${mention(ctx, 'botCommands', CHANNEL.botCommands)} nutzen.`,
    '',
    section('🎬 Plex', plex),
    '',
    section('💬 Community', community),
    '',
    hasCommand(ctx, 'help') ? '`/help` zeigt die komplette Liste.' : null,
  ]));
}

export function buildAnnouncementsCard(_ctx: CardContext): CardPayload {
  return only(card('📢 Ankündigungen', [
    'Server-News und Wartungsfenster. Nur lesen.',
    '_Pings bekommst du mit der Rolle 📢 Ankündigungen._',
  ]));
}

export function buildUpdatesCard(ctx: CardContext): CardPayload {
  return only(card('📰 MagguuUI-Updates', [
    'Neue MagguuUI-Releases mit Version, Changelog und Download, automatisch vom Bot. Nur lesen.',
    '',
    '**Updaten**',
    '• Am einfachsten über CurseForge oder Wago (WowUp zieht mit).',
    '• Manuell: die **vier** Ordner `MagguuUI`, `MagguuUI_Data`, `MagguuUI_EUI`, `MagguuUI_Media` in `Interface/AddOns` ersetzen, alle aktiviert lassen.',
    '• Danach `/reload`. In `/mui` → Setup: **Magguu-Profile übernehmen**, **Magguu Settings** (nur Overlay/QoL) oder **Profile laden** (aktiviert nur, kein Neuimport).',
    '',
    `WoW- und Blizzard-News stehen in ${mention(ctx, 'blizzard', CHANNEL.blizzard)}.`,
    '_Stabile Releases pingen 🎨 MagguuUI, Pre-Releases nicht._',
  ]));
}

export function buildBlizzardCard(ctx: CardContext): CardPayload {
  return only(card('🟦 Blizzard-Updates', [
    'Blue-Posts, Hotfixes und PTR-News zu WoW, automatisch vom Bot. Nur lesen.',
    `MagguuUI-Releases stehen in ${mention(ctx, 'addonUpdates', CHANNEL.updates)}.`,
    '_Pings mit der Rolle 🎮 WoW._',
  ]));
}

export function buildHelpCard(ctx: CardContext): CardPayload {
  return only(card('❓ Hilfe zu MagguuUI', [
    'Frag hier alles zu MagguuUI. Je genauer, desto schneller die Antwort:',
    'WoW-Version, UI-Scale, was du gemacht hast, Screenshot oder Fehlermeldung.',
    '',
    ...commandLines(ctx, [['tag list', 'alle FAQ-Einträge'], ['tag get', 'einen Eintrag anzeigen']]),
    '',
    `Bugs: [GitHub-Issue](https://github.com/Derpsen/MagguuUI/issues) · Ideen: ${mention(ctx, 'suggestions', CHANNEL.suggestions)}`,
  ]));
}

/**
 * Install guide + FAQ (second card in ❓・hilfe). The addon facts mirror the MagguuUI repo and
 * are pinned by tests; `/mui` etc. are in-game WoW commands, not Discord ones.
 */
export function buildFaqCard(ctx: CardContext): CardPayload {
  const tagLines = commandLines(ctx, [['tag list', 'alle FAQ-Einträge'], ['tag get', 'einen Eintrag abrufen']]);
  const embed = card('📦 MagguuUI: Installation & FAQ', [
    'MagguuUI sitzt in **EllesmereUI** (Ready for WoW **12.1**, läuft weiter auf Midnight **12.0**). Öffnen mit `/mui`. Sidebar: **Optionen** (Setup / Skinning / QoL) und **Changelog**. Werkzeuge bleiben versteckt (`/mui tools` oder Header **10×**). UI in **11 Client-Sprachen**.',
    '',
    '**Installation**',
    '1. **EllesmereUI** 9.0.6+ installieren und aktivieren (CurseForge / Wago / WowUp)',
    `2. Neueste MagguuUI-ZIP aus ${mention(ctx, 'addonUpdates', CHANNEL.updates)} laden und entpacken`,
    '3. Die **vier** Ordner nach `World of Warcraft/_retail_/Interface/AddOns/`: `MagguuUI`, `MagguuUI_Data` ([Data]), `MagguuUI_EUI` ([EUI]), `MagguuUI_Media` ([Media]), alle vier aktiviert lassen',
    '4. Einloggen: Ellesmere-Startpopup wird übersprungen, das Magguu-Setup öffnet sich',
    '5. `/mui` → **Setup**: **Magguu-Profile übernehmen** (Profile + Magguu Settings + Begleiter; Edit Mode **MagguuUI** einmal; Window & Tooltip Skins Precheck), dann **Magguu Settings** (nur Overlay/QoL) oder **Profile laden** (nur aktivieren, außer Klassenlayouts; kein Neuimport). Scale `0.58` kommt mit. Auf einem Alt erscheint ein Popup zum Laden der Profile',
    '',
    '**Updaten**',
    '• Im Addon-Manager **Aktualisieren** reicht',
    '• Manuell die vier Ordner aus der ZIP ersetzen, `MagguuUI_Data` nicht löschen, danach `/reload`',
    '',
    '**Bug melden:** [GitHub-Issue](https://github.com/Derpsen/MagguuUI/issues) oder hier posten mit WoW-Version, UI-Scale und Repro-Schritten',
  ]);
  embed.addFields(
    {
      name: '📦 WowUp-Packs',
      value: [
        'Im Setup kopieren und in WowUp einfügen.',
        '**Starter:** EllesmereUI, MagguuUI, BigWigs, LittleWigs, Northern Sky, EXBoss, EXCore',
        '**Optional:** BugGrabber, BugSack, HandyNotes, HandyNotes MapNotes, MDT, Raider.IO, Simulationcraft, Talent Tree Tweaks, Whisper Messenger, Waypoint UI, GTFO, Premade Groups Filter, Auctionator, Smart Reminders',
      ].join('\n'),
    },
    {
      name: '❓ Häufige Fragen',
      value: [
        '`UI-Skalierung?` → `0.58` über Magguu-Profile übernehmen / Magguu Settings',
        '`Tooltip?` → fester Platz, folgt nicht der Maus',
        '`Setup?` → Magguu-Profile übernehmen = Profile+Settings+Begleiter (Waypoint/HandyNotes/TTT/GTFO/BugSack/PGF). Magguu Settings = Overlay/QoL. Profile laden nur aktivieren (kein Neuimport). Setup-Buttons BigWigs/NSRT/EXBoss/Smart Reminders/Whisper Messenger. WowUp PGF+Auctionator+Smart Reminders+MapNotes',
        '`Skinning?` → NAMEN & FARBEN DualRow (Unit | Party/Raid) + klassenfarbige Keybinds',
        '`QoL?` → Death-Release, Co-Tank, Stealth/Stance, Spell-Alerts, Itemlevel Party/Raid (2P/4P), Smart Tab, Quick Focus, Ellesmere-Lautsprecher, Boiling Point; AuraBuff-Count CENTER. Targeted Spell Bars ON; EXBoss MythicCast OFF. Kein TopBar/Hearth/Magguu-FPS',
        '`Pre-Releases?` → werden gepostet, aber nicht gepingt',
      ].join('\n'),
    },
    ...(tagLines.length ? [{ name: '📝 Weitere FAQ', value: tagLines.join('\n') }] : []),
  );
  return only(embed);
}

export function buildSuggestionsCard(ctx: CardContext): CardPayload {
  return only(card('💡 Vorschläge', [
    hasCommand(ctx, 'suggest')
      ? 'Idee für MagguuUI oder den Server? Mit `/suggest` einreichen, dann wird abgestimmt.'
      : 'Idee für MagguuUI oder den Server? Hier rein, dann wird abgestimmt.',
    'Den Status setzt ein Admin.',
  ]));
}

export function buildChatCard(ctx: CardContext): CardPayload {
  return only(card('💬 Chat', [
    'Allgemeiner Chat. Spoiler bitte in Threads.',
    `Bot-Befehle in ${mention(ctx, 'botCommands', CHANNEL.botCommands)}.`,
  ]));
}

export function buildBotCommandsCard(ctx: CardContext): CardPayload {
  return only(card('⌨️ Bot-Befehle', [
    'Hier dürfen Bot-Befehle laufen, damit die anderen Kanäle ruhig bleiben.',
    `Übersicht: ${mention(ctx, 'botHelp', CHANNEL.welcome)}${hasCommand(ctx, 'help') ? ' oder `/help`' : ''}.`,
  ]));
}

export function buildMovieNightCard(ctx: CardContext): CardPayload {
  return only(card('🎬 Filmabend', [
    'Filmabend planen, Filme nominieren, abstimmen.',
    ...commandLines(ctx, [['movie-night nominate', 'Film vorschlagen'], ['movie-night create', 'Filmabend anlegen']]),
    'Dazu landen hier die ⭐-Highlights.',
  ]));
}

export function buildRequestsCard(ctx: CardContext): CardPayload {
  return only(card('📝 Anfragen', [
    'Film oder Serie gewünscht? Am einfachsten über Seerr.',
    'Ohne Seerr: hier `Titel · Jahr · Film/Serie` schreiben.',
    '',
    ...commandLines(ctx, [['search movie', 'schauen, ob ein Film schon da ist'], ['search show', 'dasselbe für Serien']]),
    '',
    `Status-Updates kommen hier. Fertig auf Plex: ${mention(ctx, 'newOnPlex', CHANNEL.newOnPlex)}.`,
  ]));
}

export function buildNewOnPlexCard(_ctx: CardContext): CardPayload {
  return only(card('✨ Neu auf Plex', [
    'Neue Filme und Folgen, sobald sie auf Plex sind. Dazu der Wochenrückblick.',
    '_Pings mit 🎬 Filme, 📺 Serien oder ✨ 4K & Anime._',
  ]));
}

export function buildPlexActivityCard(ctx: CardContext): CardPayload {
  return only(card('🎬 Plex-Aktivität', [
    'Wer gerade was auf Plex schaut. Eine Karte pro Stream, sie wird live aktualisiert.',
    ...commandLines(ctx, [['plex-now-playing', 'alle Streams auf einen Blick']]),
  ]));
}

export const TICKET_SELECT_CUSTOM_ID = 'ticket-category:open';
export const TICKET_PANEL_TITLE = '🎫 Support-Tickets';

/** Category select of the ticket panel (custom id handled in client.ts). */
export function buildTicketSelect(
  categories: NonNullable<CardContext['ticketCategories']>,
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const usable = categories.filter((c) => c.key.length > 0 && c.key.length <= 80).slice(0, 25);
  if (usable.length === 0) return null;
  const select = new StringSelectMenuBuilder()
    .setCustomId(TICKET_SELECT_CUSTOM_ID)
    .setPlaceholder('🎫 Kategorie wählen, Ticket öffnen')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      ...usable.map((c) => {
        const opt = new StringSelectMenuOptionBuilder().setLabel(c.label.slice(0, 100)).setValue(c.key).setEmoji(c.emoji);
        if (c.description) opt.setDescription(c.description.slice(0, 100));
        return opt;
      }),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

/** Ticket panel, pinned in ❓・hilfe. Ticket channels are created on demand (private). */
export function buildTicketPanelCard(ctx: CardContext): CardPayload {
  const categories = ctx.ticketCategories ?? [];
  const row = buildTicketSelect(categories);
  return only(
    card(TICKET_PANEL_TITLE, [
      'Brauchst du das Team? Kategorie wählen, dann öffnet sich ein privater Kanal nur für dich und uns.',
      categories.length > 0 ? '' : null,
      ...categories.slice(0, 25).map((c) => `${c.emoji} **${c.label}**${c.description ? `: ${c.description}` : ''}`),
      '',
      '_Eine offene Anfrage pro Person. Ohne Aktivität schließt das Ticket nach 48 h._',
    ]),
    row ? [row] : [],
  );
}

export function buildApprovalsCard(_ctx: CardContext): CardPayload {
  return only(card('⏳ Freigaben', [
    'Neue Seerr-Anfragen mit Annehmen und Ablehnen. Nur Admins.',
    '_Jede Entscheidung wird geloggt._',
  ]));
}

export function buildStatusCard(ctx: CardContext): CardPayload {
  return only(card('🩺 Status', [
    'Fehler und Health von Sonarr, Radarr, SABnzbd, Prowlarr und Seerr, dazu GitHub. Nur Admins.',
    '',
    ...commandLines(ctx, [
      ['doctor', 'Config, Kanäle, Rechte und Karten prüfen'],
      ['status', 'Dienste und Webhooks'],
      ['arr-status', 'Sonarr/Radarr im Detail'],
    ]),
  ]));
}

export function buildLogsCard(_ctx: CardContext): CardPayload {
  return only(card('📋 Logs', [
    'Mod-, Audit- und Ticket-Logs, dazu der tägliche Selbsttest (nur bei Fehlern). Nur Admins, automatisch.',
  ]));
}

/** Second card in the welcome channel (commands). Plan name kept for DB continuity. */
export const WELCOME_COMMANDS_PLAN_NAME = `${CHANNEL.welcome}#hilfe`;
export const WELCOME_RULES_PLAN_NAME = `${CHANNEL.welcome}#regeln`;
export const WELCOME_ROLES_PLAN_NAME = `${CHANNEL.welcome}#rollen`;
export const HELP_FAQ_PLAN_NAME = `${CHANNEL.help}#faq`;
export const HELP_TICKETS_PLAN_NAME = `${CHANNEL.help}#tickets`;

/**
 * Every bot card, in posting order per channel. All cards are pinned: they
 * are the "what is this channel" info and must stay findable above feeds and
 * chat. No sticky (re-posted) cards: re-posting spams read-only feeds and the
 * pin list is the place Discord shows on top. 🔊 Voice has no card.
 */
export const CARDS: readonly CardSpec[] = [
  { planName: CHANNEL.welcome, channel: CHANNEL.welcome, pin: true, build: buildWelcomeCard },
  { planName: WELCOME_RULES_PLAN_NAME, channel: CHANNEL.welcome, pin: true, build: buildRulesCard },
  { planName: WELCOME_ROLES_PLAN_NAME, channel: CHANNEL.welcome, pin: true, build: buildRolesCard },
  { planName: WELCOME_COMMANDS_PLAN_NAME, channel: CHANNEL.welcome, pin: true, build: buildCommandsCard },
  { planName: CHANNEL.announcements, channel: CHANNEL.announcements, pin: true, build: buildAnnouncementsCard },
  { planName: CHANNEL.updates, channel: CHANNEL.updates, pin: true, build: buildUpdatesCard },
  { planName: CHANNEL.blizzard, channel: CHANNEL.blizzard, pin: true, build: buildBlizzardCard },
  { planName: CHANNEL.help, channel: CHANNEL.help, pin: true, build: buildHelpCard },
  { planName: HELP_FAQ_PLAN_NAME, channel: CHANNEL.help, pin: true, build: buildFaqCard },
  { planName: HELP_TICKETS_PLAN_NAME, channel: CHANNEL.help, pin: true, build: buildTicketPanelCard },
  { planName: CHANNEL.suggestions, channel: CHANNEL.suggestions, pin: true, build: buildSuggestionsCard },
  { planName: CHANNEL.chat, channel: CHANNEL.chat, pin: true, build: buildChatCard },
  { planName: CHANNEL.botCommands, channel: CHANNEL.botCommands, pin: true, build: buildBotCommandsCard },
  { planName: CHANNEL.movieNight, channel: CHANNEL.movieNight, pin: true, build: buildMovieNightCard },
  { planName: CHANNEL.requests, channel: CHANNEL.requests, pin: true, build: buildRequestsCard },
  { planName: CHANNEL.newOnPlex, channel: CHANNEL.newOnPlex, pin: true, build: buildNewOnPlexCard },
  { planName: CHANNEL.plexActivity, channel: CHANNEL.plexActivity, pin: true, build: buildPlexActivityCard },
  { planName: CHANNEL.approvals, channel: CHANNEL.approvals, pin: true, build: buildApprovalsCard },
  { planName: CHANNEL.status, channel: CHANNEL.status, pin: true, build: buildStatusCard },
  { planName: CHANNEL.logs, channel: CHANNEL.logs, pin: true, build: buildLogsCard },
];

export const CARD_PLAN_NAMES: ReadonlySet<string> = new Set(CARDS.map((c) => c.planName));

/** Plan names of earlier card generations; their messages are deleted on rollout. */
/** 📡・downloads has no info card any more: its only pinned post is the live queue panel. */
export const RETIRED_CARD_PLAN_NAMES: readonly string[] = ['🎭・rollen-colors', CHANNEL.downloads];

export interface RenderedCard {
  spec: CardSpec;
  body: { embeds: unknown[]; components: unknown[] };
  hash: string;
}

/** Render to REST JSON + a content hash (idempotent re-runs skip unchanged cards). */
export function renderCard(spec: CardSpec, ctx: CardContext): RenderedCard {
  const payload = spec.build(ctx);
  const body = { embeds: payload.embeds.map((e) => e.toJSON()), components: payload.components.map((c) => c.toJSON()) };
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  return { spec, body, hash };
}
