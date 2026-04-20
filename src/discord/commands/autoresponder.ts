import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
} from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { autoresponders } from '../../db/schema.js';
import { Colors, truncate } from '../../embeds/colors.js';
import type { SlashCommand } from './index.js';

const MATCH_CHOICES = [
  { name: 'substring (default — findet Text irgendwo in der Nachricht)', value: 'substring' },
  { name: 'word (nur als ganzes Wort)', value: 'word' },
  { name: 'regex (vollständig regulärer Ausdruck)', value: 'regex' },
] as const;

export const autoresponderCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('autoresponder')
    .setDescription('Admin: auto-reply-Regeln für Nachrichten (Pattern-Trigger)')
    .addSubcommand((s: SlashCommandSubcommandBuilder) =>
      s
        .setName('add')
        .setDescription('Neue Regel anlegen')
        .addStringOption((o) =>
          o.setName('pattern').setDescription('Text oder Regex').setRequired(true).setMaxLength(200),
        )
        .addStringOption((o) =>
          o.setName('response').setDescription('Antwort-Text').setRequired(true).setMaxLength(1500),
        )
        .addStringOption((o) =>
          o.setName('match').setDescription('Matching-Typ').addChoices(...MATCH_CHOICES),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Alle Regeln'))
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('Regel löschen')
        .addIntegerOption((o) => o.setName('id').setDescription('Regel-ID').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('toggle')
        .setDescription('Regel an/ausschalten')
        .addIntegerOption((o) => o.setName('id').setDescription('Regel-ID').setRequired(true)),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ content: 'Nur im Server.', flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand(true);
    const guildId = interaction.guildId;

    if (sub === 'add') {
      const pattern = interaction.options.getString('pattern', true);
      const response = interaction.options.getString('response', true);
      const matchType = (interaction.options.getString('match') ?? 'substring') as
        | 'substring'
        | 'word'
        | 'regex';

      if (matchType === 'regex') {
        try {
          new RegExp(pattern, 'i');
        } catch {
          await interaction.reply({
            content: '❌ Regex ungültig. Bitte syntaktisch prüfen.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      const inserted = db
        .insert(autoresponders)
        .values({
          guildId,
          pattern,
          response,
          matchType,
          enabled: true,
          createdBy: interaction.user.id,
        })
        .returning({ id: autoresponders.id })
        .get();

      await interaction.reply({
        content: `✅ Autoresponder **#${inserted?.id ?? '?'}** angelegt (${matchType}).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'list') {
      const rows = db.select().from(autoresponders).where(eq(autoresponders.guildId, guildId)).all();
      if (rows.length === 0) {
        await interaction.reply({
          content: 'Noch keine Autoresponder.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.brand)
        .setTitle('💬 Autoresponder')
        .setDescription(
          rows
            .map(
              (r) =>
                `**#${r.id}** ${r.enabled ? '🟢' : '⚪'} \`${r.matchType}\` → \`${truncate(r.pattern, 60)}\`\n→ ${truncate(r.response, 120)}`,
            )
            .join('\n\n'),
        );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'delete') {
      const id = interaction.options.getInteger('id', true);
      const result = db
        .delete(autoresponders)
        .where(and(eq(autoresponders.guildId, guildId), eq(autoresponders.id, id)))
        .run();
      await interaction.reply({
        content: result.changes > 0 ? `🗑️ #${id} gelöscht.` : `❌ #${id} nicht gefunden.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'toggle') {
      const id = interaction.options.getInteger('id', true);
      const row = db
        .select()
        .from(autoresponders)
        .where(and(eq(autoresponders.guildId, guildId), eq(autoresponders.id, id)))
        .get();
      if (!row) {
        await interaction.reply({ content: `❌ #${id} nicht gefunden.`, flags: MessageFlags.Ephemeral });
        return;
      }
      db.update(autoresponders)
        .set({ enabled: !row.enabled })
        .where(and(eq(autoresponders.guildId, guildId), eq(autoresponders.id, id)))
        .run();
      await interaction.reply({
        content: `✅ #${id} ist jetzt ${!row.enabled ? '🟢 aktiv' : '⚪ aus'}.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
