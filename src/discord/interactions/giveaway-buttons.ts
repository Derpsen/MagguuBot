import { MessageFlags, type ButtonInteraction, type GuildMember } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { giveaways } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import { buildGiveawayEmbed } from '../giveaway.js';

export async function handleGiveawayButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, idRaw] = interaction.customId.split(':');
  const id = Number(idRaw);
  if (action !== 'enter' || !Number.isInteger(id) || id <= 0) {
    await interaction.reply({ content: 'Unbekannte Aktion.', flags: MessageFlags.Ephemeral });
    return;
  }

  const g = db.select().from(giveaways).where(eq(giveaways.id, id)).get();
  if (!g) {
    await interaction.reply({ content: 'Giveaway nicht gefunden.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (g.ended) {
    await interaction.reply({ content: 'Giveaway ist bereits beendet.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (g.requiredRoleId) {
    const member = interaction.member as GuildMember | null;
    if (!member?.roles.cache.has(g.requiredRoleId)) {
      await interaction.reply({
        content: `🔐 Du brauchst die Rolle <@&${g.requiredRoleId}> um teilzunehmen.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { roles: [] },
      });
      return;
    }
  }

  const userId = interaction.user.id;
  const set = new Set(g.participants);
  let message: string;
  if (set.has(userId)) {
    set.delete(userId);
    message = '↩️ Du hast deine Teilnahme zurückgezogen.';
  } else {
    set.add(userId);
    message = `🎉 Du nimmst jetzt am Giveaway **${g.prize}** teil!`;
  }
  const updatedParticipants = Array.from(set);
  db.update(giveaways).set({ participants: updatedParticipants }).where(eq(giveaways.id, g.id)).run();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const fresh = { ...g, participants: updatedParticipants };
    await interaction.message.edit({ embeds: [buildGiveawayEmbed(fresh, false)] });
  } catch (err) {
    logger.debug({ err, giveawayId: g.id }, 'giveaway message refresh failed');
  }

  await interaction.editReply({ content: message });
}
