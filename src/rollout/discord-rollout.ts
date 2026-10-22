/**
 * One-shot Discord server rollout for the lean layout (src/discord/server-layout.ts).
 *
 * Run INSIDE the bot container (token + guild come from its env, never printed):
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-rollout.js --dry-run
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-rollout.js --apply
 *   docker exec -u 99:100 -e DELETE_APPROVED=yes MagguuBot node dist/rollout/discord-rollout.js --delete-archived --dry-run
 *   docker exec -u 99:100 -e DELETE_APPROVED=yes MagguuBot node dist/rollout/discord-rollout.js --delete-archived --apply
 *
 * Default is --dry-run. Idempotent: a second --apply plans nothing. Rate-limit
 * aware (429 retry_after, bucket reset). Never calls /cleanup-server. Deletion
 * is a separate step, gated by --delete-archived AND DELETE_APPROVED=yes, and
 * only touches channels inside 🗄️ ARCHIV without open bot cards plus empty
 * non-layout roles/categories.
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.js';
import { sqliteHandle } from '../db/client.js';
import { createDatabaseSnapshot, databaseBackupDirectory } from '../db/backup.js';
import { isChannelKey, type ChannelKey } from '../discord/channel-store.js';
import { executeActions, executeDeletion, type RestLike } from './execute.js';
import {
  describeAction,
  planDeletion,
  planRollout,
  type GuildSnapshot,
  type SnapChannel,
  type SnapRole,
} from './plan.js';

const API = 'https://discord.com/api/v10';
const MIN_GAP_MS = 300;
const REASON = 'MagguuBot rollout (lean layout)';

interface Args {
  apply: boolean;
  deleteArchived: boolean;
  ignoreRetryQueue: boolean;
  jsonOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const known = new Set(['--apply', '--dry-run', '--delete-archived', '--ignore-retry-queue', '--json']);
  for (const arg of argv) {
    if (!known.has(arg)) throw new Error(`Unbekannte Option: ${arg} (erlaubt: ${[...known].join(', ')})`);
  }
  if (argv.includes('--apply') && argv.includes('--dry-run')) throw new Error('--apply und --dry-run schließen sich aus');
  return {
    apply: argv.includes('--apply'),
    deleteArchived: argv.includes('--delete-archived'),
    ignoreRetryQueue: argv.includes('--ignore-retry-queue'),
    jsonOnly: argv.includes('--json'),
  };
}

// ─── Minimal REST v10 client with rate-limit handling ─────────────────────
class DiscordRest implements RestLike {
  private last = 0;
  calls = 0;
  constructor(private readonly token: string) {}

  async request<T>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<T | null> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const wait = this.last + MIN_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      this.calls++;
      const res = await fetch(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bot ${this.token}`,
          'content-type': 'application/json',
          'user-agent': 'DiscordBot (https://github.com/Derpsen/MagguuBot, rollout)',
          ...(method === 'GET' ? {} : { 'x-audit-log-reason': encodeURIComponent(REASON) }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as { retry_after?: number };
        await sleep(Math.ceil((data.retry_after ?? 1) * 1000) + 100);
        continue;
      }
      if (res.status >= 500) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (res.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(res.headers.get('x-ratelimit-reset-after') ?? '0');
        if (reset > 0) await sleep(Math.ceil(reset * 1000));
      }
      if (okStatuses.includes(res.status)) return null;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new DiscordError(method, path, res.status, text.slice(0, 500));
      }
      if (res.status === 204) return null;
      return (await res.json()) as T;
    }
    throw new DiscordError(method, path, 429, 'rate limit retries exhausted');
  }
}

class DiscordError extends Error {
  constructor(readonly method: string, readonly path: string, readonly status: number, readonly body: string) {
    super(`${method} ${path} → HTTP ${status} ${body}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Snapshot ────────────────────────────────────────────────────────────
interface RawGuild {
  id: string;
  features: string[];
  rules_channel_id: string | null;
  public_updates_channel_id: string | null;
  verification_level: number;
  explicit_content_filter: number;
}
interface RawMember {
  user: { id: string; bot?: boolean };
  roles: string[];
}

async function takeSnapshot(rest: DiscordRest, guildId: string): Promise<{ snap: GuildSnapshot; notes: string[] }> {
  const notes: string[] = [];
  const me = (await rest.request<{ id: string }>('GET', '/users/@me')) as { id: string };
  const guild = (await rest.request<RawGuild>('GET', `/guilds/${guildId}`)) as RawGuild;
  const channels = ((await rest.request<SnapChannel[]>('GET', `/guilds/${guildId}/channels`)) ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    parent_id: c.parent_id ?? null,
    position: c.position,
    topic: c.topic ?? null,
    permission_overwrites: (c.permission_overwrites ?? []).map((o) => ({ id: o.id, type: Number(o.type) as 0 | 1, allow: String(o.allow), deny: String(o.deny) })),
  }));
  const roles = ((await rest.request<SnapRole[]>('GET', `/guilds/${guildId}/roles`)) ?? []).map((r) => ({
    id: r.id, name: r.name, color: r.color, position: r.position, permissions: String(r.permissions),
    managed: r.managed, hoist: r.hoist, mentionable: r.mentionable,
  }));

  let members: Record<string, string[]> | null = {};
  try {
    let after = '0';
    for (;;) {
      const page = (await rest.request<RawMember[]>('GET', `/guilds/${guildId}/members?limit=1000&after=${after}`)) ?? [];
      for (const m of page) members[m.user.id] = [...m.roles];
      if (page.length < 1000) break;
      after = page[page.length - 1]?.user.id ?? after;
    }
  } catch (err) {
    members = null;
    notes.push(`Mitgliederliste nicht lesbar: ${(err as Error).message}`);
  }
  const botRoleIds = members?.[me.id] ?? [];
  const botManaged = roles.find((r) => r.managed && botRoleIds.includes(r.id));
  const botHighestRolePosition = Math.max(0, ...roles.filter((r) => botRoleIds.includes(r.id)).map((r) => r.position), botManaged?.position ?? 0);

  let onboarding: GuildSnapshot['onboarding'] = null;
  try {
    const o = await rest.request<{ enabled: boolean; prompts: Array<{ title: string }>; default_channel_ids: string[] }>('GET', `/guilds/${guildId}/onboarding`);
    if (o) onboarding = { enabled: o.enabled, promptTitles: o.prompts.map((p) => p.title), defaultChannelIds: o.default_channel_ids };
  } catch (err) {
    notes.push(`Onboarding nicht lesbar: ${(err as Error).message}`);
  }
  let welcomeScreen: GuildSnapshot['welcomeScreen'] = null;
  const ws = await rest.request<{ description: string | null; welcome_channels: Array<{ channel_id: string }> }>(
    'GET', `/guilds/${guildId}/welcome-screen`, undefined, [404],
  ).catch((err: Error) => {
    notes.push(`Welcome Screen nicht lesbar: ${err.message}`);
    return null;
  });
  if (ws) welcomeScreen = { description: ws.description, channelIds: ws.welcome_channels.map((c) => c.channel_id) };

  const channelConfig: Partial<Record<ChannelKey, string>> = {};
  for (const row of sqliteHandle.prepare('SELECT key, channel_id FROM channel_config WHERE guild_id = ?').all(guildId) as Array<{ key: string; channel_id: string }>) {
    if (isChannelKey(row.key)) channelConfig[row.key] = row.channel_id;
  }
  const autoRow = sqliteHandle.prepare("SELECT value FROM bot_settings WHERE guild_id = ? AND key = 'autoRoleId'").get(guildId) as { value: string } | undefined;

  return {
    snap: {
      guildId,
      botUserId: me.id,
      botHighestRolePosition,
      features: guild.features,
      rulesChannelId: guild.rules_channel_id,
      publicUpdatesChannelId: guild.public_updates_channel_id,
      verificationLevel: guild.verification_level,
      explicitContentFilter: guild.explicit_content_filter,
      channels,
      roles,
      members,
      channelConfig,
      autoRoleSetting: autoRow?.value ?? null,
      onboarding,
      welcomeScreen,
    },
    notes,
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
    for (const c of plan.channels) lines.push(`  - Kanal ${c.name} (${c.id})`);
    for (const c of plan.categories) lines.push(`  - Kategorie ${c.name} (${c.id})`);
    for (const r of plan.roles) lines.push(`  - Rolle ${r.name} (${r.id})`);
    for (const c of plan.skippedChannels) lines.push(`  · behalten: ${c.name}: ${c.reasons.join(', ')}`);
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
