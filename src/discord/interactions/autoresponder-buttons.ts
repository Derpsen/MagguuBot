import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { autoresponders } from '../../db/schema.js';

export async function handleAutoresponderButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, rawId] = interaction.customId.split(':');
  if (action !== 'copy' || !rawId || !interaction.guildId) {
    await interaction.reply({ content: 'Unbekannte Aktion.', flags: MessageFlags.Ephemeral });
    return;
  }
  const id = Number(rawId);
  if (!Number.isFinite(id)) {
    await interaction.reply({ content: 'Ungültige Regel-ID.', flags: MessageFlags.Ephemeral });
    return;
  }

  const rule = db
    .select()
    .from(autoresponders)
    .where(and(eq(autoresponders.guildId, interaction.guildId), eq(autoresponders.id, id)))
    .get();
  if (!rule) {
    await interaction.reply({ content: 'Regel existiert nicht mehr.', flags: MessageFlags.Ephemeral });
    return;
  }

  const safe = rule.response.replace(/```/g, '``​`');
  const body = safe.length > 1900 ? safe.slice(0, 1900) + '…' : safe;
  await interaction.reply({
    content: `\`\`\`\n${body}\n\`\`\``,
    flags: MessageFlags.Ephemeral,
  });
}
