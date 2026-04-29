import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../../config.js';
import { buildPlexNowPlayingEmbed } from '../../embeds/plex-now-playing.js';
import { getActiveSessions } from '../../services/tautulli.js';
import type { SlashCommand } from './index.js';

export const plexNowPlayingCommand: SlashCommand = {
  category: 'downloads',
  data: new SlashCommandBuilder()
    .setName('plex-now-playing')
    .setDescription('Aktuelle Plex-Streams (User, Titel, Progress, Transcode-Status)') as SlashCommandBuilder,
  async execute(interaction) {
    if (!config.TAUTULLI_URL || !config.TAUTULLI_API_KEY) {
      await interaction.reply({
        content: '❌ Tautulli-API nicht konfiguriert. Setze `TAUTULLI_URL` und `TAUTULLI_API_KEY`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const sessions = await getActiveSessions();
    if (sessions === null) {
      await interaction.editReply('❌ Tautulli nicht erreichbar oder API-Fehler. Check Logs.');
      return;
    }

    await interaction.editReply({ embeds: [buildPlexNowPlayingEmbed(sessions)] });
  },
};
