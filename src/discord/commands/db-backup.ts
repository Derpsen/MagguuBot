import { mkdir, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
const RETAINED_LARGE_BACKUPS = 5;

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
        const backupDir = join(dirname(resolve(config.DATABASE_PATH)), 'backups');
        await mkdir(backupDir, { recursive: true });
        const fileName = `magguu-bot-${timestamp}.db`;
        const savedPath = join(backupDir, fileName);
        await rename(tmpPath, savedPath);
        await pruneLargeBackups(backupDir);
        await interaction.editReply(
          `⚠️ DB ist **${sizeMb.toFixed(1)} MB** — zu groß für den Discord-Upload. `
          + `Ein konsistenter Snapshot liegt unter \`${savedPath}\`. Kopiere ihn mit `
          + `\`docker cp <container-name>:"${savedPath}" ./backup.db\`.`,
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

async function pruneLargeBackups(backupDir: string): Promise<void> {
  const entries = (await readdir(backupDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^magguu-bot-.*\.db$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const expired = entries.slice(0, Math.max(0, entries.length - RETAINED_LARGE_BACKUPS));
  await Promise.all(expired.map((name) => unlink(join(backupDir, name)).catch(() => {})));
}
