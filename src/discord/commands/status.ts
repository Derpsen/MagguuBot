import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../../config.js';
import { buildStatusEmbed, readBuildInfo } from '../../embeds/status.js';
import { lastWebhookBySource } from '../../server/status-snapshot.js';
import type { SlashCommand } from './index.js';

export const statusCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Uptime, Image-Version und letzter Webhook pro Quelle') as SlashCommandBuilder,
  async execute(interaction) {
    const embed = buildStatusEmbed({
      uptimeSeconds: process.uptime(),
      build: readBuildInfo(),
      lastWebhookAt: lastWebhookBySource(),
      staleHours: config.STATUS_STALE_HOURS,
      now: new Date(),
    });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
