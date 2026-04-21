import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../../config.js';
import { buildArrStatusEmbed } from '../../embeds/arr-status.js';
import {
  getRadarrDiskSpace,
  getRadarrHealth,
  getRadarrQueue,
  getRadarrStatus,
} from '../../services/radarr.js';
import { getSabQueue, getSabVersion } from '../../services/sabnzbd.js';
import { getSeerrRequestCount, getSeerrStatus } from '../../services/seerr.js';
import {
  getSonarrDiskSpace,
  getSonarrHealth,
  getSonarrQueue,
  getSonarrStatus,
} from '../../services/sonarr.js';
import type { SlashCommand } from './index.js';

export const arrStatusCommand: SlashCommand = {
  category: 'downloads',
  data: new SlashCommandBuilder()
    .setName('arr-status')
    .setDescription('Live-Snapshot von Sonarr/Radarr/SABnzbd/Seerr + Disk-Space + Health') as SlashCommandBuilder,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [
      sonarrStatus,
      sonarrQueue,
      sonarrHealth,
      sonarrDisk,
      radarrStatus,
      radarrQueue,
      radarrHealth,
      radarrDisk,
      sabVersion,
      sabQueue,
      seerrStatus,
      seerrCount,
    ] = await Promise.all([
      getSonarrStatus().catch(() => null),
      getSonarrQueue().catch(() => null),
      getSonarrHealth().catch(() => []),
      getSonarrDiskSpace().catch(() => []),
      getRadarrStatus().catch(() => null),
      getRadarrQueue().catch(() => null),
      getRadarrHealth().catch(() => []),
      getRadarrDiskSpace().catch(() => []),
      getSabVersion().catch(() => null),
      getSabQueue().catch(() => null),
      getSeerrStatus().catch(() => null),
      getSeerrRequestCount().catch(() => null),
    ]);

    const embed = buildArrStatusEmbed({
      sonarr: {
        configured: Boolean(config.SONARR_URL && config.SONARR_API_KEY),
        status: sonarrStatus,
        queueCount: sonarrQueue?.totalRecords ?? null,
        health: sonarrHealth,
        diskSpace: sonarrDisk,
      },
      radarr: {
        configured: Boolean(config.RADARR_URL && config.RADARR_API_KEY),
        status: radarrStatus,
        queueCount: radarrQueue?.totalRecords ?? null,
        health: radarrHealth,
        diskSpace: radarrDisk,
      },
      sab: {
        configured: Boolean(config.SAB_URL && config.SAB_API_KEY),
        version: sabVersion,
        queue: sabQueue,
      },
      seerr: {
        configured: Boolean(config.SEERR_URL && config.SEERR_API_KEY),
        status: seerrStatus,
        count: seerrCount,
      },
    });

    await interaction.editReply({ embeds: [embed] });
  },
};
