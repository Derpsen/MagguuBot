import {
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type CategoryChannel,
  type EmbedBuilder,
  type Guild,
  type GuildBasedChannel,
  type TextChannel,
} from 'discord.js';
import {
  buildAddonUpdatesChannelEmbed,
  buildAnnouncementsEmbed,
  buildApprovalsChannelEmbed,
  buildAuditLogChannelEmbed,
  buildBlueTrackerChannelEmbed,
  buildBotCommandsChannelEmbed,
  buildBotHelpEmbed,
  buildFaqChannelEmbed,
  buildFailuresChannelEmbed,
  buildGeneralChatEmbed,
  buildGithubChannelEmbed,
  buildGrabsChannelEmbed,
  buildHealthChannelEmbed,
  buildImportsChannelEmbed,
  buildModLogChannelEmbed,
  buildNewOnPlexChannelEmbed,
  buildRequestsChannelEmbed,
  buildRolePickerButtons,
  buildRolePickerEmbed,
  buildRulesEmbed,
  buildMaintainerrChannelEmbed,
  buildPlexActivityChannelEmbed,
  buildSpoilerChannelEmbed,
  buildStarboardChannelEmbed,
  buildSuggestionsChannelEmbed,
  buildWelcomeHeroEmbed,
  buildWeeklyDigestChannelEmbed,
  buildDownloadLiveChannelEmbed,
  buildMovieNightChannelEmbed,
  type ChannelRefs,
} from '../../embeds/welcome.js';
import { and, eq } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { welcomeMessages } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import { getChannel, saveChannel, type ChannelKey } from '../channel-store.js';
import { getClient } from '../client.js';
import {
  REF_AWARE_WELCOME_NAMES,
  ROLE_PICKER_PLAN_NAME,
  planWelcomeEmbedSync,
  type SetupWelcomeChannel,
} from '../../utils/setup-plan.js';
import type { SlashCommand } from './index.js';

type ChannelKind = 'text' | 'voice';

interface ChannelPlan {
  name: string;
  oldNames?: string[];
  topic?: string;
  kind?: ChannelKind;
  readOnly?: boolean;
  adminOnly?: boolean;
  allowedRoles?: string[];
}

interface CategoryPlan {
  name: string;
  oldNames?: string[];
  channels: ChannelPlan[];
}

const PLEX_ACCESS = ['Plex-User', 'Plex-Fan'] as const;
const WOW_ACCESS = ['WoW-Fan'] as const;
const ADDON_ACCESS = ['MagguuUI'] as const;
const TRUSTED_ROLES = ['Regular', 'VIP', 'Plex-User'] as const;

interface RolePlan {
  name: string;
  color: number;
  mentionable?: boolean;
  hoist?: boolean;
  oldNames?: string[];
}

const RETIRED_ROLE_NAMES = [
  'color-red',
  'color-orange',
  'color-amber',
  'color-green',
  'color-teal',
  'color-blue',
  'color-indigo',
  'color-purple',
  'color-pink',
  'color-slate',
];

const RETIRED_WELCOME_PLAN_NAMES = ['🎭・rollen-colors'];

const ROLES: RolePlan[] = [
  { name: 'Admin', color: 0xef4444, hoist: true },
  { name: 'Moderator', color: 0x3b82f6, hoist: true },
  { name: 'VIP', color: 0xe879f9, hoist: true },
  { name: 'Plex-User', color: 0xe5a00d, hoist: true },
  { name: 'Regular', color: 0x22c55e, hoist: true },
  { name: 'Newcomer', color: 0x94a3b8, hoist: true },
  { name: 'ping-movies', color: 0xffc230, mentionable: true },
  { name: 'ping-series', color: 0x35c5f4, mentionable: true },
  { name: 'ping-4k', color: 0x22c55e, mentionable: true },
  { name: 'ping-anime', color: 0xec4899, mentionable: true },
  { name: 'ping-wow-tuning', color: 0x148ae3, mentionable: true },
  { name: 'ping-wow-ptr', color: 0x8b5cf6, mentionable: true },
  { name: 'ping-announcements', color: 0xf59e0b, mentionable: true },
  { name: 'ping-github', color: 0x64748b, mentionable: true },
  { name: 'Plex-Fan', color: 0xe5a00d, mentionable: false, oldNames: ['Plex-Fan'] },
  { name: 'WoW-Fan', color: 0x148ae3, mentionable: false, oldNames: ['WoW-Fan'] },
  { name: 'MagguuUI', color: 0x7c3aed, mentionable: false, oldNames: ['MagguuUI'] },
];

const STRUCTURE: CategoryPlan[] = [
  {
    name: '📊 STATISTIK',
    channels: [
      { name: '👥 Mitglieder: 0', kind: 'voice' },
      { name: '📈 Boosts: 0', kind: 'voice' },
      { name: '🎙 In Voice: 0', kind: 'voice' },
      { name: '🤖 Bot-Uptime: 0h', kind: 'voice' },
      { name: '🎬 Plex: 0', kind: 'voice' },
    ],
  },
  {
    name: '🏠 INFO',
    channels: [
      { name: '👋・willkommen', oldNames: ['willkommen'], topic: 'Start hier — Regeln + Quick-Start.', readOnly: true },
      { name: '📜・regeln', oldNames: ['regeln'], topic: 'Server-Regeln.', readOnly: true },
      { name: '📢・ankündigungen', oldNames: ['ankündigungen'], topic: 'Server-Updates.', readOnly: true },
      { name: '🤖・bot-hilfe', oldNames: ['bot-hilfe'], topic: 'Alle Slash-Commands.', readOnly: true },
      { name: '🎭・rollen', oldNames: ['rollen'], topic: 'Benachrichtigungs-Rollen per Button.', readOnly: true },
      { name: '💡・vorschläge', topic: 'Community-Vorschläge mit Vote-Buttons. Einreichen via /suggest.' },
    ],
  },
  {
    name: '🎮 WOW',
    channels: [
      {
        name: '📰・blue-tracker',
        topic: 'Blizzard Blue-Posts — Retail + PTR (kein Classic). Class Tunings, Hotfixes, Balance.',
        readOnly: true,
        allowedRoles: [...WOW_ACCESS],
      },
    ],
  },
  {
    name: '🎨 MAGGUU UI',
    channels: [
      {
        name: '🎨・addon-updates',
        topic: 'MagguuUI-Addon Releases — automatisch aus GitHub.',
        readOnly: true,
        allowedRoles: [...ADDON_ACCESS],
      },
      {
        name: '❓・faq',
        topic: 'Häufige Fragen — Tag-basiert. `/tag list` zeigt alle.',
        readOnly: true,
        allowedRoles: [...ADDON_ACCESS],
      },
    ],
  },
  {
    name: '🎬 MEDIA',
    channels: [
      {
        name: '📝・anfragen',
        oldNames: ['requests'],
        topic: 'Film / Serie requesten.',
        allowedRoles: [...PLEX_ACCESS],
      },
      {
        name: '📊・wochenrückblick',
        topic: 'Automatischer Wochenrückblick: neue Inhalte, Requests und Community-Highlights.',
        readOnly: true,
        allowedRoles: [...PLEX_ACCESS],
      },
      { name: '⏳・freigaben', oldNames: ['approvals'], topic: 'Admin-only Approvals.', readOnly: true, adminOnly: true },
      {
        name: '✨・neu-auf-plex',
        oldNames: ['new-on-plex'],
        topic: 'Recently added (Tautulli).',
        readOnly: true,
        allowedRoles: [...PLEX_ACCESS],
      },
      {
        name: '🎬・aktivität',
        oldNames: ['plex-activity'],
        topic: 'Wer schaut gerade was (Tautulli playback).',
        readOnly: true,
        allowedRoles: [...PLEX_ACCESS],
      },
      {
        name: '🗑️・gelöscht',
        oldNames: ['maintainerr'],
        topic: 'Maintainerr + Sonarr/Radarr — was aus Plex entfernt wurde.',
        readOnly: true,
        allowedRoles: [...PLEX_ACCESS],
      },
    ],
  },
  {
    name: '📥 DOWNLOADS',
    channels: [
      {
        name: '📥・grabs',
        oldNames: ['grabs'],
        topic: 'Sonarr / Radarr / SAB grabs.',
        readOnly: true,
        allowedRoles: [...PLEX_ACCESS],
      },
      {
        name: '✅・imports',
        oldNames: ['imports'],
        topic: 'Erfolgreich importierte Files.',
        readOnly: true,
        allowedRoles: [...PLEX_ACCESS],
      },
      {
        name: '📡・live-downloads',
        topic: 'Eine automatisch aktualisierte Live-Karte für Sonarr, Radarr und SABnzbd.',
        readOnly: true,
        allowedRoles: [...PLEX_ACCESS],
      },
      { name: '⚠️・fehler', oldNames: ['failures'], topic: 'Failures + manual intervention.', readOnly: true, adminOnly: true },
    ],
  },
  {
    name: '🔧 STATUS',
    channels: [{ name: '🩺・health', oldNames: ['health'], topic: 'Sonarr/Radarr/Prowlarr Health + Updates.', readOnly: true, adminOnly: true }],
  },
  {
    name: '💬 CHAT',
    channels: [
      { name: '💬・chat', oldNames: ['general'], topic: 'Labern + Smalltalk.' },
      {
        name: '⌨️・bot-befehle',
        oldNames: ['bot-commands'],
        topic: 'Für /queue, /search etc. — Regular+.',
        allowedRoles: [...TRUSTED_ROLES],
      },
      {
        name: '🔇・spoiler-zone',
        oldNames: ['spoiler-zone'],
        topic: 'Spoiler erlaubt — Regular+.',
        allowedRoles: [...TRUSTED_ROLES],
      },
      {
        name: '🎬・movie-night',
        topic: 'Filmabend planen, nominieren und gemeinsam abstimmen.',
        allowedRoles: [...TRUSTED_ROLES],
      },
    ],
  },
  {
    name: '🎧 VOICE',
    channels: [
      { name: '🔊 General', kind: 'voice' },
      { name: '🎬 Movie Night', kind: 'voice' },
      { name: '💤 AFK', kind: 'voice' },
    ],
  },
  {
    name: '🛡️ MOD',
    channels: [
      { name: '🛡️・mod-log', oldNames: ['mod-log'], topic: 'Alle Mod-Actions.', readOnly: true, adminOnly: true },
      { name: '📋・audit-log', oldNames: ['audit-log'], topic: 'Joins/Leaves/Role-Changes.', readOnly: true, adminOnly: true },
    ],
  },
  {
    name: '🔨 DEV',
    channels: [
      {
        name: '🔨・github',
        oldNames: ['github'],
        topic: 'GitHub-Webhook-Feed — Regular+.',
        readOnly: true,
        allowedRoles: [...TRUSTED_ROLES],
      },
    ],
  },
  {
    name: '🎫 TICKETS',
    channels: [
      {
        name: 'ticket-logs',
        topic: 'Geschlossene Tickets inkl. Transkripte (Admin/Mod).',
        readOnly: true,
        adminOnly: true,
      },
    ],
  },
  {
    name: '⭐ HIGHLIGHTS',
    channels: [
      {
        name: '⭐・starboard',
        oldNames: ['starboard'],
        topic: 'Nachrichten mit 3+ ⭐ landen hier — Regular+.',
        readOnly: true,
        allowedRoles: [...TRUSTED_ROLES],
      },
    ],
  },
];

export const KNOWN_CATEGORIES: ReadonlySet<string> = new Set(STRUCTURE.map((c) => c.name));

const EXPLICIT_CHANNEL_NAMES: ReadonlySet<string> = new Set(
  STRUCTURE.flatMap((c) => [
    ...c.channels.map((ch) => ch.name),
    ...c.channels.flatMap((ch) => ch.oldNames ?? []),
  ]),
);

const STATS_CHANNEL_PREFIXES = ['👥 Mitglieder: ', '📈 Boosts: ', '🎙 In Voice: ', '🤖 Bot-Uptime: ', '🎬 Plex: '];

export function isKnownChannelName(name: string): boolean {
  if (EXPLICIT_CHANNEL_NAMES.has(name)) return true;
  return STATS_CHANNEL_PREFIXES.some((p) => name.startsWith(p));
}

const NAME_TO_REF_KEY: Record<string, keyof ChannelRefs> = {
  '👋・willkommen': 'welcome',
  '📜・regeln': 'rules',
  '🎭・rollen': 'roles',
  '🤖・bot-hilfe': 'botHelp',
  '📢・ankündigungen': 'announcements',
  '📝・anfragen': 'requests',
  '⏳・freigaben': 'approvals',
  '✨・neu-auf-plex': 'newOnPlex',
  '🎬・aktivität': 'plexActivity',
  '🗑️・gelöscht': 'maintainerr',
  '📥・grabs': 'grabs',
  '✅・imports': 'imports',
  '⚠️・fehler': 'failures',
  '🩺・health': 'health',
  '💬・chat': 'general',
  '⌨️・bot-befehle': 'botCommands',
  '🛡️・mod-log': 'modLog',
  '📋・audit-log': 'auditLog',
  '🔨・github': 'github',
  '⭐・starboard': 'starboard',
  '📰・blue-tracker': 'blueTracker',
  '🎨・addon-updates': 'addonUpdates',
  '❓・faq': 'faq',
  '💡・vorschläge': 'suggestions',
  '📊・wochenrückblick': 'weeklyDigest',
  '📡・live-downloads': 'downloadLive',
  '🎬・movie-night': 'movieNight',
  'ticket-logs': 'ticketLogs',
};

const PERSISTENT_KEYS: ReadonlySet<string> = new Set<ChannelKey>([
  'grabs',
  'imports',
  'failures',
  'requests',
  'approvals',
  'newOnPlex',
  'plexActivity',
  'maintainerr',
  'health',
  'welcome',
  'auditLog',
  'modLog',
  'github',
  'starboard',
  'blueTracker',
  'addonUpdates',
  'faq',
  'suggestions',
  'weeklyDigest',
  'downloadLive',
  'movieNight',
  'ticketLogs',
]);

const WELCOME_BUILDERS: Record<string, (r: ChannelRefs) => EmbedBuilder> = {
  '👋・willkommen': buildWelcomeHeroEmbed,
  '📜・regeln': () => buildRulesEmbed(),
  '📢・ankündigungen': () => buildAnnouncementsEmbed(),
  '🤖・bot-hilfe': buildBotHelpEmbed,
  '🎭・rollen': () => buildRolePickerEmbed(),
  '📝・anfragen': buildRequestsChannelEmbed,
  '⏳・freigaben': () => buildApprovalsChannelEmbed(),
  '✨・neu-auf-plex': () => buildNewOnPlexChannelEmbed(),
  '🎬・aktivität': () => buildPlexActivityChannelEmbed(),
  '🗑️・gelöscht': () => buildMaintainerrChannelEmbed(),
  '📥・grabs': buildGrabsChannelEmbed,
  '✅・imports': () => buildImportsChannelEmbed(),
  '⚠️・fehler': () => buildFailuresChannelEmbed(),
  '🩺・health': () => buildHealthChannelEmbed(),
  '💬・chat': () => buildGeneralChatEmbed(),
  '⌨️・bot-befehle': () => buildBotCommandsChannelEmbed(),
  '🔇・spoiler-zone': () => buildSpoilerChannelEmbed(),
  '🛡️・mod-log': () => buildModLogChannelEmbed(),
  '📋・audit-log': () => buildAuditLogChannelEmbed(),
  '🔨・github': () => buildGithubChannelEmbed(),
  '⭐・starboard': () => buildStarboardChannelEmbed(),
  '📰・blue-tracker': () => buildBlueTrackerChannelEmbed(),
  '🎨・addon-updates': () => buildAddonUpdatesChannelEmbed(),
  '❓・faq': buildFaqChannelEmbed,
  '💡・vorschläge': () => buildSuggestionsChannelEmbed(),
  '📊・wochenrückblick': () => buildWeeklyDigestChannelEmbed(),
  '📡・live-downloads': () => buildDownloadLiveChannelEmbed(),
  '🎬・movie-night': () => buildMovieNightChannelEmbed(),
};

export const setupServerCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('setup-server')
    .setDescription('Kategorien, Kanäle und Rollen anlegen, umbenennen und sortieren')
    .addBooleanOption((option) => option
      .setName('dry-run')
      .setDescription('Vorschau mit Bestätigungsbutton anzeigen (Standard: ja)'))
    .addBooleanOption((option) => option
      .setName('full')
      .setDescription('Alles neu abgleichen, inklusive Berechtigungen und Embeds (langsamer)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild) {
      await interaction.editReply('Dieser Befehl ist nur auf einem Server verfügbar.');
      return;
    }

    const fullSync = interaction.options.getBoolean('full') ?? false;
    if (interaction.options.getBoolean('dry-run') ?? true) {
      await interaction.editReply({
        content: buildSetupDryRun(interaction.guild, fullSync),
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`setup-server:confirm:${interaction.user.id}:${fullSync ? 'full' : 'fast'}`)
            .setLabel('Änderungen anwenden')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`setup-server:cancel:${interaction.user.id}:${fullSync ? 'full' : 'fast'}`)
            .setLabel('Abbrechen')
            .setStyle(ButtonStyle.Secondary),
        )],
      });
      return;
    }

    await applySetupServer(interaction, fullSync);
  },
};

type SetupInteraction = ChatInputCommandInteraction | ButtonInteraction;

async function applySetupServer(interaction: SetupInteraction, fullSync = false): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply('Dieser Befehl ist nur auf einem Server verfügbar.');
      return;
    }
    const permCheck = await assertBotPermissions(guild);
    if (!permCheck.ok) {
      await interaction.editReply(
        [
          '⚠️ **Dem Bot fehlen Berechtigungen** — `/setup-server` würde teilweise stillschweigend scheitern.',
          '',
          `Fehlend: \`${permCheck.missing.join('`, `')}\``,
          '',
          '**Lösung:** Servereinstellungen → Rollen → **MagguuBot** → **Administrator** aktivieren (einfachste Lösung), oder die fehlenden Berechtigungen einzeln setzen. Danach `/setup-server` erneut ausführen.',
          '',
          '_Ohne diese kann der Bot unter anderem keine Kanalrechte setzen oder Willkommensnachrichten anheften — daher die Fehler wegen fehlender Berechtigungen im Log._',
        ].join('\n'),
      );
      return;
    }

    const created: string[] = [];
    const skipped: string[] = [];
    const renamed: string[] = [];
    const removed: string[] = [];
    let rolesChanged = false;
    const changedRoleNames = new Set<string>();

    // ─── Idempotent cleanup of retired surfaces ────────────────────────
    for (const retiredName of RETIRED_ROLE_NAMES) {
      const role = guild.roles.cache.find((x) => x.name === retiredName);
      if (!role) continue;
      try {
        await role.delete('retired role removed by setup-server');
        removed.push(`role: ${retiredName}`);
        rolesChanged = true;
      } catch (err) {
        logger.warn({ err, role: retiredName }, 'retired role deletion failed (likely above bot)');
      }
    }
    for (const planName of RETIRED_WELCOME_PLAN_NAMES) {
      const row = db
        .select()
        .from(welcomeMessages)
        .where(and(eq(welcomeMessages.guildId, config.DISCORD_GUILD_ID), eq(welcomeMessages.planName, planName)))
        .get();
      if (!row) continue;
      try {
        const channel = await guild.channels.fetch(row.channelId).catch(() => null);
        if (channel && 'messages' in channel) {
          const msg = await channel.messages.fetch(row.messageId).catch(() => null);
          await msg?.delete().catch(() => {});
        }
      } catch (err) {
        logger.debug({ err, planName }, 'retired welcome embed delete failed');
      }
      db.delete(welcomeMessages)
        .where(and(eq(welcomeMessages.guildId, config.DISCORD_GUILD_ID), eq(welcomeMessages.planName, planName)))
        .run();
      removed.push(`welcome embed: ${planName}`);
    }

    for (const r of ROLES) {
      const existing = guild.roles.cache.find((x) => x.name === r.name);
      if (existing) {
        skipped.push(`role: ${r.name}`);
        continue;
      }
      const oldRole = r.oldNames
        ?.map((n) => guild.roles.cache.find((x) => x.name === n))
        .find((x): x is NonNullable<typeof x> => Boolean(x));
      if (oldRole) {
        try {
          await oldRole.setName(r.name, 'setup-server role rename');
          renamed.push(`role: ${oldRole.name === r.name ? oldRole.name : `${oldRole.name} → ${r.name}`}`);
          rolesChanged = true;
          changedRoleNames.add(r.name);
          continue;
        } catch (err) {
          logger.warn({ err, old: oldRole.name, target: r.name }, 'role rename failed, creating new');
        }
      }
      await guild.roles.create({
        name: r.name,
        color: r.color,
        mentionable: r.mentionable ?? false,
        hoist: r.hoist ?? false,
      });
      created.push(`role: ${r.name}`);
      rolesChanged = true;
      changedRoleNames.add(r.name);
    }

    const freshTextChannels: Array<{ plan: ChannelPlan; channel: TextChannel; changed: boolean }> = [];
    const refs: ChannelRefs = {};
    let structureChanged = false;
    let refsChanged = false;

    const setupBotId = interaction.client.user?.id;

    for (const cat of STRUCTURE) {
      const category = await ensureCategory(guild, cat, setupBotId, fullSync);
      if (category.created) {
        created.push(`category: ${cat.name}`);
        structureChanged = true;
      } else if (category.renamed) {
        renamed.push(`category: ${category.renamedFrom} → ${cat.name}`);
        structureChanged = true;
      }
      else skipped.push(`category: ${cat.name}`);

      for (const ch of cat.channels) {
        const type = ch.kind === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
        const syncPermissions = fullSync || channelUsesAnyRole(ch, changedRoleNames);
        const result = await ensureChannel(guild, category.channel, ch, type, setupBotId, syncPermissions);

        if (result.created) {
          created.push(`#${ch.name}`);
          structureChanged = true;
        } else if (result.renamed) {
          renamed.push(`#${result.renamedFrom} → ${ch.name}`);
          structureChanged = true;
        }
        else skipped.push(`#${ch.name}`);

        if (type === ChannelType.GuildText) {
          refsChanged = captureRef(refs, ch, result.channel.id) || refsChanged;
          freshTextChannels.push({
            plan: ch,
            channel: result.channel as TextChannel,
            changed: result.created || result.renamed,
          });
        }
      }
    }

    let embedsPosted = 0;
    let embedsUpdated = 0;
    let pinsOk = 0;
    let pinsFailed = 0;
    for (const { plan, channel, changed } of freshTextChannels) {
      const builder = WELCOME_BUILDERS[plan.name];
      if (!builder) continue;
      const trackedWelcome = db.select({ messageId: welcomeMessages.messageId })
        .from(welcomeMessages)
        .where(and(
          eq(welcomeMessages.guildId, config.DISCORD_GUILD_ID),
          eq(welcomeMessages.planName, plan.name),
        ))
        .get();
      const needsSync = fullSync
        || (refsChanged && REF_AWARE_WELCOME_NAMES.has(plan.name))
        || changed
        || !trackedWelcome
        || (rolesChanged && plan.name === ROLE_PICKER_PLAN_NAME);
      if (!needsSync) continue;
      try {
        const embed = builder(refs);
        const components = plan.name === '🎭・rollen' ? buildRolePickerButtons() : undefined;
        const result = await upsertWelcomeEmbed(channel, plan.name, embed, components);
        if (result.status === 'created') embedsPosted++;
        else if (result.status === 'updated') embedsUpdated++;
        if (result.pinned) pinsOk++;
        else pinsFailed++;
      } catch (err) {
        logger.warn({ err, channel: plan.name }, 'welcome embed upsert failed');
      }

    }

    if (fullSync || structureChanged) await sortServerStructure(guild);

    logger.info(
      { created: created.length, renamed: renamed.length, skipped: skipped.length, mode: fullSync ? 'full' : 'fast' },
      'server setup completed',
    );

    const lines: string[] = [];
    if (created.length) lines.push(`**✨ Created (${created.length})**\n${created.slice(0, 20).join('\n')}`);
    if (renamed.length) lines.push(`**🔁 Renamed (${renamed.length})**\n${renamed.slice(0, 20).join('\n')}`);
    if (removed.length) lines.push(`**🗑 Removed retired (${removed.length})**\n${removed.slice(0, 20).join('\n')}`);
    if (embedsPosted) lines.push(`**💬 Welcome-Embeds gepostet:** ${embedsPosted}`);
    if (embedsUpdated) lines.push(`**✏️ Welcome-Embeds editiert:** ${embedsUpdated}`);
    if (pinsOk || pinsFailed) {
      lines.push(
        `**📌 Anheften:** ${pinsOk} ok${pinsFailed ? ` · ⚠️ ${pinsFailed} fehlgeschlagen → Die MagguuBot-Rolle braucht **Administrator** (oder mindestens Nachrichten, Kanäle und Rollen verwalten) unter Servereinstellungen → Rollen` : ''}`,
      );
    }
    if (skipped.length) lines.push(`**⏭ Skipped (${skipped.length})**\n${skipped.slice(0, 10).join('\n')}`);
    lines.push(`**⚙️ Modus:** ${fullSync ? 'Vollständiger Abgleich' : 'Schnell – nur notwendige Änderungen'}`);

    await interaction.editReply({
      content: lines.join('\n\n').slice(0, 1900) || 'Alles bereits aktuell.',
      components: [],
    });
}

export async function handleSetupServerButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, ownerId, mode] = interaction.customId.split(':');
  if (!interaction.guild || !ownerId || interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Nur die Person, die die Vorschau gestartet hat, kann sie bestätigen.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'Dafür sind Administratorrechte erforderlich.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (action === 'cancel') {
    await interaction.update({ content: 'Setup abgebrochen – es wurden keine Änderungen vorgenommen.', components: [] });
    return;
  }
  if (action !== 'confirm') {
    await interaction.reply({ content: 'Diese Setup-Aktion ist ungültig.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.update({ content: '⏳ Setup wird angewendet …', components: [] });
  await applySetupServer(interaction, mode === 'full');
}

function buildSetupDryRun(guild: Guild, fullSync: boolean): string {
  const create: string[] = [];
  const rename: string[] = [];
  const existing: string[] = [];
  const textOutcomes: SetupWelcomeChannel[] = [];
  let refsChanged = false;
  const remove = RETIRED_ROLE_NAMES
    .filter((name) => guild.roles.cache.some((role) => role.name === name))
    .map((name) => `Rolle ${name}`);
  const trackedRows = db
    .select({ planName: welcomeMessages.planName })
    .from(welcomeMessages)
    .where(eq(welcomeMessages.guildId, config.DISCORD_GUILD_ID))
    .all();
  for (const row of trackedRows) {
    if (RETIRED_WELCOME_PLAN_NAMES.includes(row.planName)) remove.push(`Welcome-Embed ${row.planName}`);
  }
  for (const role of ROLES) {
    if (guild.roles.cache.some((candidate) => candidate.name === role.name)) {
      existing.push(`Rolle ${role.name}`);
    } else {
      const old = role.oldNames?.find((name) => guild.roles.cache.some((candidate) => candidate.name === name));
      if (old) rename.push(`Rolle ${old} → ${role.name}`);
      else create.push(`Rolle ${role.name}`);
    }
  }
  for (const category of STRUCTURE) {
    const target = guild.channels.cache.find((channel) =>
      channel.type === ChannelType.GuildCategory && channel.name === category.name,
    );
    const oldCategoryChannel = category.oldNames
      ?.map((name) => guild.channels.cache.find((channel) =>
        channel.type === ChannelType.GuildCategory && channel.name === name,
      ))
      .find((channel): channel is NonNullable<typeof channel> => Boolean(channel));
    const oldCategory = oldCategoryChannel?.name;
    if (target) existing.push(`Kategorie ${category.name}`);
    else if (oldCategory) rename.push(`Kategorie ${oldCategory} → ${category.name}`);
    else create.push(`Kategorie ${category.name}`);

    const parent = target ?? oldCategoryChannel;
    for (const channel of category.channels) {
      const kind = channel.kind === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
      const statsPrefix = STATS_CHANNEL_PREFIXES.find((prefix) => channel.name.startsWith(prefix));
      const currentMatches = parent
        ? [...guild.channels.cache.filter((candidate) =>
          candidate.parentId === parent.id
          && candidate.type === kind
          && (statsPrefix ? candidate.name.startsWith(statsPrefix) : candidate.name === channel.name),
        ).values()]
        : [];
      const current = currentMatches[0];
      for (const duplicate of currentMatches.slice(1)) remove.push(`#${duplicate.name} (Duplikat)`);
      const old = parent
        ? channel.oldNames?.find((name) => guild.channels.cache.some((candidate) =>
          candidate.parentId === parent.id && candidate.type === kind && candidate.name === name,
        ))
        : undefined;
      const status = current ? 'exists' : old ? 'rename' : 'create';
      if (current) existing.push(`#${channel.name}`);
      else if (old) rename.push(`#${old} → ${channel.name}`);
      else create.push(`#${channel.name}`);
      if (kind === ChannelType.GuildText) {
        textOutcomes.push({ planName: channel.name, status });
        const key = NAME_TO_REF_KEY[channel.name];
        if (key && PERSISTENT_KEYS.has(key)) {
          if (status !== 'exists') refsChanged = true;
          else if (current && getChannel(key as ChannelKey) !== current.id) refsChanged = true;
        }
      }
    }
  }
  const rolesChanged = [...create, ...rename, ...remove].some((item) => item.startsWith('Rolle '));
  const planned = planWelcomeEmbedSync({
    fullSync,
    rolesChanged,
    refsChanged,
    welcomePlanNames: new Set(Object.keys(WELCOME_BUILDERS)),
    channels: textOutcomes,
    trackedPlanNames: new Set(trackedRows.map((row) => row.planName)),
  });
  const extra: string[] = [];
  if (fullSync) {
    extra.push('Kanalreihenfolge neu sortieren');
    extra.push('alle Berechtigungen neu setzen');
  }
  const section = (label: string, items: string[], fallback: string): string =>
    `**${label} (${items.length})**\n${items.length ? items.slice(0, 12).map((item) => `• ${item}`).join('\n') : fallback}${items.length > 12 ? `\n… und ${items.length - 12} weitere` : ''}`;
  const lines = [
    '🧪 **Setup Dry-Run – noch nichts angewendet**',
    section('Würde erstellen', create, 'Nichts'),
    section('Würde umbenennen', rename, 'Nichts'),
    section('Würde entfernen', remove, 'Nichts'),
    `**Würde Welcome-Embeds neu posten (${planned.post.length})**\n${planned.post.length ? planned.post.map((name) => `• #${name}`).join('\n') : 'Nichts'}`,
    `**Würde Welcome-Embeds aktualisieren (${planned.edit.length})**\n${planned.edit.length ? planned.edit.map((name) => `• #${name}`).join('\n') : 'Nichts'}`,
  ];
  if (extra.length) lines.push(section('Würde zusätzlich', extra, 'Nichts'));
  lines.push(`**Bereits vorhanden:** ${existing.length}`);
  lines.push(
    fullSync
      ? '_Vollmodus. „Änderungen anwenden“ schreibt die Welcome-Pins jetzt um._'
      : '_Schnellmodus: bestehende Pins bleiben. Für FAQ/Hilfe-Refresh `full:true` setzen._',
  );
  return lines.join('\n\n').slice(0, 1_950);
}

function captureRef(refs: ChannelRefs, plan: ChannelPlan, channelId: string): boolean {
  const key = NAME_TO_REF_KEY[plan.name];
  if (!key) return false;
  refs[key] = channelId;
  if (PERSISTENT_KEYS.has(key)) {
    const changed = getChannel(key as ChannelKey) !== channelId;
    saveChannel(key as ChannelKey, channelId);
    return changed;
  }
  return false;
}

function channelUsesAnyRole(plan: ChannelPlan, roleNames: Set<string>): boolean {
  if (roleNames.size === 0) return false;
  if (plan.adminOnly && [...STAFF_ROLE_NAMES].some((name) => roleNames.has(name))) return true;
  return plan.allowedRoles?.some((name) => roleNames.has(name)) ?? false;
}

async function ensureCategory(
  guild: Guild,
  plan: CategoryPlan,
  botUserId: string | undefined,
  fullSync: boolean,
): Promise<{ channel: CategoryChannel; created: boolean; renamed: boolean; renamedFrom?: string }> {
  const existingWithTarget = guild.channels.cache.find(
    (c): c is CategoryChannel => c.type === ChannelType.GuildCategory && c.name === plan.name,
  );
  if (existingWithTarget) {
    if (fullSync) await applyBotCategoryPermissions(existingWithTarget, botUserId);
    return { channel: existingWithTarget, created: false, renamed: false };
  }

  const oldNames = plan.oldNames ?? [];
  for (const oldName of oldNames) {
    const existing = guild.channels.cache.find(
      (c): c is CategoryChannel => c.type === ChannelType.GuildCategory && c.name === oldName,
    );
    if (existing) {
      try {
        await existing.setName(plan.name);
        await applyBotCategoryPermissions(existing, botUserId);
        return { channel: existing, created: false, renamed: true, renamedFrom: oldName };
      } catch (err) {
        logger.warn({ err, oldName, target: plan.name }, 'category rename failed');
      }
    }
  }

  const created = await guild.channels.create({ name: plan.name, type: ChannelType.GuildCategory });
  await applyBotCategoryPermissions(created, botUserId);
  return { channel: created, created: true, renamed: false };
}

async function ensureChannel(
  guild: Guild,
  parent: CategoryChannel,
  plan: ChannelPlan,
  type: ChannelType.GuildText | ChannelType.GuildVoice,
  botUserId: string | undefined,
  syncPermissions: boolean,
): Promise<{
  channel: GuildBasedChannel;
  created: boolean;
  renamed: boolean;
  renamedFrom?: string;
}> {
  const statsPrefix = STATS_CHANNEL_PREFIXES.find((p) => plan.name.startsWith(p));
  const matchesPlan = (c: { name: string; parentId: string | null; type: ChannelType }): boolean => {
    if (c.parentId !== parent.id || c.type !== type) return false;
    if (statsPrefix) return c.name.startsWith(statsPrefix);
    return c.name === plan.name;
  };

  const matches = [...guild.channels.cache.filter((c) => matchesPlan(c)).values()];
  if (matches.length > 0) {
    const [keep, ...extras] = matches as [GuildBasedChannel, ...GuildBasedChannel[]];
    for (const dup of extras) {
      try {
        await dup.delete('setup-server duplicate stats channel sweep');
      } catch (err) {
        logger.warn({ err, name: dup.name }, 'failed to delete duplicate channel');
      }
    }
    if (syncPermissions) await applyChannelPermissions(keep as TextChannel, plan, guild, botUserId);
    return { channel: keep, created: false, renamed: false };
  }

  const oldNames = plan.oldNames ?? [];
  for (const oldName of oldNames) {
    const existing = guild.channels.cache.find(
      (c) => c.name === oldName && c.parentId === parent.id && c.type === type,
    );
    if (existing && 'setName' in existing) {
      try {
        await existing.setName(plan.name);
        await applyChannelPermissions(existing as TextChannel, plan, guild, botUserId);
        return { channel: existing, created: false, renamed: true, renamedFrom: oldName };
      } catch (err) {
        logger.warn({ err, oldName, target: plan.name }, 'channel rename failed');
      }
    }
  }

  if (type === ChannelType.GuildVoice) {
    const created = await guild.channels.create({
      name: plan.name,
      type: ChannelType.GuildVoice,
      parent: parent.id,
    });
    return { channel: created, created: true, renamed: false };
  }

  const created = (await guild.channels.create({
    name: plan.name,
    type: ChannelType.GuildText,
    parent: parent.id,
    topic: plan.topic,
  })) as TextChannel;

  await applyChannelPermissions(created, plan, guild, botUserId);

  return { channel: created, created: true, renamed: false };
}

const STAFF_ROLE_NAMES = ['Admin', 'Moderator'] as const;

async function applyChannelPermissions(
  channel: TextChannel,
  plan: ChannelPlan,
  guild: Guild,
  botUserId: string | undefined,
): Promise<void> {
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) return;

  const gatedToRoles = plan.adminOnly
    ? [...STAFF_ROLE_NAMES]
    : plan.allowedRoles && plan.allowedRoles.length > 0
      ? [...new Set([...plan.allowedRoles, ...STAFF_ROLE_NAMES])]
      : null;

  try {
    if (gatedToRoles) {
      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        ViewChannel: false,
        SendMessages: false,
      });
      for (const name of gatedToRoles) {
        const role = guild.roles.cache.find((r) => r.name === name);
        if (!role) continue;
        const isStaff = STAFF_ROLE_NAMES.includes(name as (typeof STAFF_ROLE_NAMES)[number]);
        await channel.permissionOverwrites.edit(role, {
          ViewChannel: true,
          SendMessages: !plan.readOnly,
          ReadMessageHistory: true,
          ManageMessages: isStaff ? true : null,
        });
      }
    } else if (plan.readOnly) {
      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: false,
        ViewChannel: true,
      });
    } else {
      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: null,
        ViewChannel: null,
      });
    }

    if (botUserId) {
      await channel.permissionOverwrites.edit(botUserId, {
        SendMessages: true,
        EmbedLinks: true,
        AttachFiles: true,
        ReadMessageHistory: true,
        ViewChannel: true,
        ManageMessages: true,
        AddReactions: true,
      });
    }
  } catch (err) {
    logger.warn({ err, channel: channel.name }, 'applyChannelPermissions failed');
  }
}

async function applyBotCategoryPermissions(
  category: CategoryChannel,
  botUserId: string | undefined,
): Promise<void> {
  if (!botUserId) return;
  try {
    await category.permissionOverwrites.edit(botUserId, {
      ViewChannel: true,
      SendMessages: true,
      EmbedLinks: true,
      AttachFiles: true,
      ReadMessageHistory: true,
      ManageMessages: true,
      ManageChannels: true,
      AddReactions: true,
    });
  } catch (err) {
    logger.warn({ err, category: category.name }, 'applyBotCategoryPermissions failed');
  }
}

interface UpsertResult {
  status: 'created' | 'updated' | 'noop';
  pinned: boolean;
}

async function upsertWelcomeEmbed(
  channel: TextChannel,
  planName: string,
  embed: EmbedBuilder,
  components: ActionRowBuilder<ButtonBuilder>[] | undefined,
): Promise<UpsertResult> {
  const existing = db
    .select()
    .from(welcomeMessages)
    .where(and(eq(welcomeMessages.guildId, config.DISCORD_GUILD_ID), eq(welcomeMessages.planName, planName)))
    .get();

  if (existing) {
    try {
      const message = await channel.messages.fetch(existing.messageId);
      await message.edit({ embeds: [embed], components: components ?? [] });
      const pinned = await ensurePinned(message);
      db.update(welcomeMessages)
        .set({ channelId: channel.id, updatedAt: new Date() })
        .where(
          and(
            eq(welcomeMessages.guildId, config.DISCORD_GUILD_ID),
            eq(welcomeMessages.planName, planName),
          ),
        )
        .run();
      return { status: 'updated', pinned };
    } catch {
      logger.debug({ planName, messageId: existing.messageId }, 'stored welcome message gone, re-posting');
    }
  }

  const message = await channel.send({ embeds: [embed], components });
  const pinned = await ensurePinned(message);
  db.insert(welcomeMessages)
    .values({
      guildId: config.DISCORD_GUILD_ID,
      planName,
      channelId: channel.id,
      messageId: message.id,
    })
    .onConflictDoUpdate({
      target: [welcomeMessages.guildId, welcomeMessages.planName],
      set: { channelId: channel.id, messageId: message.id, updatedAt: new Date() },
    })
    .run();
  return { status: 'created', pinned };
}

const MAX_PINS_REACHED_CODE = 30003;

export interface BotPermCheckResult {
  ok: boolean;
  missing: string[];
  hasAdmin: boolean;
}

export async function assertBotPermissions(guild: import('discord.js').Guild): Promise<BotPermCheckResult> {
  const me = await guild.members.fetchMe().catch(() => null);
  if (!me) return { ok: false, missing: ['(bot member not fetchable)'], hasAdmin: false };
  const perms = me.permissions;
  const Flags = (await import('discord.js')).PermissionFlagsBits;

  if (perms.has(Flags.Administrator)) return { ok: true, missing: [], hasAdmin: true };

  const required = [
    { flag: Flags.ManageRoles, name: 'ManageRoles' },
    { flag: Flags.ManageChannels, name: 'ManageChannels' },
    { flag: Flags.ManageMessages, name: 'ManageMessages' },
    { flag: Flags.ManageGuild, name: 'ManageGuild' },
    { flag: Flags.SendMessages, name: 'SendMessages' },
    { flag: Flags.EmbedLinks, name: 'EmbedLinks' },
  ];
  const missing = required.filter((r) => !perms.has(r.flag)).map((r) => r.name);
  return { ok: missing.length === 0, missing, hasAdmin: false };
}

export async function backfillWelcomePins(): Promise<{
  checked: number;
  pinned: number;
  failed: number;
  abortedReason?: string;
}> {
  const rows = db
    .select()
    .from(welcomeMessages)
    .where(eq(welcomeMessages.guildId, config.DISCORD_GUILD_ID))
    .all();

  let pinned = 0;
  let failed = 0;
  let abortedReason: string | undefined;
  for (const row of rows) {
    try {
      const channel = (await getClient().channels.fetch(row.channelId).catch(() => null)) as TextChannel | null;
      if (!channel?.isTextBased()) continue;
      const message = await channel.messages.fetch(row.messageId).catch(() => null);
      if (!message) continue;
      if (message.pinned) continue;
      const ok = await ensurePinned(message);
      if (ok) {
        pinned++;
      } else {
        failed++;
        // Quick-abort: if first failure is 50013 (Missing Permissions), don't spam — bot lacks global ManageMessages
        if (failed === 1 && pinned === 0) {
          abortedReason =
            'first pin attempt got Missing Permissions (50013) — bot role lacks ManageMessages globally; aborting backfill to avoid log spam';
          logger.warn({ checked: pinned + failed, total: rows.length, hint: 'add Administrator (or ManageMessages + ManageChannels + ManageRoles) to the MagguuBot role in Server Settings -> Roles' }, abortedReason);
          break;
        }
      }
    } catch (err) {
      logger.debug({ err, planName: row.planName }, 'backfill pin attempt errored');
      failed++;
    }
  }

  if (pinned > 0 || failed > 0) {
    logger.info({ checked: rows.length, pinned, failed, abortedReason }, 'welcome-pin backfill complete');
  }
  return { checked: rows.length, pinned, failed, abortedReason };
}

function describeDiscordError(err: unknown): { code?: number; message: string } {
  if (err && typeof err === 'object') {
    const e = err as { code?: number; message?: string; rawError?: { message?: string } };
    return {
      code: e.code,
      message: e.rawError?.message ?? e.message ?? String(err),
    };
  }
  return { message: String(err) };
}

async function ensurePinned(message: import('discord.js').Message): Promise<boolean> {
  if (message.pinned) return true;
  try {
    await message.pin('auto-pin welcome embed');
    await deletePinNotification(message);
    return true;
  } catch (err) {
    const { code, message: errMsg } = describeDiscordError(err);
    const isMaxPins = code === MAX_PINS_REACHED_CODE;
    if (!isMaxPins) {
      logger.warn(
        { code, error: errMsg, messageId: message.id, channelId: message.channelId, channelName: 'name' in message.channel ? message.channel.name : '?' },
        'pin failed — bot likely lacks ManageMessages globally; grant it on the bot role in Server Settings -> Roles',
      );
      return false;
    }

    // 50-pin limit reached — try to make room by unpinning the oldest pin in this channel
    try {
      const channel = message.channel;
      if (!('messages' in channel)) {
        logger.warn({ messageId: message.id }, 'pin failed — 50-pin limit, channel does not expose messages');
        return false;
      }
      const pins = await channel.messages.fetchPinned();
      const oldestPin = pins.sort((a, b) => a.createdTimestamp - b.createdTimestamp).first();
      if (!oldestPin) {
        logger.warn({ messageId: message.id }, 'pin failed — 50-pin limit, no pins to evict');
        return false;
      }
      await oldestPin.unpin('evicting oldest pin to make room for fresh welcome embed');
      logger.info({ evicted: oldestPin.id, channelId: message.channelId }, 'pin: evicted oldest to free 50-pin slot');
      await message.pin('auto-pin welcome embed (after eviction)');
      await deletePinNotification(message);
      return true;
    } catch (evictErr) {
      logger.warn({ err: evictErr, messageId: message.id }, 'pin retry failed after eviction attempt');
      return false;
    }
  }
}

async function deletePinNotification(pinnedMessage: import('discord.js').Message): Promise<void> {
  try {
    const { MessageType } = await import('discord.js');
    const recent = await pinnedMessage.channel.messages.fetch({ limit: 5, after: pinnedMessage.id });
    const notification = recent.find(
      (m) => m.type === MessageType.ChannelPinnedMessage && m.reference?.messageId === pinnedMessage.id,
    );
    if (notification) await notification.delete();
  } catch {
    /* notification cleanup is best-effort */
  }
}

async function sortServerStructure(guild: Guild): Promise<void> {
  for (let catIdx = 0; catIdx < STRUCTURE.length; catIdx++) {
    const catPlan = STRUCTURE[catIdx];
    if (!catPlan) continue;
    const category = guild.channels.cache.find(
      (c): c is CategoryChannel => c.type === ChannelType.GuildCategory && c.name === catPlan.name,
    );
    if (!category) continue;
    if (category.position !== catIdx) {
      await category
        .setPosition(catIdx)
        .catch((err: unknown) => logger.warn({ err, name: catPlan.name }, 'category sort failed'));
    }

    for (let chIdx = 0; chIdx < catPlan.channels.length; chIdx++) {
      const ch = catPlan.channels[chIdx];
      if (!ch) continue;
      const type = ch.kind === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
      const channel = guild.channels.cache.find(
        (c) =>
          c.name === ch.name && c.parentId === category.id && c.type === type && 'setPosition' in c,
      );
      if (!channel || !('setPosition' in channel)) continue;
      if (channel.position !== chIdx) {
        await channel
          .setPosition(chIdx)
          .catch((err: unknown) => logger.warn({ err, name: ch.name }, 'channel sort failed'));
      }
    }
  }
}
