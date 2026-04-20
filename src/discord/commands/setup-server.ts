import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type CategoryChannel,
  type EmbedBuilder,
  type Guild,
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
  buildWelcomeHeroEmbed,
  type ChannelRefs,
} from '../../embeds/welcome.js';
import { logger } from '../../utils/logger.js';
import { saveChannel, type ChannelKey } from '../channel-store.js';
import type { SlashCommand } from './index.js';

type ChannelKind = 'text' | 'voice';

interface ChannelPlan {
  key: keyof ChannelRefs | 'announcements' | 'spoilerZone';
  name: string;
  topic?: string;
  kind?: ChannelKind;
  readOnly?: boolean;
}

interface CategoryPlan {
  name: string;
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
    name: '🏠 INFO',
    channels: [
      { key: 'rules' as const, name: 'willkommen', topic: 'Start hier — Regeln + Quick-Start.', readOnly: true },
      { key: 'rules' as const, name: 'regeln', topic: 'Server-Regeln. Lesen, verstehen, einhalten.', readOnly: true },
      { key: 'announcements' as const, name: 'ankündigungen', topic: 'Server-Updates + Wartungsfenster.', readOnly: true },
      { key: 'botHelp' as const, name: 'bot-hilfe', topic: 'Alle Slash-Commands + wie der Bot tickt.', readOnly: true },
      { key: 'roles' as const, name: 'rollen', topic: 'Hol dir Benachrichtigungs-Rollen per Button.', readOnly: true },
    ],
  },
  {
    name: '🎬 MEDIA',
    channels: [
      { key: 'requests' as const, name: 'requests', topic: 'Film / Serie requesten — über Seerr oder hier.' },
      { key: 'approvals' as const, name: 'approvals', topic: 'Admin-only Approve/Decline für Seerr.', readOnly: true },
      { key: 'newOnPlex' as const, name: 'new-on-plex', topic: 'Frisch auf Plex — Tautulli postet automatisch.', readOnly: true },
    ],
  },
  {
    name: '📥 DOWNLOADS',
    channels: [
      { key: 'grabs' as const, name: 'grabs', topic: 'Sonarr / Radarr grabs + SAB queue-additions.', readOnly: true },
      { key: 'imports' as const, name: 'imports', topic: 'Erfolgreich importierte Files (ready to stream).', readOnly: true },
      { key: 'failures' as const, name: 'failures', topic: 'Failures + manual-interaction events.', readOnly: true },
    ],
  },
  {
    name: '🔧 STATUS',
    channels: [
      { key: 'health' as const, name: 'health', topic: 'Sonarr / Radarr / SAB Health-Warnings.', readOnly: true },
    ],
  },
  {
    name: '💬 CHAT',
    channels: [
      { key: 'general' as const, name: 'general', topic: 'Labern, Empfehlungen, Smalltalk.' },
      { key: 'botCommands' as const, name: 'bot-commands', topic: 'Für /queue, /search etc.' },
      { key: 'spoilerZone' as const, name: 'spoiler-zone', topic: 'Spoiler erlaubt — auf eigene Gefahr.' },
    ],
  },
  {
    name: '🎧 VOICE',
    channels: [
      { key: 'general' as const, name: '🔊 General', kind: 'voice' },
      { key: 'general' as const, name: '🎬 Movie Night', kind: 'voice' },
      { key: 'general' as const, name: '💤 AFK', kind: 'voice' },
    ],
  },
  {
    name: '🛡️ MOD',
    channels: [
      { key: 'rules' as const, name: 'mod-log', topic: 'Alle Mod-Actions.', readOnly: true },
      { key: 'rules' as const, name: 'audit-log', topic: 'Server-Events (joins/leaves/role-changes).', readOnly: true },
    ],
  },
  {
    name: '🔨 DEV',
    channels: [
      { key: 'rules' as const, name: 'github', topic: 'GitHub-Webhook-Feed (Pushes, Runs, Releases, PRs).', readOnly: true },
    ],
  },
];

export const setupServerCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('setup-server')
    .setDescription('Scaffold the MagguuBot Discord channels + roles (idempotent)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild) {
      await interaction.editReply('This command must be run in a guild.');
      return;
    }

    const created: string[] = [];
    const skipped: string[] = [];

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
      const category = await ensureCategory(interaction.guild, cat.name);
      if (category.existed) skipped.push(`category: ${cat.name}`);
      else created.push(`category: ${cat.name}`);

      for (const ch of cat.channels) {
        const type = ch.kind === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
        const existing = interaction.guild.channels.cache.find(
          (c) => c.name === ch.name && c.parentId === category.channel.id && c.type === type,
        );
        if (existing) {
          skipped.push(`#${ch.name}`);
          if (ch.kind !== 'voice' && existing.type === ChannelType.GuildText) {
            captureRef(refs, ch, existing.id);
          }
          continue;
        }

        if (ch.kind === 'voice') {
          await interaction.guild.channels.create({
            name: ch.name,
            type: ChannelType.GuildVoice,
            parent: category.channel.id,
          });
          created.push(`🔊 ${ch.name}`);
          continue;
        }

        const channel = (await interaction.guild.channels.create({
          name: ch.name,
          type: ChannelType.GuildText,
          parent: category.channel.id,
          topic: ch.topic,
        })) as TextChannel;
        if (ch.readOnly) {
          await channel.permissionOverwrites.create(interaction.guild.roles.everyone, {
            SendMessages: false,
            ViewChannel: true,
          });
        }
        captureRef(refs, ch, channel.id);
        freshTextChannels.push({ plan: ch, channel });
        created.push(`#${ch.name}`);
      }
    }

    for (const { plan, channel } of freshTextChannels) {
      const embed = welcomeEmbedFor(plan, refs);
      if (!embed) continue;
      try {
        if (plan.name === 'rollen') {
          await channel.send({ embeds: [embed], components: [buildRolePickerButtons()] });
        } else {
          await channel.send({ embeds: [embed] });
        }
      } catch (err) {
        logger.warn({ err, channel: plan.name }, 'failed to post welcome embed');
      }
    }

    await sortServerStructure(interaction.guild);

    logger.info({ created: created.length, skipped: skipped.length }, 'server setup completed');
    const summary = [
      `**Created (${created.length})**`,
      created.slice(0, 30).join('\n') || '_none_',
      created.length > 30 ? `…and ${created.length - 30} more` : '',
      '',
      `**Skipped / already existed (${skipped.length})**`,
      skipped.slice(0, 15).join('\n') || '_none_',
      skipped.length > 15 ? `…and ${skipped.length - 15} more` : '',
    ]
      .filter(Boolean)
      .join('\n');
    await interaction.editReply(summary.slice(0, 1900));
  },
};

const NAME_TO_REF_KEY: Record<string, keyof ChannelRefs> = {
  willkommen: 'welcome',
  regeln: 'rules',
  rollen: 'roles',
  'bot-hilfe': 'botHelp',
  ankündigungen: 'announcements',
  requests: 'requests',
  approvals: 'approvals',
  'new-on-plex': 'newOnPlex',
  grabs: 'grabs',
  imports: 'imports',
  failures: 'failures',
  health: 'health',
  general: 'general',
  'bot-commands': 'botCommands',
  'mod-log': 'modLog',
  'audit-log': 'auditLog',
  github: 'github',
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
]);

function captureRef(refs: ChannelRefs, plan: ChannelPlan, channelId: string): void {
  const key = NAME_TO_REF_KEY[plan.name];
  if (!key) return;
  refs[key] = channelId;
  if (PERSISTENT_KEYS.has(key)) {
    saveChannel(key as ChannelKey, channelId);
  }
}

function welcomeEmbedFor(plan: ChannelPlan, refs: ChannelRefs): EmbedBuilder | null {
  switch (plan.name) {
    case 'willkommen':
      return buildWelcomeHeroEmbed(refs);
    case 'regeln':
      return buildRulesEmbed();
    case 'ankündigungen':
      return buildAnnouncementsEmbed();
    case 'bot-hilfe':
      return buildBotHelpEmbed(refs);
    case 'rollen':
      return buildRolePickerEmbed();
    case 'requests':
      return buildRequestsChannelEmbed(refs);
    case 'approvals':
      return buildApprovalsChannelEmbed();
    case 'new-on-plex':
      return buildNewOnPlexChannelEmbed();
    case 'grabs':
      return buildGrabsChannelEmbed(refs);
    case 'imports':
      return buildImportsChannelEmbed();
    case 'failures':
      return buildFailuresChannelEmbed();
    case 'health':
      return buildHealthChannelEmbed();
    case 'general':
      return buildGeneralChatEmbed();
    case 'bot-commands':
      return buildBotCommandsChannelEmbed();
    case 'spoiler-zone':
      return buildSpoilerChannelEmbed();
    case 'mod-log':
      return buildModLogChannelEmbed();
    case 'audit-log':
      return buildAuditLogChannelEmbed();
    case 'github':
      return buildGithubChannelEmbed();
    default:
      return null;
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
          c.name === ch.name &&
          c.parentId === category.id &&
          c.type === type &&
          'setPosition' in c,
      );
      if (!channel || !('setPosition' in channel)) continue;
      await channel
        .setPosition(chIdx)
        .catch((err: unknown) => logger.warn({ err, name: ch.name }, 'channel sort failed'));
    }
  }
}

async function ensureCategory(
  guild: Guild,
  name: string,
): Promise<{ channel: CategoryChannel; existed: boolean }> {
  const existing = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === name);
  if (existing && existing.type === ChannelType.GuildCategory) {
    return { channel: existing as CategoryChannel, existed: true };
  }
  const created = await guild.channels.create({ name, type: ChannelType.GuildCategory });
  return { channel: created, existed: false };
}
