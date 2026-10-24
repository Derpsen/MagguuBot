import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { plexWeeklyChannelId, refreshPlexWeekly } from '../plex-weekly.js';
import type { SlashCommand } from './index.js';

const MESSAGES = {
  'not-configured': '⚠️ Wochenstatistik nicht eingerichtet (Tautulli oder Zielkanal fehlt).',
  error: '⚠️ Tautulli oder Discord hat nicht geantwortet. Die Karte bleibt unverändert, Details stehen im Log.',
  posted: '✅ Wochenstatistik-Karte gepostet',
  reposted: '✅ Wochenstatistik-Karte neu gepostet (die alte Nachricht war gelöscht)',
  edited: '🔄 Wochenstatistik-Karte aktualisiert',
  unchanged: 'ℹ️ Wochenstatistik unverändert, nichts geändert',
} as const;

export const wochenstatistikCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('wochenstatistik')
    .setDescription('Plex-Wochenstatistik-Karte jetzt aktualisieren')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: 'Dafür brauchst du „Server verwalten“.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await refreshPlexWeekly();
    const channel = plexWeeklyChannelId();
    const changed = result === 'posted' || result === 'reposted' || result === 'edited';
    await interaction.editReply(changed && channel ? `${MESSAGES[result]} in <#${channel}>.` : MESSAGES[result]);
  },
};
