import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
} from 'discord.js';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { customCommands } from '../../db/schema.js';
import { Colors, truncate } from '../../embeds/colors.js';
import type { SlashCommand } from './index.js';

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,29}$/;

export const tagCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Custom text responses für FAQ-Antworten')
    .addSubcommand((s: SlashCommandSubcommandBuilder) =>
      s
        .setName('get')
        .setDescription('Tag abrufen und im Channel posten')
        .addStringOption((o) =>
          o.setName('name').setDescription('Tag-Name').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Admin: neuen Tag anlegen')
        .addStringOption((o) =>
          o.setName('name').setDescription('Name (a-z, 0-9, -)').setRequired(true).setMaxLength(30),
        )
        .addStringOption((o) =>
          o.setName('response').setDescription('Antwort-Text').setRequired(true).setMaxLength(2000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('Admin: Tag-Antwort ändern')
        .addStringOption((o) =>
          o.setName('name').setDescription('Tag-Name').setRequired(true).setAutocomplete(true),
        )
        .addStringOption((o) =>
          o.setName('response').setDescription('Neuer Antwort-Text').setRequired(true).setMaxLength(2000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('Admin: Tag löschen')
        .addStringOption((o) =>
          o.setName('name').setDescription('Tag-Name').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Alle Tags auflisten')) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ content: 'Nur im Server nutzbar.', flags: MessageFlags.Ephemeral });
      return;
    }

    const sub = interaction.options.getSubcommand(true);
    const guildId = interaction.guildId;

    if (sub === 'get') {
      const name = interaction.options.getString('name', true).toLowerCase();
      const tag = db
        .select()
        .from(customCommands)
        .where(and(eq(customCommands.guildId, guildId), eq(customCommands.name, name)))
        .get();
      if (!tag) {
        await interaction.reply({
          content: `❌ Tag \`${name}\` existiert nicht. \`/tag list\` zeigt alle.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      db.update(customCommands)
        .set({ uses: tag.uses + 1 })
        .where(and(eq(customCommands.guildId, guildId), eq(customCommands.name, name)))
        .run();

      await interaction.reply({ content: tag.response, allowedMentions: { parse: [] } });
      return;
    }

    if (sub === 'list') {
      const all = db
        .select()
        .from(customCommands)
        .where(eq(customCommands.guildId, guildId))
        .orderBy(desc(customCommands.uses))
        .limit(40)
        .all();

      if (all.length === 0) {
        await interaction.reply({
          content: 'Keine Tags. Erstelle einen mit `/tag add`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.brand)
        .setTitle('🏷️ Tags')
        .setDescription(
          all.map((t) => `**${t.name}** — \`${t.uses}\` uses\n${truncate(t.response, 80)}`).join('\n\n'),
        )
        .setFooter({ text: `${all.length} Tag(s) · /tag get name:<name>` });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Nur Admins.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'add') {
      const name = interaction.options.getString('name', true).toLowerCase();
      const response = interaction.options.getString('response', true);
      if (!NAME_PATTERN.test(name)) {
        await interaction.reply({
          content: '❌ Name darf nur a-z, 0-9 und `-` enthalten (max 30 Zeichen, Start a-z/0-9).',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const existing = db
        .select()
        .from(customCommands)
        .where(and(eq(customCommands.guildId, guildId), eq(customCommands.name, name)))
        .get();
      if (existing) {
        await interaction.reply({
          content: `❌ Tag \`${name}\` existiert schon. Nutze \`/tag edit\`.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      db.insert(customCommands)
        .values({ guildId, name, response, createdBy: interaction.user.id })
        .run();
      await interaction.reply({
        content: `✅ Tag \`${name}\` erstellt.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'edit') {
      const name = interaction.options.getString('name', true).toLowerCase();
      const response = interaction.options.getString('response', true);
      const result = db
        .update(customCommands)
        .set({ response, updatedAt: new Date() })
        .where(and(eq(customCommands.guildId, guildId), eq(customCommands.name, name)))
        .run();
      if (result.changes === 0) {
        await interaction.reply({
          content: `❌ Tag \`${name}\` existiert nicht.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        content: `✅ Tag \`${name}\` aktualisiert.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'delete') {
      const name = interaction.options.getString('name', true).toLowerCase();
      const result = db
        .delete(customCommands)
        .where(and(eq(customCommands.guildId, guildId), eq(customCommands.name, name)))
        .run();
      if (result.changes === 0) {
        await interaction.reply({
          content: `❌ Tag \`${name}\` existiert nicht.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        content: `🗑️ Tag \`${name}\` gelöscht.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

export function autocompleteTagNames(guildId: string, focused: string): Array<{ name: string; value: string }> {
  const rows = db
    .select()
    .from(customCommands)
    .where(eq(customCommands.guildId, guildId))
    .orderBy(desc(customCommands.uses))
    .limit(25)
    .all();
  const q = focused.toLowerCase();
  return rows
    .filter((r) => !q || r.name.includes(q))
    .slice(0, 25)
    .map((r) => ({ name: r.name, value: r.name }));
}
