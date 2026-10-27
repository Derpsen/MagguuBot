/**
 * Declarative role clean-up: @everyone minimal, layout roles, merge of retired roles (member limit), deletion of
 * empty + unused roles, staff-only channels (logs/admin/bot/technical/activity). DRY-RUN IS THE DEFAULT.
 *
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-roles-apply.js                 # diff only
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-roles-apply.js --print-plan    # built-in plan as JSON
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-roles-apply.js --execute       # needs a fresh backup
 * Options: --plan=FILE (JSON, see --print-plan), --backup=FILE, --out=DIR, --max-members=N (default 25),
 *          --allow-missing-channels, --json.
 *
 * --execute refuses without an intact backup that is < 1 h old AND still matches the live roles/overwrites, and
 * whenever any hard gate fails (managed roles, bot/owner/admin access, references, member limit …). After the run
 * the live state is re-read and checked again; on failure it names the restore command. Audit reason: "Rollen-Aufräumen".
 */
import { readFile } from 'node:fs/promises';
import { buildInventory } from './roles-inventory.js';
import { readBackup, latestBackupFile, verifyFreshBackup } from './roles-backup.js';
import { checkInvariants, executeSteps, guardedUsers } from './roles-effects.js';
import { assertKnownOptions, defaultRolesBackupDir, fail, finish, loadRefs, loadSnapshot, makeRest, optionValue, protectedUserIds, AUDIT_REASON } from './roles-cli.js';
import { DEFAULT_MAX_MEMBERS, defaultRolesPlan, formatApplyPlan, parseRolesPlan, planRolesApply } from './roles-plan.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  assertKnownOptions(argv, ['--execute', '--print-plan', '--allow-missing-channels', '--json'], ['--plan', '--backup', '--out', '--max-members']);
  const planFile = optionValue(argv, '--plan');
  const plan = planFile ? parseRolesPlan(await readFile(planFile, 'utf8')) : defaultRolesPlan();
  if (argv.includes('--print-plan')) return finish(0, `${JSON.stringify(plan, null, 2)}\n`);
  const maxArg = optionValue(argv, '--max-members');
  if (maxArg !== undefined) {
    if (!/^\d+$/.test(maxArg)) throw new Error('--max-members erwartet eine ganze Zahl');
    plan.maxMembers = Number(maxArg);
  }
  const execute = argv.includes('--execute');
  const dir = optionValue(argv, '--out') ?? defaultRolesBackupDir();

  const refs = loadRefs();
  const rest = makeRest(AUDIT_REASON);
  const snap = await loadSnapshot(rest, refs, argv.includes('--allow-missing-channels'));
  const protectedIds = protectedUserIds();
  const result = planRolesApply(snap, plan, refs, { maxMembers: plan.maxMembers ?? DEFAULT_MAX_MEMBERS, protectedUserIds: protectedIds });
  const lines: string[] = [formatApplyPlan(result, execute ? 'execute' : 'dry-run')];
  const report: Record<string, unknown> = { mode: execute ? 'execute' : 'dry-run', steps: result.steps.length, skipped: result.skipped, violations: result.violations, counters: result.counters };

  const backupFile = optionValue(argv, '--backup') ?? (await latestBackupFile(dir));
  const check = backupFile ? await readBackup(backupFile) : { ok: false, problems: [`kein Backup in ${dir} (zuerst discord-roles-backup.js)`], backup: null };
  const backupProblems = verifyFreshBackup(check, snap, Date.now());
  lines.push(backupProblems.length ? `Backup: ✖ ${backupProblems.join('; ')}\n` : `Backup: ✔ ${backupFile} (frisch, Prüfsumme und Stand passen)\n`);
  report.backupOk = backupProblems.length === 0;

  if (!execute) {
    lines.push('Trockenlauf: es wurde nichts verändert. Ausführen mit --execute (nur mit frischem Backup, ohne Abbruch-Gründe).\n');
    return finish(result.violations.length ? 3 : 0, argv.includes('--json') ? `${JSON.stringify(report)}\n` : lines.join(''));
  }
  if (result.violations.length || backupProblems.length) {
    lines.push('ABGEBROCHEN: --execute verweigert (siehe oben). Es wurde nichts verändert.\n');
    return finish(3, argv.includes('--json') ? `${JSON.stringify(report)}\n` : lines.join(''));
  }
  if (!result.steps.length) return finish(0, lines.join(''));

  const exec = await executeSteps(rest, snap.guildId, result.steps);
  report.exec = exec;
  lines.push(`Ausgeführt: ${exec.done}/${result.steps.length} Schritte${exec.failed ? ` · FEHLER bei „${exec.failed.label}“ (${exec.failed.message}) → Abbruch, ${exec.notRun} nicht ausgeführt` : ''}\n`);
  const after = await loadSnapshot(rest, refs, argv.includes('--allow-missing-channels'));
  const post = checkInvariants(snap, after, { guardedUserIds: guardedUsers(snap, plan.visibility.staffRoles, protectedIds), postingChannelIds: refs.channelIds });
  const inv = buildInventory(after, refs, { staffRoleNames: plan.visibility.staffRoles });
  lines.push(`Nachprüfung: ${post.length ? `✖ ${post.join('; ')}` : '✔ Bot-/Owner-/Admin-/Mod-Zugriff unverändert, Bot hat Post-Rechte'} · Rollen jetzt ${inv.counters.roles}, leer ${inv.counters.empty}, ungenutzt ${inv.counters.unused}\n`);
  if (post.length || exec.failed) lines.push(`Rückweg: docker exec -u 99:100 MagguuBot node dist/rollout/discord-roles-restore.js --backup=${backupFile} (erst Trockenlauf, dann --execute)\n`);
  report.postCheck = post;
  finish(post.length ? 4 : exec.failed ? 2 : 0, argv.includes('--json') ? `${JSON.stringify(report)}\n` : lines.join(''));
}

main().catch(fail);
