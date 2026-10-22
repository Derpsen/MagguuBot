import { MessageFlags, type ButtonInteraction, type GuildMember } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { findLayoutRole } from '../role-lookup.js';
import { PING_ROLE_BUTTONS, canonicalRoleName } from '../server-layout.js';

// Layout ping roles plus legacy names, so buttons on older panels keep working
// (legacy names resolve to their merged layout role).
const TOGGLEABLE = new Set([
  ...PING_ROLE_BUTTONS.map((b) => b.role),
  'ping-4k',
  'ping-anime',
  'ping-wow-tuning',
  'ping-wow-ptr',
  'ping-github',
  'Plex-Fan',
  'WoW-Fan',
  'MagguuUI',
]);

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

  const role = findLayoutRole(interaction.guild.roles.cache, roleName);
  if (!role) {
    await interaction.reply({
      content: `Rolle **${canonicalRoleName(roleName)}** existiert nicht. Lass einen Admin \`/setup-server\` ausführen.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  const hasRole = member.roles.cache.has(role.id);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (hasRole) {
      await member.roles.remove(role, 'role-picker button');
      await interaction.editReply({
        content: `❌ **${role.name}** entfernt. Du bekommst keine Pings mehr dazu.`,
      });
    } else {
      await member.roles.add(role, 'role-picker button');
      await interaction.editReply({
        content: `✅ **${role.name}** zugewiesen. Du wirst ab jetzt gepingt.`,
      });
    }
  } catch (err) {
    logger.error({ err, roleName, userId: member.id }, 'role toggle failed');
    await interaction.editReply({
      content: 'Konnte die Rolle nicht ändern — Bot-Rolle muss über der Ziel-Rolle stehen.',
    });
  }
}
