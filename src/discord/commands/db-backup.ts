import { readFile, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { config } from '../../config.js';
import { sqliteHandle } from '../../db/client.js';
import { logger } from '../../utils/logger.js';
import type { SlashCommand } from './index.js';

const DISCORD_UPLOAD_LIMIT_MB = 10;

export const dbBackupCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('db-backup')
    .setDescription('SQLite-Backup als Attachment herunterladen (Admin-only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tmpPath = join(tmpdir(), `magguu-bot-${timestamp}.db`);

    try {
      await sqliteHandle.backup(tmpPath);

      const { size } = await stat(tmpPath);
      const sizeMb = size / (1024 * 1024);
      if (sizeMb > DISCORD_UPLOAD_LIMIT_MB) {
        await interaction.editReply(
          `⚠️ DB ist **${sizeMb.toFixed(1)} MB** — Discord-Upload-Limit ist ~${DISCORD_UPLOAD_LIMIT_MB} MB. Nutze stattdessen \`docker cp bot:/app${config.DATABASE_PATH.replace('./', '/')} ./backup.db\`.`,
        );
        return;
      }

      const buffer = await readFile(tmpPath);
      const file = new AttachmentBuilder(buffer, {
        name: `magguu-bot-${timestamp}.db`,
        description: `SQLite backup · ${sizeMb.toFixed(2)} MB`,
      });

      await interaction.editReply({
        content: `💾 Backup bereit · ${sizeMb.toFixed(2)} MB`,
        files: [file],
      });
    } catch (err) {
      logger.error({ err }, 'db-backup failed');
      await interaction.editReply(
        `❌ Backup fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  },
};
