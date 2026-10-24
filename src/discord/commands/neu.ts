import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { neuCooldownLeft, plexNewService, renderNeu } from '../plex-new.js';
import { NEU_DEFAULT_DAYS, NEU_MAX_DAYS, NEU_MIN_DAYS, clampNeuDays, type NeuType } from '../../utils/plex-new.js';
import type { SlashCommand } from './index.js';

export const neuCommand: SlashCommand = {
  category: 'downloads',
  data: new SlashCommandBuilder()
    .setName('neu')
    .setDescription('Neu auf Plex: Filme und Serien der letzten Tage')
    .addIntegerOption((o) =>
      o
        .setName('tage')
        .setDescription(`Zeitraum in Tagen (${NEU_MIN_DAYS}–${NEU_MAX_DAYS}, Standard ${NEU_DEFAULT_DAYS})`)
        .setMinValue(NEU_MIN_DAYS)
        .setMaxValue(NEU_MAX_DAYS),
    )
    .addStringOption((o) =>
      o
        .setName('typ')
        .setDescription('Was anzeigen (Standard: alle)')
        .addChoices(
          { name: '🎬 Filme', value: 'movies' },
          { name: '📺 Serien', value: 'shows' },
          { name: '🆕 Alle', value: 'all' },
        ),
    ) as SlashCommandBuilder,
  async execute(interaction) {
    const left = neuCooldownLeft(interaction.user.id);
    if (left > 0) {
      await interaction.reply({
        content: `⏳ Bitte warte ${Math.ceil(left / 1000)} s, bevor du \`/neu\` erneut nutzt.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const days = clampNeuDays(interaction.options.getInteger('tage'));
    const type = (interaction.options.getString('typ') ?? 'all') as NeuType;
    const reply = await renderNeu(plexNewService, { page: 0, days, type, userId: interaction.user.id });
    if (!reply.ok) {
      await interaction.editReply({ content: reply.content });
      return;
    }
    await interaction.editReply({ embeds: reply.embeds, components: reply.components });
  },
};
