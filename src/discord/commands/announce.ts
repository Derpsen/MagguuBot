import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Guild,
  type TextChannel,
} from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import type { SlashCommand } from './index.js';

const COLOR_CHOICES = [
  { name: 'Brand (lila)', value: 'brand' },
  { name: 'Info (blau)', value: 'info' },
  { name: 'Erfolg (grün)', value: 'success' },
  { name: 'Warnung (gelb)', value: 'warn' },
  { name: 'Danger (rot)', value: 'danger' },
] as const;

const COLOR_MAP: Record<string, number> = {
  brand: Colors.brand,
  info: Colors.info,
  success: Colors.success,
  warn: Colors.warn,
  danger: Colors.danger,
};

const PING_PRESETS = [
  { name: '— kein Ping —', value: 'none' },
  { name: '@everyone', value: 'everyone' },
  { name: '@here', value: 'here' },
  { name: '📢 Announcements-Rolle', value: 'ping-announcements' },
  { name: '🎬 Film-Alerts', value: 'ping-movies' },
  { name: '📺 Serien-Alerts', value: 'ping-series' },
  { name: '🔊 4K-Alerts', value: 'ping-4k' },
  { name: '🌸 Anime-Alerts', value: 'ping-anime' },
  { name: '⚔️ WoW Class Tuning', value: 'ping-wow-tuning' },
  { name: '🧪 WoW PTR', value: 'ping-wow-ptr' },
  { name: '🔨 GitHub Releases', value: 'ping-github' },
] as const;

type PingPreset = (typeof PING_PRESETS)[number]['value'];

export const announceCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Admin: styled Embed-Ankündigung in einem Channel posten')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Target channel')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    )
    .addStringOption((o) => o.setName('title').setDescription('Title').setRequired(true).setMaxLength(256))
    .addStringOption((o) =>
      o.setName('message').setDescription('Body (\\n = Zeilenumbruch)').setRequired(true).setMaxLength(4000),
    )
    .addStringOption((o) =>
      o.setName('color').setDescription('Akzent-Farbe').addChoices(...COLOR_CHOICES),
    )
    .addStringOption((o) =>
      o.setName('ping').setDescription('Ping-Option (Preset)').addChoices(...PING_PRESETS),
    )
    .addRoleOption((o) =>
      o.setName('ping-role').setDescription('Custom-Rolle pingen (überschreibt Preset falls gesetzt)'),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages) as SlashCommandBuilder,
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel', true) as TextChannel;
    const title = interaction.options.getString('title', true);
    const message = interaction.options.getString('message', true);
    const colorKey = interaction.options.getString('color') ?? 'brand';
    const pingPreset = (interaction.options.getString('ping') ?? 'none') as PingPreset;
    const pingRoleOverride = interaction.options.getRole('ping-role');

    if (!interaction.guild) {
      await interaction.reply({ content: 'Nur in einem Server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const ping = resolvePing(interaction.guild, pingPreset, pingRoleOverride?.id, pingRoleOverride?.name);

    if (ping.parseTypes.includes('everyone') &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.MentionEveryone)) {
      await interaction.reply({
        content: '❌ Du brauchst `Mention @everyone/@here` Permission für diese Ping-Option.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(COLOR_MAP[colorKey] ?? Colors.brand)
      .setTitle(title)
      .setDescription(message.replaceAll('\\n', '\n'))
      .setFooter({ text: `Posted by ${interaction.user.tag}` })
      .setTimestamp(new Date());

    await channel.send({
      content: ping.content,
      embeds: [embed],
      allowedMentions: {
        roles: ping.roleIds,
        parse: ping.parseTypes,
      },
    });

    await interaction.reply({
      content: `✅ Gepostet in ${channel.toString()}${ping.content ? ` — mit Ping: ${ping.content}` : ''}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

interface ResolvedPing {
  content: string | undefined;
  roleIds: string[];
  parseTypes: ('roles' | 'users' | 'everyone')[];
}

function resolvePing(
  guild: Guild,
  preset: PingPreset,
  overrideRoleId: string | undefined,
  overrideRoleName: string | undefined,
): ResolvedPing {
  if (overrideRoleId) {
    return { content: `<@&${overrideRoleId}>`, roleIds: [overrideRoleId], parseTypes: [] };
  }
  if (preset === 'none') return { content: undefined, roleIds: [], parseTypes: [] };
  if (preset === 'everyone') return { content: '@everyone', roleIds: [], parseTypes: ['everyone'] };
  if (preset === 'here') return { content: '@here', roleIds: [], parseTypes: ['everyone'] };

  const role = guild.roles.cache.find((r) => r.name === preset);
  if (!role) return { content: undefined, roleIds: [], parseTypes: [] };
  return { content: `<@&${role.id}>`, roleIds: [role.id], parseTypes: [] };
}
