/**
 * Roll back to a role backup: role names/colours/hoist/mentionable/permissions/positions, @everyone and channel
 * overwrites; deleted roles are re-created and their members re-assigned (only for roles re-created here).
 * DRY-RUN IS THE DEFAULT.
 *
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-roles-restore.js --backup=/app/data/roles-backups/roles-backup-….json
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-roles-restore.js --backup=… --execute
 * Options: --out=DIR (where the automatic pre-restore backup goes), --allow-missing-channels, --json.
 *
 * The backup checksum must match; managed roles are never touched; the same bot/owner/admin access gates as apply
 * run on the simulated and on the live result. Before --execute the current state is saved as a new backup.
 */
import { buildBackup, readBackup, snapshotFromBackup, writeBackup } from './roles-backup.js';
import { checkInvariants, executeSteps, guardedUsers } from './roles-effects.js';
import { assertKnownOptions, defaultRolesBackupDir, fail, finish, loadRefs, loadSnapshot, makeRest, optionValue, protectedUserIds, AUDIT_REASON } from './roles-cli.js';
import { formatRestorePlan, planRestore } from './roles-restore.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  assertKnownOptions(argv, ['--execute', '--allow-missing-channels', '--json'], ['--backup', '--out']);
  const file = optionValue(argv, '--backup');
  if (!file) throw new Error('--backup=<Datei> fehlt (siehe discord-roles-backup.js)');
  const execute = argv.includes('--execute');
  const check = await readBackup(file);
  if (!check.ok || !check.backup) return finish(3, `Backup unbrauchbar: ${check.problems.join('; ')}\n`);
  const backup = check.backup;

  const refs = loadRefs();
  const rest = makeRest(AUDIT_REASON);
  const live = await loadSnapshot(rest, refs, argv.includes('--allow-missing-channels'));
  const protectedIds = protectedUserIds();
  const plan = planRestore(snapshotFromBackup(backup), live, refs.channelIds, { protectedUserIds: protectedIds });
  const text = formatRestorePlan(plan, execute ? 'execute' : 'dry-run', { createdAt: backup.createdAt, roles: backup.roles.length, channels: backup.channels.length });
  const report = { mode: execute ? 'execute' : 'dry-run', steps: plan.steps.length, counters: plan.counters, skipped: plan.skipped, violations: plan.violations };
  if (!execute) return finish(plan.violations.length ? 3 : 0, argv.includes('--json') ? `${JSON.stringify(report)}\n` : `${text}Trockenlauf: nichts verändert. Zum Zurückspielen --execute.\n`);
  if (plan.violations.length) return finish(3, `${text}ABGEBROCHEN: --execute verweigert. Es wurde nichts verändert.\n`);
  if (!plan.steps.length) return finish(0, text);

  const safety = await writeBackup(optionValue(argv, '--out') ?? defaultRolesBackupDir(), buildBackup(live, new Date()));
  const exec = await executeSteps(rest, live.guildId, plan.steps);
  const after = await loadSnapshot(rest, refs, argv.includes('--allow-missing-channels'));
  const post = checkInvariants(live, after, { guardedUserIds: guardedUsers(live, ['Admin', 'Moderator'], protectedIds), postingChannelIds: refs.channelIds });
  const rest2 = planRestore(snapshotFromBackup(backup), after, refs.channelIds, { protectedUserIds: protectedIds });
  const out = [
    text,
    `Sicherung des Zustands vor dem Restore: ${safety.file}\n`,
    `Ausgeführt: ${exec.done}/${plan.steps.length} Schritte${exec.failed ? ` · FEHLER bei „${exec.failed.label}“ (${exec.failed.message}) → Abbruch, ${exec.notRun} nicht ausgeführt` : ''}\n`,
    `Nachprüfung: ${post.length ? `✖ ${post.join('; ')}` : '✔ Zugriff unverändert'} · Restabweichungen zum Backup: ${rest2.steps.length} (Positionen/Rollen über der Bot-Rolle bleiben ggf. offen)\n`,
  ].join('');
  finish(post.length ? 4 : exec.failed ? 2 : 0, argv.includes('--json') ? `${JSON.stringify({ ...report, exec, postCheck: post, remaining: rest2.steps.length })}\n` : out);
}

main().catch(fail);
