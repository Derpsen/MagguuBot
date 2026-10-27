/**
 * Read-only full backup of roles, channel overwrites and role memberships (REST GETs only).
 *
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-roles-backup.js [--out=DIR] [--json]
 *
 * Default directory: <DATABASE_PATH dir>/roles-backups (the mounted data volume, e.g. /app/data/roles-backups).
 * The JSON file (mode 0600) contains role/channel data and member → role id lists; it is the ONLY place member ids
 * are written. stdout shows counters, the path and the checksum. 2026-11-16: see roles-snapshot.ts.
 */
import { fileMode, buildBackup, writeBackup } from './roles-backup.js';
import { assertKnownOptions, defaultRolesBackupDir, fail, finish, loadRefs, loadSnapshot, makeRest, optionValue } from './roles-cli.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  assertKnownOptions(argv, ['--json'], ['--out']);
  const dir = optionValue(argv, '--out') ?? defaultRolesBackupDir();
  const refs = loadRefs();
  const snap = await loadSnapshot(makeRest('Rollen-Backup (nur lesen)'), refs);
  const backup = buildBackup(snap, new Date());
  const written = await writeBackup(dir, backup);
  const mode = (await fileMode(written.file)).toString(8);
  const summary = {
    file: written.file, mode, bytes: written.bytes, sha256: written.sha256File, checksum: backup.checksum, createdAt: backup.createdAt,
    roles: backup.roles.length, managedRoles: backup.roles.filter((r) => r.managed).length, channels: backup.channels.length,
    overwrites: backup.channels.reduce((n, c) => n + c.overwrites.length, 0),
    membersWithRoles: backup.members ? Object.keys(backup.members).length : null,
    notes: snap.notes,
  };
  if (process.argv.includes('--json')) return finish(0, `${JSON.stringify(summary)}\n`);
  finish(0, [
    'MagguuBot Rollen-Backup (nur gelesen, nichts verändert)',
    `Datei: ${summary.file} (Rechte ${summary.mode}, ${summary.bytes} Bytes)`,
    `SHA-256 der Datei: ${summary.sha256} (zusätzlich ${summary.file}.sha256)`,
    `Rollen ${summary.roles} (managed ${summary.managedRoles}) · Kanäle ${summary.channels} · Overwrites ${summary.overwrites} · Mitglieder mit Rollen ${summary.membersWithRoles ?? 'unbekannt'} (nur in der Datei, nie im Output)`,
    ...summary.notes.map((n) => `Hinweis: ${n}`),
    'Gültig für --execute: 60 min und nur solange sich Rollen/Kanalrechte nicht ändern (Fingerprint).',
    '',
  ].join('\n'));
}

main().catch(fail);
