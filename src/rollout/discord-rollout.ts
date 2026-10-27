/**
 * One-shot Discord server rollout for the lean layout (src/discord/server-layout.ts).
 *
 * Run INSIDE the bot container (token + guild come from its env, never printed):
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-rollout.js --dry-run
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-rollout.js --apply
 *   docker exec -u 99:100 -e DELETE_APPROVED=yes MagguuBot node dist/rollout/discord-rollout.js --delete-archived --dry-run
 *   docker exec -u 99:100 -e DELETE_APPROVED=yes MagguuBot node dist/rollout/discord-rollout.js --delete-archived --dry-run --count-messages
 *   docker exec -u 99:100 -e DELETE_APPROVED=yes MagguuBot node dist/rollout/discord-rollout.js --delete-archived --apply
 *
 * Default is --dry-run. Idempotent: a second --apply plans nothing. Rate-limit
 * aware (429 retry_after, bucket reset). Never calls /cleanup-server. Deletion
 * is a separate step, gated by --delete-archived AND DELETE_APPROVED=yes, and
 * only touches channels inside 🗄️ ARCHIV without open bot cards plus empty
 * non-layout roles/categories. `--count-messages` (only with --delete-archived) adds a read-only inventory
 * per archived channel (message count up to 500+, newest message date); it never changes anything.
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.js';
import { sqliteHandle } from '../db/client.js';
import { createDatabaseSnapshot, databaseBackupDirectory } from '../db/backup.js';
import { executeActions, executeDeletion } from './execute.js';
import { describeAction, planDeletion, planRollout } from './plan.js';
import { describeInventory, inventoryChannel, type ChannelInventory } from './inventory.js';
import { DiscordRest, takeSnapshot } from './rest.js';

interface Args {
  apply: boolean;
  deleteArchived: boolean;
  countMessages: boolean;
  ignoreRetryQueue: boolean;
  jsonOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const known = new Set(['--apply', '--dry-run', '--delete-archived', '--count-messages', '--ignore-retry-queue', '--json']);
  for (const arg of argv) {
    if (!known.has(arg)) throw new Error(`Unbekannte Option: ${arg} (erlaubt: ${[...known].join(', ')})`);
  }
  if (argv.includes('--apply') && argv.includes('--dry-run')) throw new Error('--apply und --dry-run schließen sich aus');
  if (argv.includes('--count-messages') && !argv.includes('--delete-archived')) throw new Error('--count-messages gehört zu --delete-archived');
  return {
    apply: argv.includes('--apply'),
    deleteArchived: argv.includes('--delete-archived'),
    countMessages: argv.includes('--count-messages'),
    ignoreRetryQueue: argv.includes('--ignore-retry-queue'),
    jsonOnly: argv.includes('--json'),
  };
}

// ─── Preflight ───────────────────────────────────────────────────────────
interface Preflight {
  retryQueuePending: number;
  latestBackup: { file: string; ageMinutes: number } | null;
  backupCreated: string | null;
}

async function latestBackup(): Promise<Preflight['latestBackup']> {
  const dir = databaseBackupDirectory();
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.db')).sort();
  let best: { file: string; mtime: number } | null = null;
  for (const name of names) {
    const s = await stat(join(dir, name)).catch(() => null);
    if (s && (!best || s.mtimeMs > best.mtime)) best = { file: name, mtime: s.mtimeMs };
  }
  return best ? { file: best.file, ageMinutes: Math.round((Date.now() - best.mtime) / 60_000) } : null;
}

function retryQueuePending(): number {
  const row = sqliteHandle.prepare("SELECT COUNT(*) AS n FROM webhook_events WHERE retry_state = 'pending'").get() as { n: number } | undefined;
  return row?.n ?? 0;
}

// ─── Open-card blockers for the delete step ──────────────────────────────
const CARD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function safeAll(sql: string, ...params: unknown[]): Array<Record<string, unknown>> {
  try {
    return sqliteHandle.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

export function collectBlockers(guildId: string, now = Date.now()): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (id: unknown, reason: string): void => {
    if (typeof id !== 'string' || !/^\d{17,20}$/.test(id)) return;
    const list = out[id] ?? [];
    if (!list.includes(reason)) list.push(reason);
    out[id] = list;
  };
  const cutoff = now - CARD_WINDOW_MS;
  for (const r of safeAll('SELECT key, channel_id FROM channel_config WHERE guild_id = ?', guildId)) add(r.channel_id, `Bot-Key ${String(r.key)}`);
  for (const r of safeAll("SELECT channel_id, lifecycle_channel_id FROM seerr_requests WHERE status IN ('pending','approved')")) {
    add(r.channel_id, 'offene Anfrage-Karte');
    add(r.lifecycle_channel_id, 'offene Anfrage-Karte');
  }
  for (const r of safeAll('SELECT channel_id FROM plex_activity_messages WHERE updated_at > ?', cutoff)) add(r.channel_id, 'Plex-Aktivitätskarte < 7 T.');
  for (const r of safeAll('SELECT channel_id FROM event_lifecycle_messages WHERE updated_at > ?', cutoff)) add(r.channel_id, 'Lifecycle-Karte < 7 T.');
  for (const r of safeAll('SELECT channel_id FROM live_panels WHERE enabled = 1')) add(r.channel_id, 'Live-Karte');
  for (const r of safeAll("SELECT channel_id FROM movie_nights WHERE status = 'open'")) add(r.channel_id, 'Movie-Night offen');
  for (const r of safeAll("SELECT channel_id FROM suggestions WHERE status IN ('open','in-progress')")) add(r.channel_id, 'Vorschlag offen');
  for (const r of safeAll('SELECT channel_id, required_role_id FROM giveaways WHERE ended = 0')) {
    add(r.channel_id, 'Giveaway läuft');
    add(r.required_role_id, 'Giveaway-Rolle');
  }
  for (const r of safeAll('SELECT channel_id FROM countdowns WHERE finished = 0')) add(r.channel_id, 'Countdown läuft');
  for (const r of safeAll("SELECT channel_id FROM scheduled_announcements WHERE fired = 0 OR recurrence != 'none'")) add(r.channel_id, 'geplante Ankündigung');
  for (const r of safeAll('SELECT channel_id FROM reminders WHERE channel_id IS NOT NULL')) add(r.channel_id, 'Erinnerung');
  for (const r of safeAll('SELECT channel_id FROM tickets WHERE closed_at IS NULL')) add(r.channel_id, 'offenes Ticket');
  for (const r of safeAll('SELECT channel_id FROM rss_feeds')) add(r.channel_id, 'RSS-Feed');
  for (const r of safeAll('SELECT channel_id FROM sticky_messages')) add(r.channel_id, 'Sticky-Nachricht');
  for (const r of safeAll('SELECT channel_id, roles FROM role_panels')) {
    add(r.channel_id, 'Rollen-Panel');
    for (const id of String(r.roles ?? '').match(/\d{17,20}/g) ?? []) add(id, 'Rollen-Panel');
  }
  for (const r of safeAll("SELECT channel_id FROM webhook_events WHERE retry_state = 'pending'")) add(r.channel_id, 'Webhook-Retry offen');
  for (const r of safeAll('SELECT key, value FROM bot_settings WHERE guild_id = ?', guildId)) add(r.value, `Bot-Einstellung ${String(r.key)}`);
  for (const id of (config.FAQ_AUTOANSWER_CHANNEL_IDS ?? '').split(/[\s,]+/)) add(id, 'FAQ_AUTOANSWER_CHANNEL_IDS');
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main(): Promise<{ code: number; output: string }> {
  const args = parseArgs(process.argv.slice(2));
  const token = config.DISCORD_TOKEN;
  const guildId = config.DISCORD_GUILD_ID;
  const mode = args.deleteArchived ? (args.apply ? 'delete-apply' : 'delete-dry-run') : args.apply ? 'apply' : 'dry-run';
  const rest = new DiscordRest(token);
  const report: Record<string, unknown> = { mode, guildId, startedAt: new Date().toISOString() };
  const lines: string[] = [`MagguuBot Discord-Rollout · Modus: ${mode}`];
  let exitCode = 0;

  const preflight: Preflight = { retryQueuePending: retryQueuePending(), latestBackup: await latestBackup(), backupCreated: null };
  report.preflight = preflight;
  lines.push(`Preflight: Retry-Queue offen ${preflight.retryQueuePending} · letztes Backup ${preflight.latestBackup ? `${preflight.latestBackup.file} (vor ${preflight.latestBackup.ageMinutes} min)` : 'keins'}`);

  const { snap, notes } = await takeSnapshot(rest, guildId);
  report.notes = notes;
  for (const n of notes) lines.push(`Hinweis: ${n}`);

  if (args.deleteArchived) {
    const approved = process.env.DELETE_APPROVED === 'yes';
    const plan = planDeletion(snap, collectBlockers(guildId));
    report.deletion = plan;
    report.deleteApproved = approved;
    lines.push(`Löschen: ${plan.channels.length} Kanäle, ${plan.categories.length} Kategorien, ${plan.roles.length} Rollen · übersprungen: ${plan.skippedChannels.length} Kanäle, ${plan.skippedRoles.length} Rollen`);
    // Read-only inventory (opt-in): message count and newest message per archived channel, deletable and kept ones.
    const inventory: Record<string, ChannelInventory> = {};
    if (args.countMessages) {
      for (const c of [...plan.channels, ...plan.skippedChannels]) inventory[c.id] = await inventoryChannel(rest, c.id);
      report.inventory = inventory;
    }
    const inv = (id: string): string => (inventory[id] ? describeInventory(inventory[id]!) : '');
    for (const c of plan.channels) lines.push(`  - Kanal ${c.name} (${c.id})${inv(c.id)}`);
    for (const c of plan.categories) lines.push(`  - Kategorie ${c.name} (${c.id})`);
    for (const r of plan.roles) lines.push(`  - Rolle ${r.name} (${r.id})`);
    for (const c of plan.skippedChannels) lines.push(`  · behalten: ${c.name} (${c.id}): ${c.reasons.join(', ')}${inv(c.id)}`);
    for (const r of plan.skippedRoles) lines.push(`  · behalten: Rolle ${r.name}: ${r.reason}`);
    if (!approved) lines.push('DELETE_APPROVED=yes fehlt: es wird nichts gelöscht.');
    if (args.apply) {
      if (!approved) {
        exitCode = 3;
      } else {
        const backup = await createDatabaseSnapshot('manual');
        preflight.backupCreated = backup.fileName;
        lines.push(`DB-Backup vor dem Löschen: ${backup.fileName}`);
        const results = await executeDeletion(rest, guildId, plan);
        report.results = results;
        for (const r of results) lines.push(`  [${r.status}] ${r.action}${r.detail ? ` – ${r.detail}` : ''}`);
        if (results.some((r) => r.status === 'error')) exitCode = 2;
      }
    }
  } else {
    const plan = planRollout(snap);
    report.plan = { actions: plan.actions, manual: plan.manual };
    lines.push(`Geplante Schritte: ${plan.actions.length}`);
    for (const a of plan.actions) lines.push(`  - ${describeAction(a)}`);
    if (args.apply) {
      if (preflight.retryQueuePending > 0 && !args.ignoreRetryQueue) {
        lines.push(`ABBRUCH: ${preflight.retryQueuePending} Webhook-Retries offen. Erst abarbeiten lassen oder --ignore-retry-queue.`);
        exitCode = 4;
      } else {
        const backup = await createDatabaseSnapshot('manual');
        preflight.backupCreated = backup.fileName;
        lines.push(`DB-Backup: ${backup.fileName}`);
        const { results } = await executeActions(rest, snap, plan.actions, plan.manual);
        report.results = results;
        for (const r of results) lines.push(`  [${r.status}] ${r.action}${r.detail ? ` – ${r.detail}` : ''}`);
        if (results.some((r) => r.status === 'error')) exitCode = 2;
        lines.push('Danach: Container neu starten (Kanal-Cache des Bots), dann /doctor, /status und Test-Webhooks.');
      }
    }
    if (plan.manual.length) {
      lines.push('Manuell:');
      for (const m of plan.manual) lines.push(`  ! ${m}`);
    }
  }
  report.apiCalls = rest.calls;
  report.finishedAt = new Date().toISOString();
  report.exitCode = exitCode;
  const json = `${JSON.stringify(report, null, 2)}\n`;
  return { code: exitCode, output: args.jsonOnly ? json : `${lines.join('\n')}\n\n--- JSON ---\n${json}` };
}

main().then(
  // Exit only after stdout is flushed (pipes are async); the DB module keeps timers alive otherwise.
  ({ code, output }) => process.stdout.write(output, () => process.exit(code)),
  (err: unknown) => {
    // Never include request headers here; DiscordError only carries method, path, status and body.
    process.stderr.write(`Rollout fehlgeschlagen: ${(err as Error).message}\n`);
    process.exit(1);
  },
);
