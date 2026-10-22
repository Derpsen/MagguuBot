/**
 * End-to-end acceptance check of the live guild.
 *
 * Run INSIDE the bot container (token + guild come from its env, never printed):
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-acceptance.js --dry-run
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-acceptance.js --apply
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-acceptance.js --report
 *
 * --dry-run  default, read-only: routing, 90-day scan, slash commands, tickets, permissions, stored IDs
 * --apply    additionally: one marked test post per routing key (posted, verified, deleted), a test
 *            ticket channel (created with the real overwrite spec, verified, deleted), missing
 *            🎫 TICKETS category / its overwrites, and cleanup of bot-authored offenders from the scan
 *            (transient misroutes, duplicate live panels, untracked old cards, leftover test posts).
 *            Results → /app/data/acceptance/last-apply.json
 * --report   read-only checks + the last --apply results → /app/data/acceptance/acceptance-report.md
 * --cleanup-window FROM TO [--apply]  only: list (dry-run) or delete bot-authored Sonarr/Radarr
 *            delete cards in 🩺・status within the window (e.g. 2026-10-22T18:00Z 2026-10-22T18:30Z)
 *
 * Never: guild settings (public updates channel), human messages, slash-command registration.
 * Exit: 0 green · 6 findings · 2 API errors · 1 crash.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { config } from '../config.js';
import { sqliteHandle } from '../db/client.js';
import { getChannel } from '../discord/channel-store.js';
import { commands as localCommands } from '../discord/commands/index.js';
import { ARCHIVE_CATEGORY_NAME, STAFF_ROLE_NAMES, TICKET_CATEGORY_NAME } from '../discord/server-layout.js';
import { HELP_TICKETS_PLAN_NAME, TICKET_SELECT_CUSTOM_ID } from '../embeds/cards.js';
import { getAllSettings } from '../settings.js';
import { checkRouting, describeRoutingProblem, ROUTES, type LiveChannelInfo } from '../utils/routing.js';
import { collectStoredRefs, describeStaleRef, findStaleRefs } from '../utils/stale-ids.js';
import { ticketCategoryOverwrites, ticketChannelOverwrites, verifyTicketOverwrites, type OverwriteBits } from '../utils/ticket-perms.js';
import {
  commandsGreen,
  diffCommands,
  matrixGreen,
  planWindowCleanup,
  matrixMarkdown,
  reportMarkdown,
  routingMatrix,
  scanMessages,
  TEST_MARKER,
  testKeys,
  type CommandShape,
  type ScanFinding,
  type ScanMessage,
  type SectionResult,
  type TestResult,
} from './acceptance-plan.js';
import {
  fetchHistorySince,
  fetchMessage,
  layoutRoutes,
  protectedMessageIds,
  registeredCommands,
  trackedCards,
  trackedLivePanel,
  transientMessages,
  viewOf,
  type GuildView,
  type RawMessage,
} from './live.js';
import { describeAction, planRollout } from './plan.js';
import { DiscordError, DiscordRest, takeSnapshot } from './rest.js';

type Mode = 'dry-run' | 'apply' | 'report';
interface Args { mode: Mode; days: number; perChannel: number; jsonOnly: boolean; cleanupWindow?: { from: number; to: number } }

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: 'dry-run', days: 90, perChannel: 3000, jsonOnly: false };
  const modes = new Set<Mode>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} braucht einen Wert`);
      return v;
    };
    if (a === '--dry-run') modes.add('dry-run');
    else if (a === '--apply') modes.add('apply');
    else if (a === '--report') modes.add('report');
    else if (a === '--json') args.jsonOnly = true;
    else if (a === '--days') args.days = Math.max(1, Number(next()) || 90);
    else if (a === '--per-channel') args.perChannel = Math.max(100, Number(next()) || 3000);
    else if (a === '--cleanup-window') {
      const from = Date.parse(next());
      const to = Date.parse(next());
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new Error('--cleanup-window braucht FROM TO (ISO, z. B. 2026-10-22T18:00Z 2026-10-22T18:30Z)');
      if (to - from > 24 * 3_600_000) throw new Error('--cleanup-window: höchstens 24 h');
      args.cleanupWindow = { from, to };
    }
    else throw new Error(`Unbekannte Option: ${a} (erlaubt: --dry-run, --apply, --report, --days <n>, --per-channel <n>, --cleanup-window <from> <to>, --json)`);
  }
  if (modes.size > 1) throw new Error('Nur einer von --dry-run, --apply, --report');
  if (args.cleanupWindow && modes.has('report')) throw new Error('--cleanup-window nur mit --dry-run oder --apply');
  args.mode = [...modes][0] ?? 'dry-run';
  return args;
}

const outDir = (): string => join(dirname(resolve(config.DATABASE_PATH)), 'acceptance');
const errText = (err: unknown): string => (err instanceof DiscordError ? `${err.status} ${err.message}` : (err as Error).message).slice(0, 200);

// ─── 1. Routing ──────────────────────────────────────────────────────────
async function routingSection(rest: DiscordRest, view: GuildView, apply: boolean, runId: string, errors: string[]): Promise<{ section: SectionResult; tests: Record<string, TestResult> }> {
  const archive = view.snap.channels.find((c) => c.type === 4 && c.name === ARCHIVE_CATEGORY_NAME)?.id;
  const live = new Map<string, LiveChannelInfo>(view.snap.channels.map((c) => [c.id, { id: c.id, name: c.name, parentId: c.parent_id ?? null }]));
  const rows = checkRouting(getChannel, live, new Set(archive ? [archive] : []));
  const tests = new Map<string, TestResult>();
  if (apply) {
    const byKey = new Map(rows.map((r) => [r.key, r]));
    for (const key of testKeys()) {
      const row = byKey.get(key);
      const channelId = row?.channelId;
      if (!channelId || !live.has(channelId)) {
        tests.set(key, { ok: false, detail: 'kein Kanal aufgelöst' });
        continue;
      }
      const sources = ROUTES.filter((r) => r.keys.includes(key)).map((r) => r.source).join(', ');
      try {
        const posted = await rest.request<RawMessage>('POST', `/channels/${channelId}/messages`, {
          content: `${TEST_MARKER} · ${sources} · Key \`${key}\` · Lauf ${runId} – wird sofort gelöscht.`,
          flags: 4096,
          allowed_mentions: { parse: [] },
        });
        if (!posted) throw new Error('keine Antwort');
        const check = await fetchMessage(rest, channelId, posted.id);
        const landed = check?.channel_id === channelId && check.content.startsWith(TEST_MARKER);
        await rest.request('DELETE', `/channels/${channelId}/messages/${posted.id}`, undefined, [404]);
        const gone = (await fetchMessage(rest, channelId, posted.id).catch(() => null)) === null;
        const wrong = row?.problem ? describeRoutingProblem(row) : null;
        tests.set(key, {
          ok: landed && gone && !wrong,
          detail: !landed ? 'Nachricht nicht gefunden' : !gone ? 'Löschen fehlgeschlagen' : wrong ?? 'ok',
        });
      } catch (err) {
        tests.set(key, { ok: false, detail: errText(err) });
        errors.push(`Routing-Test ${key}: ${errText(err)}`);
      }
    }
  }
  const matrix = routingMatrix(rows, tests);
  const problems = rows.filter((r) => r.problem && r.problem !== 'no-layout');
  return {
    section: {
      title: '1 · Routing-Matrix',
      ok: problems.length === 0 && (!apply || matrixGreen(matrix)),
      lines: [...matrixMarkdown(matrix), '', ...(problems.length ? problems.map((r) => `- ⚠ ${describeRoutingProblem(r)}`) : ['Alle Keys zeigen auf ihren Layout-Kanal.']), ...(apply ? [] : ['', '_Testposts nur mit --apply (Spalte „offen“)._'])],
    },
    tests: Object.fromEntries(tests),
  };
}

// ─── 2. 90-day scan ──────────────────────────────────────────────────────
async function scanSection(rest: DiscordRest, view: GuildView, args: Args, apply: boolean, errors: string[]): Promise<{ section: SectionResult; findings: ScanFinding[] }> {
  const since = Date.now() - args.days * 86_400_000;
  const messages: ScanMessage[] = [];
  const notes: string[] = [];
  for (const ch of view.textChannels) {
    if (ch.archived) continue;
    try {
      const { messages: raw, truncated } = await fetchHistorySince(rest, ch.id, since, args.perChannel);
      if (truncated) notes.push(`#${ch.name}: nach ${args.perChannel} Nachrichten abgeschnitten`);
      for (const m of raw) {
        messages.push({
          id: m.id, channelId: m.channel_id, authorId: m.author.id, pinned: m.pinned, type: m.type,
          embeds: m.embeds as ScanMessage['embeds'], timestamp: m.timestamp, content: m.content ?? '',
          interaction: !!(m.interaction_metadata ?? m.interaction) || m.type === 20 || m.type === 23,
        });
      }
    } catch (err) {
      errors.push(`Verlauf #${ch.name}: ${errText(err)}`);
    }
  }
  const commandIdx = await registeredCommands(rest);
  const { findings, duplicates } = scanMessages({
    botUserId: view.snap.botUserId,
    messages,
    routes: layoutRoutes(view),
    trackedCardIds: new Set(trackedCards(view.snap.guildId).map((c) => c.messageId)),
    livePanelId: trackedLivePanel(view.snap.guildId)?.messageId ?? null,
    protectedIds: protectedMessageIds(),
    transient: transientMessages(),
    activeChannelIds: view.activeIds,
    roleIds: new Set(view.snap.roles.map((r) => r.id)),
    commands: commandIdx,
  });
  const name = (id: string): string => `#${view.names.get(id) ?? id}`;
  const lines: string[] = [`${messages.length} Nachrichten aus ${args.days} Tagen gelesen (${messages.filter((m) => m.authorId === view.snap.botUserId).length} vom Bot).`, ...notes.map((n) => `- Hinweis: ${n}`)];
  const deleted: string[] = [];
  if (apply) {
    for (const f of findings.filter((x) => x.deletable)) {
      try {
        await rest.request('DELETE', `/channels/${f.channelId}/messages/${f.messageId}`, undefined, [404]);
        if (f.untrack === 'plex_activity_messages') sqliteHandle.prepare('DELETE FROM plex_activity_messages WHERE message_id = ?').run(f.messageId);
        deleted.push(f.messageId);
      } catch (err) {
        errors.push(`Löschen ${f.messageId}: ${errText(err)}`);
      }
    }
  }
  const open = findings.filter((f) => !deleted.includes(f.messageId));
  const errorsOpen = open.filter((f) => f.severity === 'error');
  for (const f of open.slice(0, 200)) {
    lines.push(`- ${f.severity === 'error' ? '⚠' : 'ℹ'} ${name(f.channelId)} · \`${f.messageId}\` · ${f.detail}${f.deletable ? ' (wird mit --apply gelöscht)' : f.severity === 'info' ? ' (Verlauf, bleibt)' : ''}`);
  }
  if (open.length > 200) lines.push(`- … ${open.length - 200} weitere (siehe JSON)`);
  for (const d of duplicates) lines.push(`- ⚠ Doppelte Karte „${d.title}“: ${d.messageIds.join(', ')}`);
  if (deleted.length) lines.push(`Gelöscht (nur Bot-Nachrichten): ${deleted.length}`);
  if (!open.length && !duplicates.length) lines.push('Keine Fehlrouten, Duplikate, alten Karten oder toten Erwähnungen.');
  return { section: { title: `2 · ${args.days}-Tage-Scan`, ok: errorsOpen.length === 0 && duplicates.length === 0, lines }, findings: open };
}

// ─── 3. Slash commands ───────────────────────────────────────────────────
async function commandsSection(rest: DiscordRest): Promise<SectionResult> {
  const guild = (await rest.request<CommandShape[]>('GET', `/applications/${config.DISCORD_CLIENT_ID}/guilds/${config.DISCORD_GUILD_ID}/commands`)) ?? [];
  const global = (await rest.request<CommandShape[]>('GET', `/applications/${config.DISCORD_CLIENT_ID}/commands`)) ?? [];
  const local = [...localCommands.values()].map((c) => c.data.toJSON() as unknown as CommandShape);
  const d = diffCommands(guild, local, global);
  const lines = [`Registriert: ${guild.length} (Guild) + ${global.length} (global) · im Code: ${local.length}`];
  if (d.missing.length) lines.push(`- ⚠ Nicht registriert: ${d.missing.map((n) => `/${n}`).join(', ')} → Bot neu starten (registriert beim Start)`);
  if (d.extra.length) lines.push(`- ⚠ Registriert, aber nicht im Code: ${d.extra.map((n) => `/${n}`).join(', ')} → Bot neu starten`);
  for (const c of d.changed) {
    const texts = c.expected !== undefined ? ` (registriert „${c.actual}“, Code „${c.expected}“)` : '';
    lines.push(`- ⚠ /${c.name}: ${c.what} weicht ab${texts} → Bot neu starten`);
  }
  if (d.removedService.length) lines.push(`- ⚠ Erwähnt entfernten Dienst: ${d.removedService.map((n) => `/${n}`).join(', ')}`);
  if (d.global.length) lines.push(`- ⚠ Globale Befehle (doppelt sichtbar): ${d.global.map((n) => `/${n}`).join(', ')}`);
  if (commandsGreen(d)) lines.push('Registrierte Befehle = Code. Keine Befehle für entfernte Dienste.');
  return { title: '3 · Slash-Befehle', ok: commandsGreen(d), lines };
}

// ─── 4. Tickets ──────────────────────────────────────────────────────────
interface RawChannel { id: string; name: string; type: number; parent_id?: string | null; permission_overwrites?: Array<{ id: string; type: number; allow: string; deny: string }> }

async function ticketSection(rest: DiscordRest, view: GuildView, apply: boolean, runId: string, errors: string[]): Promise<SectionResult> {
  const lines: string[] = [];
  let ok = true;
  const fail = (msg: string): void => { ok = false; lines.push(`- ⚠ ${msg}`); };
  const pass = (msg: string): void => { lines.push(`- ✅ ${msg}`); };
  const { snap } = view;
  const everyoneId = snap.guildId;
  const staff = snap.roles.filter((r) => (STAFF_ROLE_NAMES as readonly string[]).includes(r.name));
  if (staff.length < STAFF_ROLE_NAMES.length) fail(`Team-Rollen fehlen: ${STAFF_ROLE_NAMES.filter((n) => !staff.some((r) => r.name === n)).join(', ')}`);

  // Panel
  const row = trackedCards(snap.guildId).find((c) => c.planName === HELP_TICKETS_PLAN_NAME);
  const panel = row ? await fetchMessage(rest, row.channelId, row.messageId).catch(() => null) : null;
  if (!panel) fail('Ticket-Panel fehlt → discord-cards.js --apply');
  else {
    const selects = JSON.stringify(panel.components ?? []);
    const hasSelect = selects.includes(TICKET_SELECT_CUSTOM_ID) && /"options":\[\{/.test(selects);
    if (!hasSelect) fail('Ticket-Panel ohne Kategorie-Auswahl');
    else if (!panel.pinned) fail('Ticket-Panel nicht angeheftet');
    else pass(`Ticket-Panel in #${view.names.get(panel.channel_id) ?? panel.channel_id}, angeheftet, mit Auswahl`);
  }

  // Category
  const staffIds = staff.map((r) => r.id);
  const catSpec = ticketCategoryOverwrites({ everyoneId, moderatorRoleIds: staffIds, botUserId: snap.botUserId });
  let category: RawChannel | undefined = snap.channels.find((c) => c.type === 4 && c.name === TICKET_CATEGORY_NAME);
  if (!category && apply) {
    try {
      const created = await rest.request<RawChannel>('POST', `/guilds/${snap.guildId}/channels`, { name: TICKET_CATEGORY_NAME, type: 4, permission_overwrites: toApi(catSpec) });
      if (created) {
        category = created;
        pass(`Kategorie ${TICKET_CATEGORY_NAME} angelegt`);
      }
    } catch (err) { errors.push(`Ticket-Kategorie: ${errText(err)}`); }
  }
  if (!category) fail(`Kategorie ${TICKET_CATEGORY_NAME} fehlt (wird beim ersten Ticket oder mit --apply angelegt)`);
  else {
    let problems = verifyTicketOverwrites(category.permission_overwrites ?? [], catSpec);
    if (problems.length && apply) {
      for (const o of catSpec) {
        const cur = (category.permission_overwrites ?? []).find((x) => x.id === o.id);
        const allow = (BigInt(cur?.allow ?? '0') | o.allow) & ~o.deny;
        const deny = (BigInt(cur?.deny ?? '0') | o.deny) & ~o.allow;
        try {
          await rest.request('PUT', `/channels/${category.id}/permissions/${o.id}`, { type: o.type, allow: String(allow), deny: String(deny) });
        } catch (err) { errors.push(`Kategorie-Rechte ${o.id}: ${errText(err)}`); }
      }
      const fresh = await rest.request<RawChannel>('GET', `/channels/${category.id}`).catch(() => null);
      problems = verifyTicketOverwrites(fresh?.permission_overwrites ?? [], catSpec);
      if (!problems.length) pass('Kategorie-Rechte ergänzt');
    }
    if (problems.length) fail(`Kategorie-Rechte: ${problems.join('; ')}`);
    else pass(`Kategorie ${TICKET_CATEGORY_NAME}: @everyone unsichtbar, Team + Bot sehen sie`);
  }

  // Log channel
  const logId = getChannel('ticketLogs');
  const logName = logId ? view.names.get(logId) : undefined;
  if (!logId || !logName || !view.activeIds.has(logId)) fail('Ticket-Log-Kanal (Key ticketLogs) fehlt oder ist archiviert');
  else pass(`Transkripte/Log: #${logName}`);

  // Test ticket
  if (apply && category) {
    const spec = ticketChannelOverwrites({ everyoneId, openerId: snap.botUserId, moderatorRoleIds: staffIds, botUserId: snap.botUserId });
    let channelId: string | null = null;
    try {
      const created = await rest.request<RawChannel>('POST', `/guilds/${snap.guildId}/channels`, {
        name: `🧪-abnahme-${runId}`.slice(0, 90), type: 0, parent_id: category.id,
        topic: `${TEST_MARKER} · wird sofort gelöscht`, permission_overwrites: toApi(spec),
      });
      channelId = created?.id ?? null;
      if (!channelId) throw new Error('keine Antwort');
      const fresh = await rest.request<RawChannel>('GET', `/channels/${channelId}`);
      const problems = verifyTicketOverwrites(fresh?.permission_overwrites ?? [], spec);
      const msg = await rest.request<RawMessage>('POST', `/channels/${channelId}/messages`, { content: `${TEST_MARKER} · Testticket ${runId}`, allowed_mentions: { parse: [] } });
      await rest.request('DELETE', `/channels/${channelId}`, undefined, [404]);
      const gone = await rest.request('GET', `/channels/${channelId}`, undefined, [404]).then((r) => r === null).catch(() => false);
      channelId = gone ? null : channelId;
      if (problems.length) fail(`Testticket-Rechte: ${problems.join('; ')}`);
      else if (!msg) fail('Testticket: Nachricht nicht gepostet');
      else if (!gone) fail('Testticket: Kanal nicht gelöscht');
      else pass('Testticket angelegt (privat), Nachricht gepostet, Kanal gelöscht');
    } catch (err) {
      errors.push(`Testticket: ${errText(err)}`);
      fail(`Testticket: ${errText(err)}`);
    } finally {
      if (channelId) await rest.request('DELETE', `/channels/${channelId}`, undefined, [404]).catch(() => undefined);
    }
  } else if (!apply) lines.push('_Testticket nur mit --apply._');
  return { title: '4 · Tickets', ok, lines };
}

function toApi(spec: readonly OverwriteBits[]): Array<{ id: string; type: number; allow: string; deny: string }> {
  return spec.map((o) => ({ id: o.id, type: o.type, allow: String(o.allow), deny: String(o.deny) }));
}

// ─── 5. Permissions / roles / onboarding ─────────────────────────────────
function permissionSection(view: GuildView): SectionResult {
  const plan = planRollout(view.snap);
  const drift = plan.actions.filter((a) => a.kind !== 'enableCommunity');
  return {
    title: '5 · Rechte, Rollen, Onboarding',
    ok: drift.length === 0,
    lines: drift.length
      ? [...drift.map((a) => `- ⚠ ${describeAction(a)}`), '', 'Behebung: discord-rollout.js --dry-run prüfen, dann --apply (Public-Updates-Kanal bleibt unangetastet).']
      : ['Kanalrechte, Bot-only-Kanäle, Rollen und Onboarding entsprechen ROLES/STRUCTURE.'],
  };
}

// ─── 6. Stored IDs ───────────────────────────────────────────────────────
function storedIdSection(view: GuildView): SectionResult {
  const { snap } = view;
  const archiveId = snap.channels.find((c) => c.type === 4 && c.name === ARCHIVE_CATEGORY_NAME)?.id ?? null;
  const stale = findStaleRefs(collectStoredRefs(sqliteHandle, snap.guildId, getAllSettings() as unknown as Record<string, unknown>), {
    channels: new Map(snap.channels.map((c) => [c.id, { name: c.name, type: c.type, parentId: c.parent_id ?? null }])),
    roleIds: new Set(snap.roles.map((r) => r.id)),
    roleNames: new Set(snap.roles.map((r) => r.name)),
    archiveId,
  });
  return {
    title: '6 · Gespeicherte IDs',
    ok: stale.length === 0,
    lines: stale.length ? stale.map((s) => `- ⚠ ${describeStaleRef(s)}`) : ['Alle gespeicherten Kanal-, Kategorie- und Rollen-IDs existieren.'],
  };
}

// ─── Main ────────────────────────────────────────────────────────────────
interface ApplyResult { runId: string; finishedAt: string; tests: Record<string, TestResult>; sections: SectionResult[]; errors: string[] }

/**
 * --cleanup-window FROM TO: bot-authored Sonarr/Radarr delete cards in 🩺・status within the
 * window (dry-run lists, --apply deletes via bulk delete). Nothing else runs in this mode.
 */
async function cleanupWindow(rest: DiscordRest, args: Args, apply: boolean): Promise<{ code: number; output: string }> {
  const win = args.cleanupWindow!;
  const { snap } = await takeSnapshot(rest, config.DISCORD_GUILD_ID);
  const view = viewOf(snap);
  const statusId = getChannel('health');
  if (!statusId) return { code: 2, output: 'health/status-Kanal nicht gesetzt\n' };
  const raw = await fetchHistorySince(rest, statusId, win.from, args.perChannel);
  const messages: ScanMessage[] = raw.messages.map((m) => ({
    id: m.id, channelId: m.channel_id, authorId: m.author.id, pinned: m.pinned, type: m.type,
    embeds: m.embeds as ScanMessage['embeds'], timestamp: m.timestamp, content: m.content ?? '',
    interaction: !!(m.interaction_metadata ?? m.interaction) || m.type === 20 || m.type === 23,
  }));
  const tracked = new Set([...trackedCards(snap.guildId).map((c) => c.messageId), ...protectedMessageIds(['webhook_events'])]);
  const hits = planWindowCleanup({ botUserId: snap.botUserId, messages, fromMs: win.from, toMs: win.to, channelIds: new Set([statusId]), protectedIds: tracked });
  const inWindow = messages.filter((m) => { const t = Date.parse(m.timestamp); return t >= win.from && t < win.to; });
  const name = `#${view.names.get(statusId) ?? statusId}`;
  const lines = [
    `Fenster ${new Date(win.from).toISOString()} – ${new Date(win.to).toISOString()} (${apply ? 'apply' : 'dry-run'})`,
    `${name}: ${inWindow.length} Nachrichten im Fenster, davon ${inWindow.filter((m) => m.authorId === snap.botUserId).length} vom Bot; ${hits.length} Lösch-Karten passen.`,
    ...(raw.truncated ? [`Hinweis: nach ${args.perChannel} Nachrichten abgeschnitten (--per-channel erhöhen)`] : []),
  ];
  let deleted = 0;
  const errors: string[] = [];
  if (apply && hits.length) {
    const fourteenDays = Date.now() - 13.5 * 86_400_000;
    const bulk = hits.filter((m) => Date.parse(m.timestamp) > fourteenDays).map((m) => m.id);
    const single = hits.filter((m) => Date.parse(m.timestamp) <= fourteenDays).map((m) => m.id);
    for (let i = 0; i < bulk.length; i += 100) {
      const chunk = bulk.slice(i, i + 100);
      try {
        if (chunk.length === 1) await rest.request('DELETE', `/channels/${statusId}/messages/${chunk[0]}`, undefined, [404]);
        else await rest.request('POST', `/channels/${statusId}/messages/bulk-delete`, { messages: chunk });
        deleted += chunk.length;
      } catch (err) {
        errors.push(`Bulk-Delete: ${errText(err)}`);
      }
    }
    for (const id of single) {
      try {
        await rest.request('DELETE', `/channels/${statusId}/messages/${id}`, undefined, [404]);
        deleted++;
      } catch (err) {
        errors.push(`Delete ${id}: ${errText(err)}`);
      }
    }
    lines.push(`${name}: ${deleted} gelöscht.`);
  } else if (!apply) lines.push('_Nichts gelöscht (dry-run). Mit --apply löschen._');
  lines.push(...errors.map((e) => `- ⚠ ${e}`));
  const dir = outDir();
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 14);
  await writeFile(join(dir, `cleanup-window-${stamp}.json`), `${JSON.stringify({ apply, from: win.from, to: win.to, channel: name, matched: hits.length, deleted, errors, ids: hits.map((m) => m.id) }, null, 2)}\n`, { mode: 0o600 });
  return { code: errors.length ? 2 : 0, output: `${lines.join('\n')}\n` };
}

async function main(): Promise<{ code: number; output: string }> {
  const args = parseArgs(process.argv.slice(2));
  const apply = args.mode === 'apply';
  const rest = new DiscordRest(config.DISCORD_TOKEN, 'MagguuBot acceptance test');
  if (args.cleanupWindow) return cleanupWindow(rest, args, apply);
  const startedAt = new Date().toISOString();
  const runId = startedAt.replace(/\D/g, '').slice(2, 14);
  const errors: string[] = [];
  const { snap, notes } = await takeSnapshot(rest, config.DISCORD_GUILD_ID);
  const view = viewOf(snap);

  const routing = await routingSection(rest, view, apply, runId, errors);
  let tests = routing.tests;
  const sections: SectionResult[] = [routing.section];
  const scan = await scanSection(rest, view, args, apply, errors);
  sections.push(scan.section, await commandsSection(rest), await ticketSection(rest, view, apply, runId, errors), permissionSection(view), storedIdSection(view));
  sections.push({
    title: '7 · Dauerhafte Prüfung',
    ok: true,
    lines: ['/doctor enthält Routing, gespeicherte IDs, Karten/Pins und den Community-Updates-Kanal (nur lesend).', 'Täglicher Selbsttest postet nur bei Fehlern in den Log-Kanal.'],
  });

  const dir = outDir();
  await mkdir(dir, { recursive: true });
  const lastPath = join(dir, 'last-apply.json');
  if (apply) {
    const result: ApplyResult = { runId, finishedAt: new Date().toISOString(), tests, sections, errors };
    await writeFile(lastPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  } else if (args.mode === 'report') {
    const last = await readFile(lastPath, 'utf8').then((t) => JSON.parse(t) as ApplyResult).catch(() => null);
    if (last) {
      tests = last.tests;
      // Live routing state now, "Test ok" column from the last --apply.
      sections[0] = { ...sections[0]!, ...withTests(view, last) };
      const ticketLast = last.sections.find((s) => s.title.startsWith('4 '));
      if (ticketLast) sections[3] = { ...sections[3]!, lines: [...sections[3]!.lines.filter((l) => !l.startsWith('_Testticket')), `- Letzter --apply (${last.finishedAt}):`, ...ticketLast.lines.filter((l) => /Testticket/.test(l)).map((l) => `  ${l}`)], ok: sections[3]!.ok && !ticketLast.lines.some((l) => /⚠ Testticket/.test(l)) };
      sections.push({ title: `Letzter --apply-Lauf ${last.runId}`, ok: last.errors.length === 0, lines: last.errors.length ? last.errors.map((e) => `- ⚠ ${e}`) : ['Ohne API-Fehler.'] });
    } else {
      sections.push({ title: 'Letzter --apply-Lauf', ok: false, lines: ['- ⚠ Noch kein --apply-Lauf gefunden.'] });
    }
  }
  if (errors.length) sections.push({ title: 'API-Fehler', ok: false, lines: errors.map((e) => `- ${e}`) });

  const md = reportMarkdown({ mode: args.mode, startedAt, guildId: snap.guildId }, sections);
  const green = sections.every((s) => s.ok);
  const code = errors.length ? 2 : green ? 0 : 6;
  const reportPath = join(dir, args.mode === 'report' ? 'acceptance-report.md' : `acceptance-${args.mode}.md`);
  await writeFile(reportPath, `${md}\n`, { mode: 0o600 });
  const json = { mode: args.mode, guildId: snap.guildId, startedAt, notes, green, exitCode: code, tests, scanFindings: scan.findings, sections, errors, reportPath, apiCalls: rest.calls };
  await writeFile(reportPath.replace(/\.md$/, '.json'), `${JSON.stringify(json, null, 2)}\n`, { mode: 0o600 });
  return { code, output: args.jsonOnly ? `${JSON.stringify(json, null, 2)}\n` : `${md}\n\nBericht: ${reportPath}\n` };
}

function withTests(view: GuildView, last: ApplyResult): Pick<SectionResult, 'lines' | 'ok'> {
  const archive = view.snap.channels.find((c) => c.type === 4 && c.name === ARCHIVE_CATEGORY_NAME)?.id;
  const live = new Map<string, LiveChannelInfo>(view.snap.channels.map((c) => [c.id, { id: c.id, name: c.name, parentId: c.parent_id ?? null }]));
  const rows = checkRouting(getChannel, live, new Set(archive ? [archive] : []));
  const matrix = routingMatrix(rows, new Map(Object.entries(last.tests)));
  const problems = rows.filter((r) => r.problem && r.problem !== 'no-layout');
  return {
    ok: problems.length === 0 && matrixGreen(matrix),
    lines: [...matrixMarkdown(matrix), '', `_Spalte „Test ok“ aus --apply ${last.runId} (${last.finishedAt})._`, ...problems.map((r) => `- ⚠ ${describeRoutingProblem(r)}`)],
  };
}

main().then(
  ({ code, output }) => process.stdout.write(output, () => process.exit(code)),
  (err: unknown) => {
    process.stderr.write(`Abnahme fehlgeschlagen: ${(err as Error).message}\n`);
    process.exit(1);
  },
);
