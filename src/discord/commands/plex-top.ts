import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../../config.js';
import { buildPlexTopEmbed } from '../../embeds/plex-top.js';
import { getHomeStats, pickStatSection } from '../../services/tautulli.js';
import type { SlashCommand } from './index.js';

const TYPE_CHOICES = [
  { name: '🎬 Filme', value: 'movies' },
  { name: '📺 Serien', value: 'shows' },
  { name: '👥 User', value: 'users' },
] as const;

const DAYS_CHOICES = [
  { name: '24 Stunden', value: 1 },
  { name: '7 Tage', value: 7 },
  { name: '30 Tage', value: 30 },
  { name: '90 Tage', value: 90 },
  { name: 'All-time', value: 3650 },
] as const;

export const plexTopCommand: SlashCommand = {
  category: 'downloads',
  data: new SlashCommandBuilder()
    .setName('plex-top')
    .setDescription('Top Filme / Serien / User auf Plex (Tautulli-Stats)')
    .addStringOption((o) =>
      o.setName('type').setDescription('Was anzeigen').addChoices(...TYPE_CHOICES),
    )
    .addIntegerOption((o) =>
      o.setName('days').setDescription('Zeitraum').addChoices(...DAYS_CHOICES),
    ) as SlashCommandBuilder,
  async execute(interaction) {
    if (!config.TAUTULLI_URL || !config.TAUTULLI_API_KEY) {
      await interaction.reply({
        content: '❌ Tautulli-API nicht konfiguriert. Setze `TAUTULLI_URL` und `TAUTULLI_API_KEY`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const type = (interaction.options.getString('type') ?? 'movies') as 'movies' | 'shows' | 'users';
    const days = interaction.options.getInteger('days') ?? 7;

    const stats = await getHomeStats(days, 10);
    if (!stats) {
      await interaction.editReply('❌ Tautulli nicht erreichbar oder API-Fehler. Check Logs.');
      return;
    }

    const statId = type === 'movies' ? 'top_movies' : type === 'shows' ? 'top_tv' : 'top_users';
    const section = pickStatSection(stats, statId);

    await interaction.editReply({
      embeds: [buildPlexTopEmbed({ type, days, section })],
    });
  },
};
