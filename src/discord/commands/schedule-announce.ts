import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import { db } from '../../db/client.js';
import { scheduledAnnouncements } from '../../db/schema.js';
import type { SlashCommand } from './index.js';

const COLOR_CHOICES = [
  { name: 'Brand (lila)', value: 'brand' },
  { name: 'Info (blau)', value: 'info' },
  { name: 'Erfolg (grün)', value: 'success' },
  { name: 'Warnung (gelb)', value: 'warn' },
  { name: 'Danger (rot)', value: 'danger' },
] as const;

const DURATION_PATTERN = /^(\d+)([smhd])$/i;

function parseDuration(input: string): number | null {
  const m = DURATION_PATTERN.exec(input.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2]?.toLowerCase();
  const mult =
    unit === 's' ? 1000 :
    unit === 'm' ? 60_000 :
    unit === 'h' ? 3_600_000 :
    unit === 'd' ? 86_400_000 :
    0;
  return mult ? n * mult : null;
}

export const scheduleAnnounceCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('schedule-announce')
    .setDescription('Admin: Announcement für einen späteren Zeitpunkt einplanen')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Ziel-Channel')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('when').setDescription('Relativ: 5m / 2h / 1d. Oder ISO: 2026-05-01T18:00').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('title').setDescription('Titel').setRequired(true).setMaxLength(256),
    )
    .addStringOption((o) =>
      o.setName('message').setDescription('Body').setRequired(true).setMaxLength(3500),
    )
    .addStringOption((o) =>
      o.setName('color').setDescription('Akzent-Farbe').addChoices(...COLOR_CHOICES),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ content: 'Nur im Server.', flags: MessageFlags.Ephemeral });
      return;
    }
    const channel = interaction.options.getChannel('channel', true) as TextChannel;
    const when = interaction.options.getString('when', true);
    const title = interaction.options.getString('title', true);
    const message = interaction.options.getString('message', true);
    const color = interaction.options.getString('color') ?? 'brand';

    let fireAt: Date;
    const dur = parseDuration(when);
    if (dur !== null) {
      fireAt = new Date(Date.now() + dur);
    } else {
      const parsed = new Date(when);
      if (Number.isNaN(parsed.getTime())) {
        await interaction.reply({
          content: '❌ Zeit ungültig. Entweder Relativ (`5m`, `2h`, `1d`) oder ISO (`2026-05-01T18:00`).',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      fireAt = parsed;
    }

    if (fireAt.getTime() <= Date.now()) {
      await interaction.reply({
        content: '❌ Zeit liegt in der Vergangenheit.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const inserted = db
      .insert(scheduledAnnouncements)
      .values({
        guildId: interaction.guildId,
        channelId: channel.id,
        title,
        message,
        color,
        fireAt,
        fired: false,
        createdBy: interaction.user.id,
      })
      .returning({ id: scheduledAnnouncements.id })
      .get();

    await interaction.reply({
      content: `✅ Announcement **#${inserted?.id ?? '?'}** geplant: ${channel.toString()} am <t:${Math.floor(fireAt.getTime() / 1000)}:F> (<t:${Math.floor(fireAt.getTime() / 1000)}:R>).`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
