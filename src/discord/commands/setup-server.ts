import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type CategoryChannel,
  type Guild,
  type TextChannel,
} from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import { logger } from '../../utils/logger.js';
import type { SlashCommand } from './index.js';

interface ChannelPlan {
  name: string;
  topic: string;
  readOnly?: boolean;
  welcome?: () => EmbedBuilder;
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
    name: '🎬 MEDIA',
    channels: [
      {
        name: 'requests',
        topic: '📝 Request movies / shows here. The bot forwards to Seerr.',
        welcome: () =>
          banner('📝 Requests', Colors.seerr)
            .setDescription(
              'Request a new movie or show through **Seerr**.\nAdmins see incoming requests in <#approvals>.',
            ),
      },
      {
        name: 'approvals',
        topic: '⏳ Pending Seerr requests. Admin-only approve/decline.',
        readOnly: true,
        welcome: () =>
          banner('⏳ Approvals', Colors.warn).setDescription(
            'Admins approve / decline Seerr requests with a single button click.',
          ),
      },
      {
        name: 'new-on-plex',
        topic: '✨ Recently added to the Plex library (via Tautulli).',
        readOnly: true,
        welcome: () =>
          banner('✨ New on Plex', Colors.plex).setDescription(
            'Fresh arrivals on Plex. Posted automatically by Tautulli when new media is added.',
          ),
      },
    ],
  },
  {
    name: '📥 DOWNLOADS',
    channels: [
      {
        name: 'grabs',
        topic: '📥 Sonarr / Radarr have grabbed a release and queued it in SABnzbd.',
        readOnly: true,
        welcome: () =>
          banner('📥 Grabs', Colors.info).setDescription(
            'Every time Sonarr / Radarr sends a release to SABnzbd, it shows up here.',
          ),
      },
      {
        name: 'imports',
        topic: '✅ Downloads completed + imported into the library.',
        readOnly: true,
        welcome: () =>
          banner('✅ Imports', Colors.success).setDescription(
            'Completed downloads — imported by Sonarr / Radarr, or finished by SABnzbd.',
          ),
      },
      {
        name: 'failures',
        topic: '⚠️ Downloads that failed / need manual intervention.',
        readOnly: true,
        welcome: () =>
          banner('⚠️ Failures', Colors.danger).setDescription(
            'Things that need attention: unpack errors, manual interactions, SAB failures.',
          ),
      },
    ],
  },
  {
    name: '🔧 ARR-STACK',
    channels: [
      {
        name: 'health',
        topic: '🩺 Sonarr / Radarr / SABnzbd health events.',
        readOnly: true,
        welcome: () =>
          banner('🩺 Health', Colors.muted).setDescription(
            'Health warnings and errors from the *arr stack and SABnzbd.',
          ),
      },
    ],
  },
];

export const setupServerCommand: SlashCommand = {
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

    for (const cat of STRUCTURE) {
      const category = await ensureCategory(interaction.guild, cat.name);
      if (category.existed) skipped.push(`category: ${cat.name}`);
      else created.push(`category: ${cat.name}`);

      for (const ch of cat.channels) {
        const existing = interaction.guild.channels.cache.find(
          (c) => c.name === ch.name && c.parentId === category.channel.id,
        );
        if (existing) {
          skipped.push(`#${ch.name}`);
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
        if (ch.welcome) {
          await channel.send({ embeds: [ch.welcome()] }).catch(() => {});
        }
        created.push(`#${ch.name}`);
      }
    }

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

function banner(title: string, color: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setFooter({ text: 'MagguuBot' })
    .setTimestamp(new Date());
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
