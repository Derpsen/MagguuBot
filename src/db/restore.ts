import {
  existsSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';

const REQUIRED_TABLES = ['webhook_events', 'channel_config', 'bot_settings'] as const;
export const MAX_RESTORE_BYTES = 50 * 1024 * 1024;

export function stagedRestorePath(): string {
  return `${resolve(config.DATABASE_PATH)}.restore`;
}

function removeSqliteSidecars(path: string): void {
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
}

export function validateDatabaseBackup(path: string): { ok: true } | { ok: false; error: string } {
  let database: Database.Database | null = null;
  try {
    database = new Database(path, { readonly: true, fileMustExist: true });
    const integrity = database.pragma('integrity_check') as Array<{ integrity_check?: string }>;
    if (integrity[0]?.integrity_check !== 'ok') return { ok: false, error: 'SQLite integrity_check failed' };
    const rows = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    const names = new Set(rows.map((row) => row.name));
    const missing = REQUIRED_TABLES.filter((table) => !names.has(table));
    if (missing.length) return { ok: false, error: `required tables missing: ${missing.join(', ')}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    database?.close();
  }
}

export function stageDatabaseRestore(buffer: Uint8Array): void {
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_RESTORE_BYTES) {
    throw new Error(`backup must be between 1 byte and ${MAX_RESTORE_BYTES / 1024 / 1024} MB`);
  }
  const target = stagedRestorePath();
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, buffer, { flag: 'wx' });
  try {
    const validation = validateDatabaseBackup(temporary);
    if (!validation.ok) throw new Error(validation.error);
    rmSync(target, { force: true });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
    removeSqliteSidecars(temporary);
  }
}

export function applyStagedDatabaseRestore(): boolean {
  const target = resolve(config.DATABASE_PATH);
  const staged = stagedRestorePath();
  if (!existsSync(staged)) return false;
  const validation = validateDatabaseBackup(staged);
  removeSqliteSidecars(staged);
  if (!validation.ok) {
    throw new Error(`staged database restore invalid: ${validation.error}`);
  }
  const previous = `${target}.pre-restore`;
  rmSync(previous, { force: true });
  if (existsSync(target)) {
    let current: Database.Database | null = null;
    try {
      current = new Database(target);
      current.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // A corrupt current database must not prevent restoring a valid backup.
    } finally {
      try {
        current?.close();
      } catch {
        // Rename below will surface a still-open file handle on affected platforms.
      }
    }
    renameSync(target, previous);
  }
  try {
    renameSync(staged, target);
    removeSqliteSidecars(target);
    return true;
  } catch (err) {
    if (!existsSync(target) && existsSync(previous)) renameSync(previous, target);
    throw err;
  }
}
