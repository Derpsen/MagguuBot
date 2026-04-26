import { MessageFlags, SlashCommandBuilder, type TextChannel } from 'discord.js';
import { db } from '../../db/client.js';
import { suggestions } from '../../db/schema.js';
import { buildSuggestionButtons, buildSuggestionEmbed } from '../../embeds/suggestion.js';
import { logger } from '../../utils/logger.js';
import { getChannel } from '../channel-store.js';
import { getClient } from '../client.js';
import type { SlashCommand } from './index.js';

export const suggestCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Reich einen Vorschlag im Vorschläge-Channel ein (mit Vote-Buttons)')
    .addStringOption((o) =>
      o.setName('text').setDescription('Dein Vorschlag (max 1500 Zeichen)').setRequired(true).setMaxLength(1500),
    ) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Guild only.', flags: MessageFlags.Ephemeral });
      return;
    }
    const channelId = getChannel('suggestions');
    if (!channelId) {
      await interaction.reply({
        content: 'Kein Vorschläge-Channel konfiguriert. Admin: `/setup-server` ausführen.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const text = interaction.options.getString('text', true).trim();
    if (text.length < 10) {
      await interaction.reply({
        content: 'Bitte mindestens 10 Zeichen — beschreib deinen Vorschlag etwas ausführlicher.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const client = getClient();
      const channel = (await client.channels.fetch(channelId).catch(() => null)) as TextChannel | null;
      if (!channel?.isSendable()) {
        await interaction.editReply('Vorschläge-Channel ist gerade nicht erreichbar.');
        return;
      }

      const inserted = db
        .insert(suggestions)
        .values({
          guildId: interaction.guild.id,
          channelId,
          messageId: 'pending',
          authorId: interaction.user.id,
          text,
          status: 'open',
          upvoters: [],
          downvoters: [],
        })
        .returning({ id: suggestions.id })
        .get();

      if (!inserted) throw new Error('insert failed');

      const embed = buildSuggestionEmbed({
        id: inserted.id,
        text,
        authorTag: interaction.user.username,
        authorId: interaction.user.id,
        authorAvatarUrl: interaction.user.displayAvatarURL(),
        status: 'open',
        upvotes: 0,
        downvotes: 0,
      });
      const buttons = buildSuggestionButtons(inserted.id);

      const message = await channel.send({ embeds: [embed], components: [buttons] });

      db.update(suggestions).set({ messageId: message.id, updatedAt: new Date() }).run();

      await interaction.editReply(`✅ Vorschlag #${inserted.id} eingereicht: ${message.url}`);
    } catch (err) {
      logger.error({ err, userId: interaction.user.id }, 'suggest command failed');
      await interaction.editReply('Konnte Vorschlag nicht einreichen — Bot-Logs checken.');
    }
  },
};
