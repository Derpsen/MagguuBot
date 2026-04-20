import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { buildQueueEmbed } from '../../embeds/queue.js';
import { getRadarrQueue } from '../../services/radarr.js';
import { getSabQueue } from '../../services/sabnzbd.js';
import { getSonarrQueue } from '../../services/sonarr.js';
import type { SlashCommand } from './index.js';

export const queueCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current Sonarr + Radarr + SABnzbd download queue') as SlashCommandBuilder,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [sonarr, radarr, sab] = await Promise.all([
      getSonarrQueue().catch(() => null),
      getRadarrQueue().catch(() => null),
      getSabQueue().catch(() => null),
    ]);
    await interaction.editReply({ embeds: [buildQueueEmbed({ sonarr, radarr, sab })] });
  },
};
