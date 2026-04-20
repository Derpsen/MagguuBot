import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Colors, truncate } from '../../embeds/colors.js';
import { searchRadarr } from '../../services/radarr.js';
import { searchSonarr } from '../../services/sonarr.js';
import type { SlashCommand } from './index.js';

export const searchCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search Radarr (movies) or Sonarr (TV)')
    .addSubcommand((s) =>
      s
        .setName('movie')
        .setDescription('Search for a movie in Radarr')
        .addStringOption((o) => o.setName('query').setDescription('Title').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('show')
        .setDescription('Search for a TV show in Sonarr')
        .addStringOption((o) => o.setName('query').setDescription('Title').setRequired(true)),
    ) as SlashCommandBuilder,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand(true);
    const query = interaction.options.getString('query', true);

    if (sub === 'movie') {
      const results = await searchRadarr(query);
      if (results.length === 0) {
        await interaction.editReply(`No Radarr results for **${query}**.`);
        return;
      }
      const e = new EmbedBuilder()
        .setColor(Colors.radarr)
        .setAuthor({ name: 'Radarr  ·  Search' })
        .setTitle(`🎬  Top results for "${query}"`);
      for (const m of results.slice(0, 5)) {
        const poster = m.images?.find((i) => i.coverType === 'poster')?.remoteUrl;
        e.addFields({
          name: `${m.title}  ·  ${m.year}${m.id ? '  ·  (in library)' : ''}`,
          value: truncate(m.overview ?? '—', 400) + (poster ? `\n[poster](${poster})` : ''),
        });
      }
      await interaction.editReply({ embeds: [e] });
      return;
    }

    if (sub === 'show') {
      const results = await searchSonarr(query);
      if (results.length === 0) {
        await interaction.editReply(`No Sonarr results for **${query}**.`);
        return;
      }
      const e = new EmbedBuilder()
        .setColor(Colors.sonarr)
        .setAuthor({ name: 'Sonarr  ·  Search' })
        .setTitle(`📺  Top results for "${query}"`);
      for (const s of results.slice(0, 5)) {
        const poster = s.images?.find((i) => i.coverType === 'poster')?.remoteUrl;
        e.addFields({
          name: `${s.title}  ·  ${s.year}`,
          value: `_${s.status}_${poster ? `  ·  [poster](${poster})` : ''}`,
        });
      }
      await interaction.editReply({ embeds: [e] });
    }
  },
};
