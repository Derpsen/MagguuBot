import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ActionRowBuilder,
  type ButtonBuilder,
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
  buildWelcomeHeroEmbed,
  type ChannelRefs,
} from '../../embeds/welcome.js';
import { and, eq } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { welcomeMessages } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import { saveChannel, type ChannelKey } from '../channel-store.js';
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
      { name: '⚠️・fehler', oldNames: ['failures'], topic: 'Failures + manual intervention.', readOnly: true, adminOnly: true },
    ],
  },
  {
    name: '🔧 STATUS',
    channels: [{ name: '🩺・health', oldNames: ['health'], topic: 'Sonarr/Radarr/SAB Health + Updates.', readOnly: true, adminOnly: true }],
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

const STATS_CHANNEL_PREFIXES = ['👥 Mitglieder: ', '📈 Boosts: ', '🎙 In Voice: ', '🤖 Bot-Uptime: '];

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
};

export const setupServerCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('setup-server')
    .setDescription('Kategorien, Channels + Rollen anlegen, umbennen, sortieren (idempotent)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild) {
      await interaction.editReply('Guild only.');
      return;
    }

    const created: string[] = [];
    const skipped: string[] = [];
    const renamed: string[] = [];

    for (const r of ROLES) {
      const existing = interaction.guild.roles.cache.find((x) => x.name === r.name);
      if (existing) {
        skipped.push(`role: ${r.name}`);
        continue;
      }
      const oldRole = r.oldNames
        ?.map((n) => interaction.guild?.roles.cache.find((x) => x.name === n))
        .find((x): x is NonNullable<typeof x> => Boolean(x));
      if (oldRole) {
        try {
          await oldRole.setName(r.name, 'setup-server role rename');
          renamed.push(`role: ${oldRole.name === r.name ? oldRole.name : `${oldRole.name} → ${r.name}`}`);
          continue;
        } catch (err) {
          logger.warn({ err, old: oldRole.name, target: r.name }, 'role rename failed, creating new');
        }
      }
      await interaction.guild.roles.create({
        name: r.name,
        color: r.color,
        mentionable: r.mentionable ?? false,
        hoist: r.hoist ?? false,
      });
      created.push(`role: ${r.name}`);
    }

    const freshTextChannels: Array<{ plan: ChannelPlan; channel: TextChannel }> = [];
    const refs: ChannelRefs = {};

    const setupBotId = interaction.client.user?.id;

    for (const cat of STRUCTURE) {
      const category = await ensureCategory(interaction.guild, cat, setupBotId);
      if (category.created) created.push(`category: ${cat.name}`);
      else if (category.renamed) renamed.push(`category: ${category.renamedFrom} → ${cat.name}`);
      else skipped.push(`category: ${cat.name}`);

      for (const ch of cat.channels) {
        const type = ch.kind === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
        const result = await ensureChannel(interaction.guild, category.channel, ch, type, setupBotId);

        if (result.created) created.push(`#${ch.name}`);
        else if (result.renamed) renamed.push(`#${result.renamedFrom} → ${ch.name}`);
        else skipped.push(`#${ch.name}`);

        if (type === ChannelType.GuildText) {
          captureRef(refs, ch, result.channel.id);
          freshTextChannels.push({ plan: ch, channel: result.channel as TextChannel });
        }
      }
    }

    let embedsPosted = 0;
    let embedsUpdated = 0;
    for (const { plan, channel } of freshTextChannels) {
      const builder = WELCOME_BUILDERS[plan.name];
      if (!builder) continue;
      try {
        const embed = builder(refs);
        const components = plan.name === '🎭・rollen' ? buildRolePickerButtons() : undefined;
        const result = await upsertWelcomeEmbed(channel, plan.name, embed, components);
        if (result === 'created') embedsPosted++;
        else if (result === 'updated') embedsUpdated++;
      } catch (err) {
        logger.warn({ err, channel: plan.name }, 'welcome embed upsert failed');
      }
    }

    await sortServerStructure(interaction.guild);

    logger.info(
      { created: created.length, renamed: renamed.length, skipped: skipped.length },
      'server setup completed',
    );

    const lines: string[] = [];
    if (created.length) lines.push(`**✨ Created (${created.length})**\n${created.slice(0, 20).join('\n')}`);
    if (renamed.length) lines.push(`**🔁 Renamed (${renamed.length})**\n${renamed.slice(0, 20).join('\n')}`);
    if (embedsPosted) lines.push(`**💬 Welcome-Embeds gepostet:** ${embedsPosted}`);
    if (embedsUpdated) lines.push(`**✏️ Welcome-Embeds editiert:** ${embedsUpdated}`);
    if (skipped.length) lines.push(`**⏭ Skipped (${skipped.length})**\n${skipped.slice(0, 10).join('\n')}`);

    await interaction.editReply(lines.join('\n\n').slice(0, 1900) || 'Alles bereits aktuell.');
  },
};

function captureRef(refs: ChannelRefs, plan: ChannelPlan, channelId: string): void {
  const key = NAME_TO_REF_KEY[plan.name];
  if (!key) return;
  refs[key] = channelId;
  if (PERSISTENT_KEYS.has(key)) {
    saveChannel(key as ChannelKey, channelId);
  }
}

async function ensureCategory(
  guild: Guild,
  plan: CategoryPlan,
  botUserId: string | undefined,
): Promise<{ channel: CategoryChannel; created: boolean; renamed: boolean; renamedFrom?: string }> {
  const existingWithTarget = guild.channels.cache.find(
    (c): c is CategoryChannel => c.type === ChannelType.GuildCategory && c.name === plan.name,
  );
  if (existingWithTarget) {
    await applyBotCategoryPermissions(existingWithTarget, botUserId);
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
    await applyChannelPermissions(keep as TextChannel, plan, guild, botUserId);
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

async function upsertWelcomeEmbed(
  channel: TextChannel,
  planName: string,
  embed: EmbedBuilder,
  components: ActionRowBuilder<ButtonBuilder>[] | undefined,
): Promise<'created' | 'updated' | 'noop'> {
  const existing = db
    .select()
    .from(welcomeMessages)
    .where(and(eq(welcomeMessages.guildId, config.DISCORD_GUILD_ID), eq(welcomeMessages.planName, planName)))
    .get();

  if (existing) {
    try {
      const message = await channel.messages.fetch(existing.messageId);
      await message.edit({ embeds: [embed], components: components ?? [] });
      await ensurePinned(message);
      db.update(welcomeMessages)
        .set({ channelId: channel.id, updatedAt: new Date() })
        .where(
          and(
            eq(welcomeMessages.guildId, config.DISCORD_GUILD_ID),
            eq(welcomeMessages.planName, planName),
          ),
        )
        .run();
      return 'updated';
    } catch {
      logger.debug({ planName, messageId: existing.messageId }, 'stored welcome message gone, re-posting');
    }
  }

  const message = await channel.send({ embeds: [embed], components });
  await ensurePinned(message);
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
  return 'created';
}

async function ensurePinned(message: import('discord.js').Message): Promise<void> {
  if (message.pinned) return;
  try {
    await message.pin('auto-pin welcome embed');
    await deletePinNotification(message);
  } catch (err) {
    logger.debug({ err, messageId: message.id }, 'pin failed — likely 50-pin-limit or missing ManageMessages');
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
    await category
      .setPosition(catIdx)
      .catch((err: unknown) => logger.warn({ err, name: catPlan.name }, 'category sort failed'));

    for (let chIdx = 0; chIdx < catPlan.channels.length; chIdx++) {
      const ch = catPlan.channels[chIdx];
      if (!ch) continue;
      const type = ch.kind === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
      const channel = guild.channels.cache.find(
        (c) =>
          c.name === ch.name && c.parentId === category.id && c.type === type && 'setPosition' in c,
      );
      if (!channel || !('setPosition' in channel)) continue;
      await channel
        .setPosition(chIdx)
        .catch((err: unknown) => logger.warn({ err, name: ch.name }, 'channel sort failed'));
    }
  }
}
