import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureJtcChannel } from '../jtc.js';
import { setSetting, getSetting } from '../../settings.js';
import type { SlashCommand } from './index.js';

export const jtcCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('jtc')
    .setDescription('Admin: Join-To-Create Voice einrichten / deaktivieren')
    .addSubcommand((s) =>
      s.setName('setup').setDescription('Erstellt VOICE-CREATE-Kategorie + ➕-Channel und aktiviert JTC'),
    )
    .addSubcommand((s) => s.setName('disable').setDescription('JTC deaktivieren'))
    .addSubcommand((s) => s.setName('status').setDescription('JTC-Status anzeigen'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Nur im Server.', flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { triggerChannelId, categoryId } = await ensureJtcChannel(interaction.guild);
      setSetting('jtcChannelId', triggerChannelId);
      setSetting('jtcCategoryId', categoryId);
      await interaction.editReply(
        `✅ JTC aktiviert.\n• Trigger-Channel: <#${triggerChannelId}>\n• Kategorie: <#${categoryId}>\n\n_User joinen den ➕-Channel → Bot erstellt persönlichen VC. Leer = wird auto-gelöscht._`,
      );
      return;
    }
    if (sub === 'disable') {
      setSetting('jtcChannelId', null);
      await interaction.reply({
        content: '🛑 JTC deaktiviert. Channels bleiben bestehen, müssen ggf. manuell gelöscht werden.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const triggerId = getSetting('jtcChannelId');
    const catId = getSetting('jtcCategoryId');
    await interaction.reply({
      content: triggerId
        ? `✅ JTC aktiv.\n• Trigger: <#${triggerId}>\n• Kategorie: ${catId ? `<#${catId}>` : '(automatisch)'}`
        : '🛑 JTC ist nicht konfiguriert. `/jtc setup` ausführen.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
