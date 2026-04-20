import { MessageFlags, type ButtonInteraction, type GuildMember } from 'discord.js';
import { logger } from '../../utils/logger.js';

const TOGGLEABLE = new Set(['ping-movies', 'ping-series', 'ping-4k']);

export async function handleRoleButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, roleName] = interaction.customId.split(':');
  if (action !== 'toggle' || !roleName || !TOGGLEABLE.has(roleName)) {
    await interaction.reply({ content: 'Unbekannte Aktion.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: 'Nur in einem Server nutzbar.', flags: MessageFlags.Ephemeral });
    return;
  }

  const role = interaction.guild.roles.cache.find((r) => r.name === roleName);
  if (!role) {
    await interaction.reply({
      content: `Rolle **${roleName}** existiert nicht. Lass einen Admin \`/setup-server\` ausführen.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  const hasRole = member.roles.cache.has(role.id);

  try {
    if (hasRole) {
      await member.roles.remove(role, 'role-picker button');
      await interaction.reply({
        content: `❌ **${roleName}** entfernt. Du bekommst keine Pings mehr dazu.`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await member.roles.add(role, 'role-picker button');
      await interaction.reply({
        content: `✅ **${roleName}** zugewiesen. Du wirst ab jetzt gepingt.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (err) {
    logger.error({ err, roleName, userId: member.id }, 'role toggle failed');
    await interaction.reply({
      content: 'Konnte die Rolle nicht ändern — Bot-Rolle muss über der Ziel-Rolle stehen.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
