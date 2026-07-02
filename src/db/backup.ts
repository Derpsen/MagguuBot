import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { config } from '../config.js';
import { sqliteHandle } from './client.js';

export interface DatabaseSnapshot {
  path: string;
  fileName: string;
  size: number;
}

export function databaseBackupDirectory(): string {
  return join(dirname(resolve(config.DATABASE_PATH)), 'backups');
}

export async function createDatabaseSnapshot(prefix: 'automatic' | 'manual' = 'automatic'): Promise<DatabaseSnapshot> {
  const backupDir = databaseBackupDirectory();
  await mkdir(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${prefix}-${timestamp}.db`;
  const path = join(backupDir, fileName);
  try {
    await sqliteHandle.backup(path);
  } catch (error) {
    await unlink(path).catch(() => undefined);
    throw error;
  }
  const { size } = await stat(path);
  return { path, fileName, size };
}

export async function pruneDatabaseSnapshots(prefix: 'automatic' | 'manual', retain: number): Promise<number> {
  const backupDir = databaseBackupDirectory();
  const entries = await readdir(backupDir, { withFileTypes: true }).catch(() => []);
  const matching = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${prefix}-`) && entry.name.endsWith('.db'))
    .map((entry) => entry.name)
    .sort();
  const expired = matching.slice(0, Math.max(0, matching.length - retain));
  await Promise.all(expired.map((name) => unlink(join(backupDir, name))));
  return expired.length;
}
