import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { isNull, max } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { webhookEvents } from '../../db/schema.js';
import { buildStatusEmbed, readBuildInfo } from '../../embeds/status.js';
import type { SlashCommand } from './index.js';

// webhook_events already logs every inbound webhook (append-only, never auto-pruned),
// so the last-received time is a MAX() over it instead of a second store. Replay rows
// are excluded because they are not new deliveries from the source.
function lastWebhookBySource(): Map<string, Date> {
  const rows = db
    .select({ source: webhookEvents.source, last: max(webhookEvents.createdAt) })
    .from(webhookEvents)
    .where(isNull(webhookEvents.replayOfEventId))
    .groupBy(webhookEvents.source)
    .all();
  const out = new Map<string, Date>();
  for (const row of rows) {
    if (row.last instanceof Date) out.set(row.source, row.last);
    else if (typeof row.last === 'number') out.set(row.source, new Date(row.last));
  }
  return out;
}

export const statusCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Uptime, Image-Version und letzter Webhook pro Quelle') as SlashCommandBuilder,
  async execute(interaction) {
    const embed = buildStatusEmbed({
      uptimeSeconds: process.uptime(),
      build: readBuildInfo(),
      lastWebhookAt: lastWebhookBySource(),
      staleHours: config.STATUS_STALE_HOURS,
      now: new Date(),
    });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
