/**
 * Role/overwrite backup file: build, write (0600 + checksum), read, verify.
 * The file holds member → role id lists (needed to restore memberships). It is the ONLY place they are written:
 * CLI output carries counters only.
 */
import { chmod, mkdir, readdir, readFile, stat, writeFile, access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, cloneSnapshot, sha256, stateFingerprint, type RolesSnapshot } from './roles-model.js';

export const BACKUP_FORMAT = 'magguu-roles-backup/1';
export const BACKUP_MAX_AGE_MS = 60 * 60 * 1000;
const NAME = /^roles-backup-\d{8}-\d{6}\.json$/;

export interface RolesBackupBody {
  format: typeof BACKUP_FORMAT;
  createdAt: string;
  guildId: string;
  ownerId: string | null;
  botUserId: string;
  botHighestRolePosition: number;
  notes: string[];
  fingerprint: string;
  roles: RolesSnapshot['roles'];
  channels: RolesSnapshot['channels'];
  /** userId → role ids (members without roles are omitted). `null` = list was unreadable. */
  members: Record<string, string[]> | null;
}
export type RolesBackupFile = RolesBackupBody & { checksum: string };

export function buildBackup(snap: RolesSnapshot, now: Date): RolesBackupFile {
  const members = snap.members ? Object.fromEntries(Object.entries(snap.members).filter(([, r]) => r.length > 0)) : null;
  const body: RolesBackupBody = {
    format: BACKUP_FORMAT,
    createdAt: now.toISOString(),
    guildId: snap.guildId,
    ownerId: snap.ownerId,
    botUserId: snap.botUserId,
    botHighestRolePosition: snap.botHighestRolePosition,
    notes: snap.notes,
    fingerprint: stateFingerprint(snap),
    roles: snap.roles,
    channels: snap.channels,
    members,
  };
  return { ...body, checksum: sha256(canonicalJson(body)) };
}

export function backupFileName(now: Date): string {
  const iso = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `roles-backup-${iso}.json`;
}

/** Checks that the directory exists (created 0700) and is writable for the current uid; throws a readable error. */
export async function ensureWritableDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    await access(dir, constants.W_OK);
  } catch {
    throw new Error(`Backup-Verzeichnis ${dir} ist für uid ${process.getuid?.() ?? '?'} nicht beschreibbar (docker exec -u 99:100? Volume-Rechte prüfen)`);
  }
}

export async function writeBackup(dir: string, backup: RolesBackupFile): Promise<{ file: string; sha256File: string; bytes: number }> {
  await ensureWritableDir(dir);
  const file = join(dir, backupFileName(new Date(backup.createdAt)));
  const text = `${JSON.stringify(backup, null, 2)}\n`;
  await writeFile(file, text, { mode: 0o600, flag: 'wx' });
  await chmod(file, 0o600);
  const sidecar = `${file}.sha256`;
  await writeFile(sidecar, `${sha256(text)}  ${file.split('/').pop()}\n`, { mode: 0o600 });
  await chmod(sidecar, 0o600);
  return { file, sha256File: sha256(text), bytes: Buffer.byteLength(text) };
}

export interface BackupCheck {
  ok: boolean;
  problems: string[];
  backup: RolesBackupFile | null;
}

/** Parse + integrity (embedded checksum over canonical body). Never throws. */
export function parseBackup(text: string): BackupCheck {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, problems: ['Backup ist kein gültiges JSON'], backup: null };
  }
  const b = data as Partial<RolesBackupFile>;
  if (!b || b.format !== BACKUP_FORMAT || typeof b.checksum !== 'string' || !Array.isArray(b.roles) || !Array.isArray(b.channels)) {
    return { ok: false, problems: ['Backup hat nicht das erwartete Format'], backup: null };
  }
  const { checksum, ...body } = b as RolesBackupFile;
  if (sha256(canonicalJson(body)) !== checksum) return { ok: false, problems: ['Prüfsumme des Backups stimmt nicht (Datei verändert oder beschädigt)'], backup: null };
  return { ok: true, problems: [], backup: b as RolesBackupFile };
}

export async function readBackup(file: string): Promise<BackupCheck> {
  try {
    return parseBackup(await readFile(file, 'utf8'));
  } catch {
    return { ok: false, problems: ['Backup-Datei nicht lesbar'], backup: null };
  }
}

export async function latestBackupFile(dir: string): Promise<string | null> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => NAME.test(n)).sort();
  const last = names[names.length - 1];
  return last ? join(dir, last) : null;
}

/**
 * A backup is a valid safety net for `--execute` only when it is intact, from this guild, younger than 1 h AND still
 * describes the live roles/overwrites exactly (fingerprint) – otherwise it would not restore the state we are about to change.
 */
export function verifyFreshBackup(check: BackupCheck, live: RolesSnapshot, now: number, maxAgeMs = BACKUP_MAX_AGE_MS): string[] {
  if (!check.ok || !check.backup) return check.problems;
  const b = check.backup;
  const problems: string[] = [];
  if (b.guildId !== live.guildId) problems.push('Backup gehört zu einer anderen Guild');
  const age = now - Date.parse(b.createdAt);
  if (!Number.isFinite(age) || age < -60_000) problems.push('Backup-Zeitstempel ungültig');
  else if (age > maxAgeMs) problems.push(`Backup ist ${Math.round(age / 60_000)} min alt (erlaubt: ${Math.round(maxAgeMs / 60_000)} min) – bitte neu erstellen`);
  if (b.fingerprint !== stateFingerprint(live)) problems.push('Rollen/Kanalrechte haben sich seit dem Backup geändert – bitte neues Backup erstellen');
  return problems;
}

/** Backup → snapshot (for restore planning and round-trip tests). */
export function snapshotFromBackup(b: RolesBackupFile): RolesSnapshot {
  return cloneSnapshot({
    guildId: b.guildId, ownerId: b.ownerId, botUserId: b.botUserId, botHighestRolePosition: b.botHighestRolePosition,
    roles: b.roles, channels: b.channels, members: b.members, notes: b.notes,
  });
}

export async function fileMode(file: string): Promise<number> {
  return (await stat(file)).mode & 0o777;
}
