import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { buildCalendarEmbed } from '../../embeds/calendar.js';
import { getRadarrCalendar } from '../../services/radarr.js';
import { getSonarrCalendar } from '../../services/sonarr.js';
import type { SlashCommand } from './index.js';

export const calendarCommand: SlashCommand = {
  category: 'downloads',
  data: new SlashCommandBuilder()
    .setName('calendar')
    .setDescription('Kommende Episoden + Filme in den nächsten N Tagen')
    .addIntegerOption((o) =>
      o.setName('days').setDescription('Anzahl Tage (1-30, default 7)').setMinValue(1).setMaxValue(30),
    ) as SlashCommandBuilder,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const days = interaction.options.getInteger('days') ?? 7;
    const start = new Date();
    const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);

    const [sonarr, radarr] = await Promise.all([
      getSonarrCalendar(start.toISOString(), end.toISOString()).catch(() => []),
      getRadarrCalendar(start.toISOString(), end.toISOString()).catch(() => []),
    ]);

    await interaction.editReply({ embeds: [buildCalendarEmbed({ sonarr, radarr, days })] });
  },
};
