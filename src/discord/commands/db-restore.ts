import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { MAX_RESTORE_BYTES, stageDatabaseRestore } from '../../db/restore.js';
import { readResponseBytesLimited } from '../../utils/http-body.js';
import { logger } from '../../utils/logger.js';
import type { SlashCommand } from './index.js';

export const dbRestoreCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('db-restore')
    .setDescription('Geprüftes SQLite-Backup für den nächsten Neustart vormerken')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addAttachmentOption((option) => option
      .setName('backup')
      .setDescription('Eine von /db-backup erzeugte .db-Datei')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('bestaetigung')
      .setDescription('Zum Bestätigen exakt RESTORE eingeben')
      .setRequired(true)) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Nur Administratoren.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.options.getString('bestaetigung', true) !== 'RESTORE') {
      await interaction.reply({ content: 'Abgebrochen: Bestätigung muss exakt `RESTORE` sein.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const attachment = interaction.options.getAttachment('backup', true);
    if (attachment.size > MAX_RESTORE_BYTES) {
      await interaction.editReply(`Backup ist größer als ${MAX_RESTORE_BYTES / 1024 / 1024} MB.`);
      return;
    }
    try {
      const response = await fetch(attachment.url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`download returned ${response.status}`);
      const buffer = await readResponseBytesLimited(response, MAX_RESTORE_BYTES);
      stageDatabaseRestore(buffer);
      await interaction.editReply(
        '✅ Backup geprüft und vorgemerkt. Starte den Container neu, um es zu übernehmen. '
        + 'Die aktuelle DB bleibt danach als `.pre-restore` erhalten.',
      );
    } catch (err) {
      logger.error({ err, attachmentName: attachment.name }, 'database restore staging failed');
      await interaction.editReply(`❌ Restore abgelehnt: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
