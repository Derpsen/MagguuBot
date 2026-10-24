import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { config } from '../../config.js';
import { getChannel } from '../channel-store.js';
import { getRaidReminders } from '../raid-reminders.js';
import { reminderCooldownLeft } from '../raid-reminder-manager.js';
import {
  KIND_LABEL,
  MAX_REMINDER_TEXT,
  WEEKDAY_NAMES,
  describeReminder,
  formatReminderTime,
  isReminderKind,
  parseReminderTime,
  sanitizeReminderText,
} from '../../utils/raid-reminder.js';
import type { SlashCommand } from './index.js';

async function reply(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

export const erinnerungCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('erinnerung')
    .setDescription('Erinnerungen für Raid, Mythic+ oder Sonstiges (wöchentlich oder einmalig, nur für dich)')
    .addSubcommand((s) =>
      s
        .setName('an')
        .setDescription('Neue Erinnerung anlegen')
        .addStringOption((o) =>
          o
            .setName('art')
            .setDescription('Worum geht es?')
            .setRequired(true)
            .addChoices(
              { name: 'Raid', value: 'raid' },
              { name: 'Mythic+', value: 'mythicplus' },
              { name: 'Sonstiges', value: 'other' },
            ),
        )
        .addIntegerOption((o) =>
          o
            .setName('tag')
            .setDescription('Wochentag')
            .setRequired(true)
            .addChoices(
              { name: 'Montag', value: 1 },
              { name: 'Dienstag', value: 2 },
              { name: 'Mittwoch', value: 3 },
              { name: 'Donnerstag', value: 4 },
              { name: 'Freitag', value: 5 },
              { name: 'Samstag', value: 6 },
              { name: 'Sonntag', value: 0 },
            ),
        )
        .addStringOption((o) =>
          o
            .setName('uhrzeit')
            .setDescription(`Uhrzeit, z. B. 19:45 (${config.TIME_ZONE})`)
            .setRequired(true)
            .setMaxLength(12),
        )
        .addStringOption((o) =>
          o.setName('text').setDescription(`Optionaler Text (max. ${MAX_REMINDER_TEXT} Zeichen)`).setMaxLength(300),
        )
        .addBooleanOption((o) =>
          o.setName('woechentlich').setDescription('Jede Woche wiederholen (Standard: nein, einmalig)'),
        )
        .addChannelOption((o) =>
          o
            .setName('kanal')
            .setDescription('Statt per DM in diesem Kanal erinnern (erwähnt nur dich)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((s) => s.setName('liste').setDescription('Deine Erinnerungen anzeigen'))
    .addSubcommand((s) =>
      s
        .setName('aus')
        .setDescription('Erinnerung abbestellen (ohne ID: alle deine Erinnerungen)')
        .addIntegerOption((o) => o.setName('id').setDescription('ID aus /erinnerung liste').setMinValue(1)),
    )
    .addSubcommand((s) =>
      s.setName('fortsetzen').setDescription('Pausierte Erinnerungen wieder aktivieren (z. B. nachdem du DMs erlaubt hast)'),
    ) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await reply(interaction, '❌ `/erinnerung` geht nur im Server.');
      return;
    }
    if (interaction.guildId !== config.DISCORD_GUILD_ID) {
      await reply(interaction, '❌ Erinnerungen gibt es nur auf dem Magguu-Server.');
      return;
    }
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const reminders = getRaidReminders();
    const sub = interaction.options.getSubcommand(true);

    if (sub === 'liste') {
      const rows = reminders.list(guildId, userId);
      if (rows.length === 0) {
        await reply(
          interaction,
          'Du hast keine Erinnerungen. Lege eine an mit `/erinnerung an` (Art, Tag, Uhrzeit).',
        );
        return;
      }
      const paused = rows.some((r) => r.pausedReason);
      const body = rows.map(describeReminder).join('\n\n');
      await reply(
        interaction,
        `**Deine Erinnerungen** (${rows.length}, Zeiten in ${config.TIME_ZONE})\n\n${body}${
          paused ? '\n\n💡 Pausierte Erinnerungen startest du mit `/erinnerung fortsetzen` neu.' : ''
        }\nAbbestellen: \`/erinnerung aus\``,
      );
      return;
    }

    if (sub === 'aus') {
      const id = interaction.options.getInteger('id') ?? undefined;
      const removed = reminders.remove(guildId, userId, id);
      if (removed === 0) {
        await reply(
          interaction,
          id === undefined ? 'Du hast keine Erinnerungen.' : `Keine Erinnerung #${id} von dir gefunden (siehe \`/erinnerung liste\`).`,
        );
        return;
      }
      await reply(
        interaction,
        id === undefined ? `✅ Alle ${removed} Erinnerungen abbestellt.` : `✅ Erinnerung #${id} abbestellt.`,
      );
      return;
    }

    if (sub === 'fortsetzen') {
      const resumed = reminders.resume(guildId, userId);
      await reply(
        interaction,
        resumed === 0
          ? 'Es ist nichts pausiert.'
          : `▶️ ${resumed} Erinnerung(en) wieder aktiv. Verpasste Termine werden nicht nachgeholt, die nächste Erinnerung kommt zum nächsten Termin.`,
      );
      return;
    }

    // sub === 'an'
    const kindRaw = interaction.options.getString('art', true);
    const day = interaction.options.getInteger('tag', true);
    const time = parseReminderTime(interaction.options.getString('uhrzeit', true));
    if (!isReminderKind(kindRaw) || day < 0 || day > 6) {
      await reply(interaction, '❌ Ungültige Eingabe.');
      return;
    }
    if (!time) {
      await reply(interaction, '❌ Uhrzeit nicht verstanden. Beispiele: `19:45`, `9:00`, `20 Uhr`.');
      return;
    }
    const cooldown = reminderCooldownLeft(userId);
    if (cooldown > 0) {
      await reply(interaction, `⏳ Bitte kurz warten (${Math.ceil(cooldown / 1000)} s).`);
      return;
    }

    let channelId: string | null = null;
    const channelOption = interaction.options.getChannel('kanal');
    if (channelOption) {
      if (channelOption.id === getChannel('addonUpdates')) {
        await reply(interaction, '❌ In diesem Kanal sind nur MagguuUI-Releases vorgesehen. Wähle einen anderen Kanal oder DM.');
        return;
      }
      const channel = await interaction.guild.channels.fetch(channelOption.id).catch(() => null);
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      const me = interaction.guild.members.me;
      const needed = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages;
      if (!channel || channel.isThread() || !member || !channel.permissionsFor(member)?.has(needed)) {
        await reply(interaction, '❌ In diesem Kanal darfst du selbst nicht schreiben.');
        return;
      }
      if (!me || !channel.permissionsFor(me)?.has(needed | PermissionFlagsBits.EmbedLinks)) {
        await reply(interaction, '❌ Der Bot darf in diesem Kanal nicht schreiben (Rechte: Ansehen, Senden, Links einbetten).');
        return;
      }
      channelId = channel.id;
    }

    const result = reminders.add({
      guildId,
      userId,
      kind: kindRaw,
      day,
      hour: time.hour,
      minute: time.minute,
      text: sanitizeReminderText(interaction.options.getString('text')),
      recurring: interaction.options.getBoolean('woechentlich') ?? false,
      channelId,
    });
    if (!result.ok) {
      await reply(
        interaction,
        result.reason === 'limit'
          ? `❌ Du hast schon ${result.limit} Erinnerungen (Maximum). Entferne eine mit \`/erinnerung aus\`.`
          : '❌ Genau diese Erinnerung hast du schon (siehe `/erinnerung liste`).',
      );
      return;
    }
    const r = result.reminder;
    const unix = Math.floor(r.nextDueAt / 1000);
    await reply(
      interaction,
      `✅ ${KIND_LABEL[r.kind]}-Erinnerung #${r.id} angelegt: ${WEEKDAY_NAMES[r.day]} ${formatReminderTime(r.hour, r.minute)} (${config.TIME_ZONE}), ${
        r.recurring ? 'jede Woche' : 'einmalig'
      }, ${r.channelId ? `in <#${r.channelId}>` : 'per DM'}.\nNächste: <t:${unix}:F> (<t:${unix}:R>)${
        r.channelId ? '' : '\nℹ️ Ich schreibe dir per DM – erlaube Direktnachrichten von Servermitgliedern, sonst pausiert die Erinnerung.'
      }`,
    );
  },
};
