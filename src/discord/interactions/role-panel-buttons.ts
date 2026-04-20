import { MessageFlags, type ButtonInteraction, type GuildMember } from 'discord.js';
import { logger } from '../../utils/logger.js';

export async function handleRolePanelButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, roleId] = interaction.customId.split(':');
  if (action !== 'toggle' || !roleId) {
    await interaction.reply({ content: 'Unbekannte Aktion.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: 'Nur in einem Server nutzbar.', flags: MessageFlags.Ephemeral });
    return;
  }

  const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
  if (!role) {
    await interaction.reply({
      content: 'Rolle existiert nicht mehr. Admin soll das Panel neu aufbauen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  const hasRole = member.roles.cache.has(role.id);

  try {
    if (hasRole) {
      await member.roles.remove(role, 'role-panel toggle');
      await interaction.reply({
        content: `❌ ${role.toString()} entfernt.`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await member.roles.add(role, 'role-panel toggle');
      await interaction.reply({
        content: `✅ ${role.toString()} zugewiesen.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (err) {
    logger.error({ err, roleId, userId: member.id }, 'role-panel toggle failed');
    await interaction.reply({
      content: 'Konnte die Rolle nicht ändern — Bot-Rolle muss über der Ziel-Rolle stehen.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
