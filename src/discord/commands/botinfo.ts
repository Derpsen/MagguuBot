import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { db } from '../../db/client.js';
import { webhookEvents } from '../../db/schema.js';
import { Colors } from '../../embeds/colors.js';
import type { SlashCommand } from './index.js';

function formatUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export const botinfoCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription('Zeig Bot-Status, Uptime + Stats') as SlashCommandBuilder,
  async execute(interaction) {
    const mem = process.memoryUsage();
    const eventsTotal = db.select().from(webhookEvents).all().length;
    const e = new EmbedBuilder()
      .setColor(Colors.brand)
      .setAuthor({
        name: interaction.client.user?.tag ?? 'MagguuBot',
        iconURL: interaction.client.user?.displayAvatarURL(),
      })
      .setThumbnail(interaction.client.user?.displayAvatarURL({ size: 256 }) ?? null)
      .addFields(
        { name: 'Uptime', value: formatUptime(process.uptime()), inline: true },
        { name: 'Node', value: process.version, inline: true },
        { name: 'Memory', value: formatBytes(mem.heapUsed), inline: true },
        { name: 'Webhook-Events total', value: `${eventsTotal}`, inline: true },
        { name: 'Ping', value: `${Math.round(interaction.client.ws.ping)} ms`, inline: true },
        { name: 'Guilds', value: `${interaction.client.guilds.cache.size}`, inline: true },
      )
      .setFooter({ text: 'MagguuBot' })
      .setTimestamp(new Date());
    await interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
  },
};
