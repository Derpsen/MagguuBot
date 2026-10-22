import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import { executeActions } from '../../rollout/execute.js';
import { describeAction, planRollout, type Action } from '../../rollout/plan.js';
import { ARCHIVE_CATEGORY_NAME } from '../server-layout.js';
import { clientRestFor, snapshotFromGuild } from './setup-server.js';
import type { SlashCommand } from './index.js';

const CONFIRM_MS = 60_000;

/** Only the archive part of the shared plan: move foreign channels into 🗄️ ARCHIV, hide empty legacy categories. */
function archiveActions(actions: Action[]): Action[] {
  return actions.filter((a) =>
    a.kind === 'archiveChannel'
    || a.kind === 'hideCategory'
    || (a.kind === 'createCategory' && a.name === ARCHIVE_CATEGORY_NAME),
  );
}

/**
 * `/cleanup-server` no longer deletes anything. It archives channels outside
 * the layout; final deletion is the gated rollout step
 * (`DELETE_APPROVED=yes node dist/rollout/discord-rollout.js --delete-archived --apply`).
 */
export const cleanupServerCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('cleanup-server')
    .setDescription(`Fremde Kanäle nach ${ARCHIVE_CATEGORY_NAME} verschieben (löscht nichts)`)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild) {
      await interaction.editReply('Dieser Befehl funktioniert nur auf einem Server.');
      return;
    }

    const snap = await snapshotFromGuild(interaction.guild);
    const actions = archiveActions(planRollout(snap).actions);
    if (actions.length === 0) {
      await interaction.editReply('✅ Nichts zu archivieren — alle Kanäle gehören zur MagguuBot-Struktur.');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.warn)
      .setTitle('Cleanup — archivieren')
      .setDescription(
        [
          `**${actions.length}** Schritt(e). Nachrichten bleiben erhalten, nichts wird gelöscht:`,
          '',
          actions.map((a) => `• ${describeAction(a)}`).join('\n').slice(0, 3600),
          '',
          'Klick **Bestätigen** innerhalb von 60s.',
        ].join('\n'),
      );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('cleanup:confirm').setLabel('Bestätigen').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('cleanup:cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
    );

    const reply = await interaction.editReply({ embeds: [embed], components: [row] });

    try {
      const button = await reply.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (b) => b.user.id === interaction.user.id,
        time: CONFIRM_MS,
      });

      if (button.customId === 'cleanup:cancel') {
        await button.update({ content: 'Abgebrochen.', embeds: [], components: [] });
        return;
      }

      await button.update({ content: '🗄️ Archiviere…', embeds: [], components: [] });
      const { results } = await executeActions(clientRestFor(interaction.guild), snap, actions, []);
      const ok = results.filter((r) => r.status === 'ok').length;
      const failed = results.filter((r) => r.status === 'error').length;
      await interaction.editReply(`✅ Fertig: **${ok}** archiviert/versteckt, **${failed}** Fehler.`);
    } catch {
      await interaction.editReply({ content: 'Zeit abgelaufen.', embeds: [], components: [] });
    }
  },
};
