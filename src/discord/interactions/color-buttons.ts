import { MessageFlags, type ButtonInteraction, type GuildMember } from 'discord.js';
import { logger } from '../../utils/logger.js';

const COLOR_ROLE_PREFIX = 'color-';
const KNOWN_COLOR_ROLES = new Set([
  'color-red',
  'color-orange',
  'color-amber',
  'color-green',
  'color-teal',
  'color-blue',
  'color-indigo',
  'color-purple',
  'color-pink',
  'color-slate',
]);

export async function handleColorButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, roleName] = interaction.customId.split(':');
  if (action !== 'toggle' || !roleName || !KNOWN_COLOR_ROLES.has(roleName)) {
    await interaction.reply({ content: 'Unbekannte Color-Rolle.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: 'Nur in einem Server nutzbar.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetRole = interaction.guild.roles.cache.find((r) => r.name === roleName);
  if (!targetRole) {
    await interaction.reply({
      content: `Color-Rolle **${roleName}** existiert nicht — Admin: \`/setup-server\` ausführen.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  const hasTarget = member.roles.cache.has(targetRole.id);

  try {
    const otherColorRoles = member.roles.cache.filter(
      (r) => r.name.startsWith(COLOR_ROLE_PREFIX) && r.id !== targetRole.id,
    );
    if (otherColorRoles.size > 0) {
      await member.roles.remove(otherColorRoles, 'color-picker exclusive');
    }

    if (hasTarget) {
      await member.roles.remove(targetRole, 'color-picker toggle off');
      await interaction.reply({
        content: `🎨 Farbe entfernt — du hast wieder die Default-Farbe.`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await member.roles.add(targetRole, 'color-picker toggle on');
      await interaction.reply({
        content: `🎨 **${roleName.replace(COLOR_ROLE_PREFIX, '')}** als Nickname-Farbe gesetzt.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (err) {
    logger.error({ err, roleName, userId: member.id }, 'color toggle failed');
    await interaction.reply({
      content: 'Konnte die Farbe nicht ändern — Bot-Rolle muss über den `color-*` Rollen stehen.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
