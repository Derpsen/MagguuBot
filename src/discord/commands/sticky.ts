import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import { clearSticky, listStickies, repostSticky, setSticky } from '../sticky.js';
import type { SlashCommand } from './index.js';

export const stickyCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Sticky-Nachrichten im Channel verwalten')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Sticky-Nachricht im aktuellen Channel setzen / überschreiben')
        .addStringOption((o) =>
          o
            .setName('content')
            .setDescription('Der Text (max 4000 Zeichen)')
            .setRequired(true)
            .setMaxLength(4000),
        ),
    )
    .addSubcommand((s) =>
      s.setName('remove').setDescription('Sticky aus dem aktuellen Channel entfernen'),
    )
    .addSubcommand((s) =>
      s.setName('list').setDescription('Alle aktiven Stickies im Server zeigen'),
    ) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guild || !interaction.channel || interaction.channel.isDMBased()) {
      await interaction.reply({ content: 'Nur in Server-Textkanälen.', flags: MessageFlags.Ephemeral });
      return;
    }

    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (sub === 'set') {
      const content = interaction.options.getString('content', true);
      const channel = interaction.channel as TextChannel;
      setSticky(channel.id, content, interaction.user.id);
      await repostSticky(channel, content);
      await interaction.editReply(`📌 Sticky in ${channel} gesetzt.`);
      return;
    }

    if (sub === 'remove') {
      const channel = interaction.channel as TextChannel;
      const existed = clearSticky(channel.id);
      await interaction.editReply(
        existed ? `🗑️ Sticky in ${channel} entfernt.` : `Kein Sticky in ${channel}.`,
      );
      return;
    }

    if (sub === 'list') {
      const all = listStickies();
      if (all.length === 0) {
        await interaction.editReply('Keine Stickies aktiv.');
        return;
      }
      const lines = all.map((s) => {
        const preview = s.content.length > 80 ? s.content.slice(0, 77) + '…' : s.content;
        return `<#${s.channelId}> — ${preview}`;
      });
      await interaction.editReply(`**Aktive Stickies (${all.length}):**\n${lines.join('\n')}`.slice(0, 1900));
      return;
    }
  },
};
