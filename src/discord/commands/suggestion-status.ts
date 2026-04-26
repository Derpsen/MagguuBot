import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { suggestions } from '../../db/schema.js';
import { buildSuggestionButtons, buildSuggestionEmbed, type SuggestionStatus } from '../../embeds/suggestion.js';
import { logger } from '../../utils/logger.js';
import { getClient } from '../client.js';
import type { SlashCommand } from './index.js';

const STATUS_CHOICES: Array<{ name: string; value: SuggestionStatus }> = [
  { name: 'Angenommen ✅', value: 'accepted' },
  { name: 'Abgelehnt ❌', value: 'denied' },
  { name: 'In Arbeit 🛠️', value: 'in-progress' },
  { name: 'Wieder öffnen 💡', value: 'open' },
];

export const suggestionStatusCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('suggestion-status')
    .setDescription('Setze den Status eines Vorschlags (Admin)')
    .addIntegerOption((o) =>
      o.setName('id').setDescription('Suggestion-ID (im Embed-Footer)').setRequired(true).setMinValue(1),
    )
    .addStringOption((o) =>
      o
        .setName('status')
        .setDescription('Neuer Status')
        .setRequired(true)
        .addChoices(...STATUS_CHOICES),
    )
    .addStringOption((o) =>
      o.setName('note').setDescription('Optionale Staff-Notiz im Embed').setMaxLength(800),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Guild only.', flags: MessageFlags.Ephemeral });
      return;
    }
    const id = interaction.options.getInteger('id', true);
    const status = interaction.options.getString('status', true) as SuggestionStatus;
    const note = interaction.options.getString('note') ?? undefined;

    const row = db
      .select()
      .from(suggestions)
      .where(and(eq(suggestions.guildId, interaction.guild.id), eq(suggestions.id, id)))
      .get();
    if (!row) {
      await interaction.reply({ content: `Suggestion #${id} nicht gefunden.`, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    db.update(suggestions)
      .set({ status, updatedAt: new Date() })
      .where(eq(suggestions.id, id))
      .run();

    try {
      const client = getClient();
      const channel = (await client.channels.fetch(row.channelId).catch(() => null)) as TextChannel | null;
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(row.messageId).catch(() => null);
        if (message) {
          const author = await client.users.fetch(row.authorId).catch(() => null);
          const embed = buildSuggestionEmbed({
            id: row.id,
            text: row.text,
            authorTag: author?.username ?? row.authorId,
            authorId: row.authorId,
            authorAvatarUrl: author?.displayAvatarURL() ?? '',
            status,
            upvotes: row.upvoters.length,
            downvotes: row.downvoters.length,
            staffNote: note,
          });
          const locked = status === 'accepted' || status === 'denied';
          await message.edit({ embeds: [embed], components: [buildSuggestionButtons(row.id, locked)] });
        }
      }
    } catch (err) {
      logger.warn({ err, id }, 'suggestion-status: failed to refresh embed');
    }

    await interaction.editReply(`✅ Suggestion #${id} → **${status}**${note ? ' (mit Notiz)' : ''}.`);
  },
};
