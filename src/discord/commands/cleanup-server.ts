import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import { KNOWN_CATEGORIES, isKnownChannelName } from './setup-server.js';
import type { SlashCommand } from './index.js';

const CONFIRM_MS = 60_000;

export const cleanupServerCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('cleanup-server')
    .setDescription('Alle Channels + Kategorien löschen, die nicht zur MagguuBot-Struktur gehören')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild) {
      await interaction.editReply('Guild only.');
      return;
    }

    const orphans = interaction.guild.channels.cache.filter((c) => {
      if (c.type === ChannelType.GuildCategory) {
        return !KNOWN_CATEGORIES.has(c.name);
      }
      if (c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice) {
        return !isKnownChannelName(c.name);
      }
      return false;
    });

    if (orphans.size === 0) {
      await interaction.editReply(
        '✅ Nichts zu löschen — alle Channels und Kategorien gehören zur MagguuBot-Struktur.',
      );
      return;
    }

    const list = orphans.map((c) => `• ${c.type === ChannelType.GuildCategory ? '📁' : c.type === ChannelType.GuildVoice ? '🔊' : '💬'} **${c.name}**`).join('\n');

    const embed = new EmbedBuilder()
      .setColor(Colors.danger)
      .setTitle('⚠️ Cleanup — zu löschen')
      .setDescription(
        [
          `**${orphans.size}** Channel(s) / Kategorie(n) sind nicht Teil der MagguuBot-Struktur:`,
          '',
          list.slice(0, 3800),
          '',
          '**Alle Messages in diesen Channels gehen verloren.**',
          '',
          'Klick **Bestätigen** innerhalb von 60s um zu löschen.',
        ].join('\n'),
      );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('cleanup:confirm')
        .setLabel('Bestätigen')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cleanup:cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
    );

    const reply = await interaction.editReply({ embeds: [embed], components: [row] });

    try {
      const button = await reply.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (b) => b.user.id === interaction.user.id,
        time: CONFIRM_MS,
      });

      if (button.customId === 'cleanup:cancel') {
        await button.update({ content: 'Abgebrochen.', embeds: [], components: [] });
        return;
      }

      await button.update({ content: '🧹 Lösche…', embeds: [], components: [] });

      let deleted = 0;
      let failed = 0;
      for (const ch of orphans.values()) {
        try {
          await ch.delete('MagguuBot /cleanup-server');
          deleted++;
        } catch {
          failed++;
        }
      }

      await interaction.editReply(
        `✅ Fertig: **${deleted}** gelöscht, **${failed}** Fehler.`,
      );
    } catch {
      await interaction.editReply({ content: 'Zeit abgelaufen.', embeds: [], components: [] });
    }
  },
};
