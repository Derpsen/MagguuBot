import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type CategoryChannel,
  type EmbedBuilder,
  type Guild,
  type GuildBasedChannel,
  type TextChannel,
} from 'discord.js';
import {
  buildAnnouncementsEmbed,
  buildApprovalsChannelEmbed,
  buildAuditLogChannelEmbed,
  buildBotCommandsChannelEmbed,
  buildBotHelpEmbed,
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
  buildSpoilerChannelEmbed,
  buildStarboardChannelEmbed,
  buildWelcomeHeroEmbed,
  type ChannelRefs,
} from '../../embeds/welcome.js';
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
}

interface CategoryPlan {
  name: string;
  oldNames?: string[];
  channels: ChannelPlan[];
}

interface RolePlan {
  name: string;
  color: number;
  mentionable?: boolean;
  hoist?: boolean;
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
];

const STRUCTURE: CategoryPlan[] = [
  {
    name: '📊 STATISTIK',
    channels: [
      { name: '👥 Mitglieder: 0', kind: 'voice' },
      { name: '📈 Boosts: 0', kind: 'voice' },
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
    name: '🎬 MEDIA',
    channels: [
      { name: '📝・anfragen', oldNames: ['requests'], topic: 'Film / Serie requesten.' },
      { name: '⏳・freigaben', oldNames: ['approvals'], topic: 'Admin-only Approvals.', readOnly: true },
      { name: '✨・neu-auf-plex', oldNames: ['new-on-plex'], topic: 'Recently added (Tautulli).', readOnly: true },
    ],
  },
  {
    name: '📥 DOWNLOADS',
    channels: [
      { name: '📥・grabs', oldNames: ['grabs'], topic: 'Sonarr / Radarr / SAB grabs.', readOnly: true },
      { name: '✅・imports', oldNames: ['imports'], topic: 'Erfolgreich importierte Files.', readOnly: true },
      { name: '⚠️・fehler', oldNames: ['failures'], topic: 'Failures + manual intervention.', readOnly: true },
    ],
  },
  {
    name: '🔧 STATUS',
    channels: [{ name: '🩺・health', oldNames: ['health'], topic: 'Sonarr/Radarr/SAB Health.', readOnly: true }],
  },
  {
    name: '💬 CHAT',
    channels: [
      { name: '💬・chat', oldNames: ['general'], topic: 'Labern + Smalltalk.' },
      { name: '⌨️・bot-befehle', oldNames: ['bot-commands'], topic: 'Für /queue, /search etc.' },
      { name: '🔇・spoiler-zone', oldNames: ['spoiler-zone'], topic: 'Spoiler erlaubt.' },
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
      { name: '🛡️・mod-log', oldNames: ['mod-log'], topic: 'Alle Mod-Actions.', readOnly: true },
      { name: '📋・audit-log', oldNames: ['audit-log'], topic: 'Joins/Leaves/Role-Changes.', readOnly: true },
    ],
  },
  {
    name: '🔨 DEV',
    channels: [{ name: '🔨・github', oldNames: ['github'], topic: 'GitHub-Webhook-Feed.', readOnly: true }],
  },
  {
    name: '⭐ HIGHLIGHTS',
    channels: [
      { name: '⭐・starboard', oldNames: ['starboard'], topic: 'Nachrichten mit 3+ ⭐ landen hier.', readOnly: true },
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

const STATS_CHANNEL_PREFIXES = ['👥 Mitglieder: ', '📈 Boosts: ', '🤖 Bot-Uptime: '];

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
};

const PERSISTENT_KEYS: ReadonlySet<string> = new Set<ChannelKey>([
  'grabs',
  'imports',
  'failures',
  'requests',
  'approvals',
  'newOnPlex',
  'health',
  'welcome',
  'auditLog',
  'modLog',
  'github',
  'starboard',
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

    for (const cat of STRUCTURE) {
      const category = await ensureCategory(interaction.guild, cat);
      if (category.created) created.push(`category: ${cat.name}`);
      else if (category.renamed) renamed.push(`category: ${category.renamedFrom} → ${cat.name}`);
      else skipped.push(`category: ${cat.name}`);

      for (const ch of cat.channels) {
        const type = ch.kind === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
        const result = await ensureChannel(interaction.guild, category.channel, ch, type);

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
    const botUserId = interaction.client.user?.id;
    for (const { plan, channel } of freshTextChannels) {
      const builder = WELCOME_BUILDERS[plan.name];
      if (!builder) continue;
      try {
        if (botUserId && (await hasWelcomeEmbed(channel, botUserId, plan.name))) continue;
        const embed = builder(refs);
        if (plan.name === '🎭・rollen') {
          await channel.send({ embeds: [embed], components: [buildRolePickerButtons()] });
        } else {
          await channel.send({ embeds: [embed] });
        }
        embedsPosted++;
      } catch (err) {
        logger.warn({ err, channel: plan.name }, 'welcome embed post failed');
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
): Promise<{ channel: CategoryChannel; created: boolean; renamed: boolean; renamedFrom?: string }> {
  const existingWithTarget = guild.channels.cache.find(
    (c): c is CategoryChannel => c.type === ChannelType.GuildCategory && c.name === plan.name,
  );
  if (existingWithTarget) {
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
        return { channel: existing, created: false, renamed: true, renamedFrom: oldName };
      } catch (err) {
        logger.warn({ err, oldName, target: plan.name }, 'category rename failed');
      }
    }
  }

  const created = await guild.channels.create({ name: plan.name, type: ChannelType.GuildCategory });
  return { channel: created, created: true, renamed: false };
}

async function ensureChannel(
  guild: Guild,
  parent: CategoryChannel,
  plan: ChannelPlan,
  type: ChannelType.GuildText | ChannelType.GuildVoice,
): Promise<{
  channel: GuildBasedChannel;
  created: boolean;
  renamed: boolean;
  renamedFrom?: string;
}> {
  const existingWithTarget = guild.channels.cache.find(
    (c) => c.name === plan.name && c.parentId === parent.id && c.type === type,
  );
  if (existingWithTarget) {
    return { channel: existingWithTarget, created: false, renamed: false };
  }

  const oldNames = plan.oldNames ?? [];
  for (const oldName of oldNames) {
    const existing = guild.channels.cache.find(
      (c) => c.name === oldName && c.parentId === parent.id && c.type === type,
    );
    if (existing && 'setName' in existing) {
      try {
        await existing.setName(plan.name);
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

  if (plan.readOnly) {
    await created.permissionOverwrites.create(guild.roles.everyone, {
      SendMessages: false,
      ViewChannel: true,
    });
  }

  return { channel: created, created: true, renamed: false };
}

async function hasWelcomeEmbed(
  channel: TextChannel,
  botUserId: string,
  planName: string,
): Promise<boolean> {
  const builder = WELCOME_BUILDERS[planName];
  if (!builder) return true;
  const expectedTitle = builder({}).data.title;
  if (!expectedTitle) return true;
  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    return messages.some(
      (msg) => msg.author.id === botUserId && msg.embeds.some((e) => e.title === expectedTitle),
    );
  } catch {
    return false;
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
