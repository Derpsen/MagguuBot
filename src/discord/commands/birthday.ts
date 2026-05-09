import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import { getBirthday, getUpcomingBirthdays, setBirthday } from '../birthday.js';
import type { SlashCommand } from './index.js';

const MONTHS_DE = [
  'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez',
];

export const birthdayCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Geburtstag setzen / anschauen')
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Setz deinen Geburtstag (Tag/Monat, Jahr optional)')
        .addIntegerOption((o) =>
          o.setName('tag').setDescription('Tag (1-31)').setRequired(true).setMinValue(1).setMaxValue(31),
        )
        .addIntegerOption((o) =>
          o.setName('monat').setDescription('Monat (1-12)').setRequired(true).setMinValue(1).setMaxValue(12),
        )
        .addIntegerOption((o) =>
          o.setName('jahr').setDescription('Jahr (optional, für Alter-Anzeige)').setMinValue(1900).setMaxValue(2030),
        ),
    )
    .addSubcommand((s) => s.setName('show').setDescription('Zeig deinen gespeicherten Geburtstag'))
    .addSubcommand((s) =>
      s.setName('upcoming').setDescription('Nächste 10 anstehenden Geburtstage'),
    ) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Nur im Server.', flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const day = interaction.options.getInteger('tag', true);
      const month = interaction.options.getInteger('monat', true);
      const year = interaction.options.getInteger('jahr') ?? undefined;
      const date = new Date(year ?? 2000, month - 1, day);
      if (date.getDate() !== day || date.getMonth() !== month - 1) {
        await interaction.reply({ content: 'Ungültiges Datum.', flags: MessageFlags.Ephemeral });
        return;
      }
      setBirthday(interaction.guild.id, interaction.user.id, day, month, year);
      await interaction.reply({
        content: `🎂 Geburtstag gespeichert: **${day}. ${MONTHS_DE[month - 1]}${year ? ` ${year}` : ''}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'show') {
      const b = getBirthday(interaction.guild.id, interaction.user.id);
      if (!b) {
        await interaction.reply({
          content: 'Kein Geburtstag gespeichert. `/birthday set` ausführen.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        content: `🎂 Dein Geburtstag: **${b.day}. ${MONTHS_DE[b.month - 1]}${b.year ? ` ${b.year}` : ''}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'upcoming') {
      const list = getUpcomingBirthdays(interaction.guild.id, 10);
      if (list.length === 0) {
        await interaction.reply({
          content: 'Noch keine Geburtstage gespeichert.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const embed = new EmbedBuilder()
        .setColor(Colors.brand)
        .setTitle('🎂 Nächste Geburtstage')
        .setDescription(
          list
            .map((b) => `**${b.day}. ${MONTHS_DE[b.month - 1]}** — <@${b.userId}>`)
            .join('\n'),
        );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }
  },
};
