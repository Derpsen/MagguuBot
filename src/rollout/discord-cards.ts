/**
 * Bot cards rollout (pinned info cards, src/embeds/cards.ts).
 *
 * Run INSIDE the bot container (token + guild come from its env, never printed):
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-cards.js --export /app/data/cards-export
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-cards.js --dry-run
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-cards.js --apply
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-cards.js --check
 *
 * --export <path>  JSON + Markdown backup of all bot-authored messages and all pins (secrets masked)
 * --dry-run        default: show what --apply would do
 * --apply          create/reuse 🟦・blizzard-updates + 🎬・plex-aktivität, re-point channel keys at their
 *                  layout channel, replace old bot cards, post + pin the new ones, delete misplaced
 *                  Plex-activity cards and duplicate live panels, pin the live panel, unpin stale bot
 *                  pins. Never changes guild settings (public updates channel). Idempotent.
 * --check          doctor scan: dead <#id> mentions and unknown commands in bot pins/cards
 *
 * Only messages authored by the bot are ever edited, deleted, pinned or unpinned.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { config } from '../config.js';
import { sqliteHandle } from '../db/client.js';
import { createDatabaseSnapshot } from '../db/backup.js';
import { CARDS, renderCard } from '../embeds/cards.js';
import { auditMessages, describeFinding, maskDeep, messageText, type AuditMessage } from '../utils/card-audit.js';
import { cardLayoutActions, describeCardOp, planCards, type CardOp, type LiveMessage } from './cards-plan.js';
import { executeActions } from './execute.js';
import {
  cardContext,
  collectLive,
  fetchHistory,
  fetchPins,
  forgetCard,
  layoutRoutes,
  pin,
  protectedMessageIds,
  registeredCommands,
  saveCard,
  trackedCards,
  trackedLivePanel,
  transientMessages,
  unpin,
  viewOf,
  type GuildView,
  type RawMessage,
} from './live.js';
import { describeAction, planRollout } from './plan.js';
import { DiscordRest, takeSnapshot } from './rest.js';

interface Args {
  exportPath: string | null;
  apply: boolean;
  check: boolean;
  dryRun: boolean;
  scanLimit: number;
  exportLimit: number;
  jsonOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { exportPath: null, apply: false, check: false, dryRun: false, scanLimit: 200, exportLimit: 5000, jsonOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} braucht einen Wert`);
      return v;
    };
    if (a === '--export') args.exportPath = next();
    else if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--check') args.check = true;
    else if (a === '--json') args.jsonOnly = true;
    else if (a === '--scan-limit') args.scanLimit = Math.max(0, Number(next()) || 0);
    else if (a === '--export-limit') args.exportLimit = Math.max(1, Number(next()) || 1);
    else throw new Error(`Unbekannte Option: ${a} (erlaubt: --export <pfad>, --dry-run, --apply, --check, --scan-limit <n>, --export-limit <n>, --json)`);
  }
  if (args.apply && args.dryRun) throw new Error('--apply und --dry-run schließen sich aus');
  if (!args.apply && !args.check && !args.exportPath) args.dryRun = true;
  return args;
}

// ─── Export ──────────────────────────────────────────────────────────────
async function runExport(rest: DiscordRest, view: GuildView, target: string, limit: number, lines: string[]): Promise<Record<string, unknown>> {
  const botId = view.snap.botUserId;
  const channels: Array<Record<string, unknown>> = [];
  let botTotal = 0;
  let pinTotal = 0;
  for (const ch of view.textChannels) {
    const pins = await fetchPins(rest, ch.id).catch((err: Error) => {
      lines.push(`  Hinweis: Pins von #${ch.name} nicht lesbar: ${err.message.slice(0, 120)}`);
      return [] as RawMessage[];
    });
    const bot = await fetchHistory(rest, ch.id, limit, botId).catch((err: Error) => {
      lines.push(`  Hinweis: Verlauf von #${ch.name} nicht lesbar: ${err.message.slice(0, 120)}`);
      return [] as RawMessage[];
    });
    botTotal += bot.length;
    pinTotal += pins.length;
    const slim = (m: RawMessage): Record<string, unknown> => ({
      id: m.id, type: m.type, author: { id: m.author.id, username: m.author.username, bot: m.author.bot ?? false },
      pinned: m.pinned, timestamp: m.timestamp, edited: m.edited_timestamp ?? null, content: m.content,
      embeds: m.embeds, components: m.components ?? [], attachments: (m.attachments ?? []).map((a) => a.filename ?? ''),
    });
    channels.push({ id: ch.id, name: ch.name, archived: ch.archived, pins: pins.map(slim), botMessages: bot.map(slim) });
  }
  const data = maskDeep({
    exportedAt: new Date().toISOString(),
    guildId: view.snap.guildId,
    botUserId: botId,
    scanLimitPerChannel: limit,
    trackedCards: trackedCards(view.snap.guildId),
    channels,
  });
  const isFile = extname(target).toLowerCase() === '.json';
  const jsonPath = isFile ? target : join(target, 'discord-cards-export.json');
  const mdPath = jsonPath.replace(/\.json$/i, '.md');
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await writeFile(mdPath, exportMarkdown(data as unknown as ExportData), { mode: 0o600 });
  lines.push(`Export: ${view.textChannels.length} Kanäle, ${botTotal} Bot-Nachrichten, ${pinTotal} Pins → ${jsonPath} + ${mdPath}`);
  return { jsonPath, mdPath, channels: view.textChannels.length, botMessages: botTotal, pins: pinTotal };
}

interface ExportData {
  exportedAt: string;
  channels: Array<{ name: string; archived: boolean; pins: RawMessage[]; botMessages: RawMessage[] }>;
}

function exportMarkdown(data: ExportData): string {
  const out = [`# Discord-Karten-Export ${data.exportedAt}`, '', 'Secrets maskiert. Pins aller Autoren, Nachrichten nur vom Bot.', ''];
  for (const ch of data.channels) {
    if (!ch.pins.length && !ch.botMessages.length) continue;
    out.push(`## #${ch.name}${ch.archived ? ' (Archiv)' : ''}`, '');
    out.push(`Pins: ${ch.pins.length} · Bot-Nachrichten: ${ch.botMessages.length}`, '');
    const seen = new Set<string>();
    for (const m of [...ch.pins, ...ch.botMessages]) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const text = messageText({ content: m.content, embeds: m.embeds as AuditMessage['embeds'] }).replace(/\n+/g, ' ⏎ ').slice(0, 400);
      out.push(`- \`${m.id}\` ${m.timestamp}${m.pinned ? ' 📌' : ''} ${m.author.bot ? '🤖' : `👤 ${m.author.username ?? m.author.id}`}: ${text}`);
    }
    out.push('');
  }
  return `${out.join('\n')}\n`;
}

async function executeCardOps(
  rest: DiscordRest,
  guildId: string,
  botId: string,
  ops: CardOp[],
  rendered: Map<string, ReturnType<typeof renderCard>>,
  live: ReadonlyMap<string, LiveMessage>,
  name: (id: string) => string,
): Promise<Array<{ action: string; status: 'ok' | 'error'; detail?: string }>> {
  const results: Array<{ action: string; status: 'ok' | 'error'; detail?: string }> = [];
  for (const op of ops) {
    const label = describeCardOp(op, name);
    try {
      switch (op.op) {
        case 'delete': {
          // Re-check authorship right before a destructive call.
          const msg = live.get(op.messageId);
          if (!msg || msg.authorId !== botId) throw new Error('nicht vom Bot, übersprungen');
          await rest.request('DELETE', `/channels/${op.channelId}/messages/${op.messageId}`, undefined, [404]);
          if (op.untrack === 'plex_activity_messages') {
            sqliteHandle.prepare('DELETE FROM plex_activity_messages WHERE message_id = ?').run(op.messageId);
          }
          break;
        }
        case 'unpin': {
          const msg = live.get(op.messageId);
          if (!msg || msg.authorId !== botId) throw new Error('nicht vom Bot, übersprungen');
          await unpin(rest, op.channelId, op.messageId);
          break;
        }
        case 'post': {
          const card = rendered.get(op.planName);
          if (!card) throw new Error('Karte unbekannt');
          const msg = await rest.request<RawMessage>('POST', `/channels/${op.channelId}/messages`, { ...card.body, allowed_mentions: { parse: [] } });
          if (!msg) throw new Error('keine Antwort');
          saveCard(guildId, op.planName, op.channelId, msg.id, card.hash);
          if (op.pin) await pin(rest, op.channelId, msg.id, botId);
          break;
        }
        case 'edit': {
          const card = rendered.get(op.planName);
          if (!card) throw new Error('Karte unbekannt');
          await rest.request('PATCH', `/channels/${op.channelId}/messages/${op.messageId}`, { ...card.body, allowed_mentions: { parse: [] } });
          saveCard(guildId, op.planName, op.channelId, op.messageId, card.hash);
          if (op.pin && !live.get(op.messageId)?.pinned) await pin(rest, op.channelId, op.messageId, botId);
          break;
        }
        case 'pin':
          await pin(rest, op.channelId, op.messageId, botId);
          break;
        case 'forget':
          forgetCard(guildId, op.planName);
          break;
        case 'missingChannel':
          results.push({ action: label, status: 'error', detail: 'Kanal existiert nicht' });
          continue;
      }
      results.push({ action: label, status: 'ok' });
    } catch (err) {
      results.push({ action: label, status: 'error', detail: (err as Error).message.slice(0, 300) });
    }
  }
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main(): Promise<{ code: number; output: string }> {
  const args = parseArgs(process.argv.slice(2));
  const guildId = config.DISCORD_GUILD_ID;
  const rest = new DiscordRest(config.DISCORD_TOKEN, 'MagguuBot cards rollout');
  const modes = [args.exportPath ? 'export' : null, args.apply ? 'apply' : args.dryRun ? 'dry-run' : null, args.check ? 'check' : null].filter(Boolean);
  const report: Record<string, unknown> = { modes, guildId, startedAt: new Date().toISOString() };
  const lines: string[] = [`MagguuBot Discord-Karten · Modus: ${modes.join(' + ')}`];
  let exitCode = 0;

  let { snap, notes } = await takeSnapshot(rest, guildId);
  for (const n of notes) lines.push(`Hinweis: ${n}`);
  let view = viewOf(snap);
  const name = (id: string): string => `#${view.names.get(id) ?? id}`;

  if (args.exportPath) report.export = await runExport(rest, view, args.exportPath, args.exportLimit, lines);

  if (args.apply || args.dryRun) {
    const layout = cardLayoutActions(planRollout(snap));
    report.layout = { actions: layout.actions.map(describeAction), blocker: layout.blocker };
    if (layout.blocker) {
      lines.push(`Kanäle/Keys: ${layout.blocker}`);
      if (args.apply) {
        exitCode = 5;
        lines.push('ABBRUCH: ohne Blizzard-/Plex-Kanal und Routing werden keine Karten geändert.');
      }
    } else {
      lines.push(`Kanäle/Keys: ${layout.actions.length ? layout.actions.map(describeAction).join(' · ') : 'aktuell'}`);
    }

    if (exitCode === 0) {
      if (args.apply) {
        const backup = await createDatabaseSnapshot('manual');
        lines.push(`DB-Backup: ${backup.fileName}`);
        if (layout.actions.length) {
          const { results } = await executeActions(rest, snap, layout.actions, []);
          for (const r of results) lines.push(`  [${r.status}] ${r.action}${r.detail ? ` – ${r.detail}` : ''}`);
          if (results.some((r) => r.status === 'error')) exitCode = 2;
          ({ snap } = await takeSnapshot(rest, guildId));
          view = viewOf(snap);
        }
      }
      const commands = await registeredCommands(rest);
      const ctx = cardContext(view, commands);
      const rendered = new Map(CARDS.map((spec) => [spec.planName, renderCard(spec, ctx)]));
      const tracked = trackedCards(guildId);
      const live = await collectLive(rest, view, args.scanLimit, tracked);
      const ops = planCards({
        botUserId: snap.botUserId,
        cards: CARDS.map((spec) => ({ rendered: rendered.get(spec.planName)!, channelId: view.layoutIds[spec.channel] })),
        tracked,
        live,
        protectedIds: protectedMessageIds(),
        routes: layoutRoutes(view),
        transient: transientMessages(),
        livePanel: trackedLivePanel(guildId),
      });
      report.ops = ops;
      lines.push(`Karten: ${CARDS.length} · Bot-Nachrichten gesehen: ${live.size} · geplante Schritte: ${ops.length}`);
      for (const op of ops) lines.push(`  - ${describeCardOp(op, name)}`);
      if (!ops.length) lines.push('  Alles aktuell.');
      if (args.apply && exitCode === 0 && ops.length) {
        const results = await executeCardOps(rest, guildId, snap.botUserId, ops, rendered, live, name);
        report.results = results;
        for (const r of results) lines.push(`  [${r.status}] ${r.action}${r.detail ? ` – ${r.detail}` : ''}`);
        if (results.some((r) => r.status === 'error')) exitCode = 2;
        lines.push('Danach: Container neu starten (Kanal-Cache der Keys), dann --check und /doctor.');
      }
    }
  }

  if (args.check) {
    const commands = await registeredCommands(rest);
    const tracked = trackedCards(guildId);
    const live = await collectLive(rest, view, 0, tracked);
    const messages: AuditMessage[] = [...live.values()]
      .filter((m) => m.authorId === snap.botUserId)
      .map((m) => ({ channelId: m.channelId, channelName: view.names.get(m.channelId), messageId: m.id, pinned: m.pinned, embeds: m.embeds }));
    const findings = auditMessages(messages, view.activeIds, commands);
    report.check = { scanned: messages.length, findings };
    lines.push(`Check: ${messages.length} Bot-Pins/Karten geprüft, ${findings.length} Warnung(en)`);
    for (const f of findings) lines.push(`  ⚠ ${describeFinding(f)}`);
    if (findings.length && exitCode === 0) exitCode = 6;
  }

  report.apiCalls = rest.calls;
  report.finishedAt = new Date().toISOString();
  report.exitCode = exitCode;
  const json = `${JSON.stringify(report, null, 2)}\n`;
  return { code: exitCode, output: args.jsonOnly ? json : `${lines.join('\n')}\n\n--- JSON ---\n${json}` };
}

main().then(
  ({ code, output }) => process.stdout.write(output, () => process.exit(code)),
  (err: unknown) => {
    process.stderr.write(`Karten-Rollout fehlgeschlagen: ${(err as Error).message}\n`);
    process.exit(1);
  },
);
