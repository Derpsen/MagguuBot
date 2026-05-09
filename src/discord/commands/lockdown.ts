import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import { logger } from '../../utils/logger.js';
import { getChannel } from '../channel-store.js';
import { postModLog } from '../mod-log.js';
import type { SlashCommand } from './index.js';

export const lockdownCommand: SlashCommand = {
  category: 'moderation',
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Notfall: Server lockdown / unlock')
    .addSubcommand((s) =>
      s
        .setName('on')
        .setDescription('Sperrt SendMessages für @everyone in allen Text-Channels')
        .addStringOption((o) => o.setName('grund').setDescription('Begründung').setMaxLength(300)),
    )
    .addSubcommand((s) => s.setName('off').setDescription('Lockdown aufheben'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Nur im Server.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    const everyone = interaction.guild.roles.everyone;
    let changed = 0;
    const reason = interaction.options.getString('grund') ?? undefined;

    for (const channel of interaction.guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildText) continue;
      try {
        if (sub === 'on') {
          await channel.permissionOverwrites.edit(everyone, { SendMessages: false }, {
            reason: `lockdown by ${interaction.user.username}`,
          });
        } else {
          await channel.permissionOverwrites.edit(everyone, { SendMessages: null }, {
            reason: `lockdown lift by ${interaction.user.username}`,
          });
        }
        changed++;
      } catch (err) {
        logger.warn({ err, channelId: channel.id }, 'lockdown overwrite failed');
      }
    }

    await postModLog({
      guild: interaction.guild,
      action: sub === 'on' ? 'lockdown' : 'unlock',
      moderator: interaction.user,
      reason,
      extra: [{ name: 'Channels betroffen', value: `${changed}`, inline: true }],
    });

    const announcementChannelId = getChannel('auditLog') ?? getChannel('modLog');
    if (announcementChannelId) {
      const ch = await interaction.guild.channels.fetch(announcementChannelId).catch(() => null);
      if (ch?.isSendable()) {
        await (ch as TextChannel).send({
          embeds: [
            new EmbedBuilder()
              .setColor(sub === 'on' ? Colors.danger : Colors.success)
              .setTitle(sub === 'on' ? '🔒 Server gesperrt' : '🔓 Lockdown aufgehoben')
              .setDescription(
                sub === 'on'
                  ? `${interaction.user.toString()} hat den Server gesperrt — keine User können posten.${
                      reason ? `\n\nGrund: **${reason}**` : ''
                    }`
                  : `${interaction.user.toString()} hat die Sperre aufgehoben.`,
              )
              .setTimestamp(new Date()),
          ],
        });
      }
    }

    await interaction.editReply(
      `✅ ${sub === 'on' ? 'Lockdown aktiviert' : 'Lockdown aufgehoben'} — ${changed} Channels betroffen.`,
    );
  },
};
