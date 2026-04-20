import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { db } from '../../db/client.js';
import { reminders } from '../../db/schema.js';
import type { SlashCommand } from './index.js';

const DURATION_RE = /^(\d+)\s*(s|sec|m|min|h|hour|d|day|w|week)s?$/i;

const MULTIPLIERS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  hour: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
};

const MAX_DURATION_MS = 90 * 86_400_000;

function parseDuration(input: string): number | null {
  const match = DURATION_RE.exec(input.trim());
  if (!match || !match[1] || !match[2]) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = MULTIPLIERS[unit];
  if (!multiplier || value <= 0) return null;
  return value * multiplier;
}

export const remindmeCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('remindme')
    .setDescription('Erinner mich in X Zeit an etwas (DM)')
    .addStringOption((o) =>
      o.setName('in').setDescription('z.B. "2h", "30min", "3d"').setRequired(true).setMaxLength(16),
    )
    .addStringOption((o) =>
      o.setName('was').setDescription('Was soll ich dir sagen?').setRequired(true).setMaxLength(500),
    ) as SlashCommandBuilder,
  async execute(interaction) {
    const durationRaw = interaction.options.getString('in', true);
    const message = interaction.options.getString('was', true);

    const durationMs = parseDuration(durationRaw);
    if (!durationMs) {
      await interaction.reply({
        content: 'Format: `<Zahl><Einheit>` wie `30s`, `15m`, `2h`, `3d`, `1w` — max 90d.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (durationMs > MAX_DURATION_MS) {
      await interaction.reply({
        content: 'Max 90 Tage.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const dueAt = new Date(Date.now() + durationMs);
    db.insert(reminders)
      .values({
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        message,
        dueAt,
      })
      .run();

    const ts = Math.floor(dueAt.getTime() / 1000);
    await interaction.reply({
      content: `⏰ Okay, ich erinner dich <t:${ts}:R> (<t:${ts}:f>).`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
