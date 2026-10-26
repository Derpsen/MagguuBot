/**
 * One-time cleanup of the OLD public per-join welcome cards (library part; the CLI is discord-welcome-cleanup.ts).
 *
 * Strict selector, ALL conditions must hold: message in the welcome channel, author is the bot itself, attachment
 * `welcome.png`, content exactly `🎉 <@id> hat den Server betreten!` or `↩️ <@id> ist zurück.` (the formats of the old
 * guild-member-add handler), not pinned, not a tracked card (`welcome_messages`), not the counter message.
 * Deletion: one `DELETE` per message with a gap of at least 1.2 s (never bulkDelete), abort on permanent errors
 * (10003 / 50001 / 50013), 429 is handled by the REST client. Output contains COUNTS only: no names, ids or content.
 */
import type { RestLike } from './execute.js';
import { DiscordError, sleep } from './rest.js';

export const OLD_CARD_ATTACHMENT = 'welcome.png';
/** Exact formats of the removed per-join post (git ec25c6a, guild-member-add.ts). */
export const OLD_CARD_CONTENT = /^(?:🎉 <@\d{17,20}> hat den Server betreten!|↩️ <@\d{17,20}> ist zurück\.)$/u;
export const MIN_DELETE_GAP_MS = 1200;
export const DEFAULT_SCAN_LIMIT = 1000;
export const MAX_SCAN_LIMIT = 10_000;
const PERMANENT_CODES = new Set([10003, 50001, 50013]);
const MAX_CONSECUTIVE_ERRORS = 5;

export interface RawMessage {
  id: string;
  channel_id: string;
  author?: { id?: string; bot?: boolean } | null;
  content?: string | null;
  attachments?: Array<{ filename?: string }> | null;
  pinned?: boolean;
}

export type SkipReason =
  | 'other_channel'
  | 'user_message'
  | 'other_author'
  | 'no_attachment'
  | 'other_text'
  | 'pinned'
  | 'counter_message'
  | 'tracked_card';

export interface CleanupContext {
  channelId: string;
  botId: string;
  /** Message ids of the pinned/tracked cards (`welcome_messages` of the welcome channel). */
  trackedIds: ReadonlySet<string>;
  /** Message id of the new counter card (`welcome_counter_card`). */
  counterId: string | null;
}

export function classifyMessage(msg: RawMessage, ctx: CleanupContext): 'candidate' | SkipReason {
  if (msg.channel_id !== ctx.channelId) return 'other_channel';
  if (msg.author?.bot !== true) return 'user_message';
  if (msg.author.id !== ctx.botId) return 'other_author';
  if (!(msg.attachments ?? []).some((a) => a.filename === OLD_CARD_ATTACHMENT)) return 'no_attachment';
  if (typeof msg.content !== 'string' || !OLD_CARD_CONTENT.test(msg.content)) return 'other_text';
  if (msg.pinned === true) return 'pinned';
  if (ctx.counterId !== null && msg.id === ctx.counterId) return 'counter_message';
  if (ctx.trackedIds.has(msg.id)) return 'tracked_card';
  return 'candidate';
}

export interface CleanupCounts {
  scanned: number;
  candidates: number;
  deleted: number;
  skipped: number;
  errors: number;
  skippedBy: Partial<Record<SkipReason | 'already_gone', number>>;
  /** Why the run stopped early, category only. */
  aborted: 'permanent_error' | 'rate_limit' | 'too_many_errors' | null;
  scanComplete: boolean;
}

export interface CleanupOptions {
  rest: RestLike;
  ctx: CleanupContext;
  scanLimit?: number;
  execute: boolean;
  sleepFn?: (ms: number) => Promise<void>;
}

function discordCode(err: unknown): number | null {
  if (!(err instanceof DiscordError)) return null;
  try {
    const parsed = JSON.parse(err.body) as { code?: unknown };
    return typeof parsed.code === 'number' ? parsed.code : null;
  } catch {
    return null;
  }
}

function discordStatus(err: unknown): number | null {
  return err instanceof DiscordError ? err.status : null;
}

export function normalizeScanLimit(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_SCAN_LIMIT;
  if (!Number.isInteger(raw) || raw < 1 || raw > MAX_SCAN_LIMIT) throw new Error(`--scan-limit muss eine ganze Zahl von 1 bis ${MAX_SCAN_LIMIT} sein`);
  return raw;
}

/** Newest first, 100 per page, at most `scanLimit` messages. */
export async function scanChannel(rest: RestLike, channelId: string, scanLimit: number): Promise<{ messages: RawMessage[]; complete: boolean }> {
  const messages: RawMessage[] = [];
  let before: string | null = null;
  while (messages.length < scanLimit) {
    const limit = Math.min(100, scanLimit - messages.length);
    const page: RawMessage[] = (await rest.request<RawMessage[]>('GET', `/channels/${channelId}/messages?limit=${limit}${before ? `&before=${before}` : ''}`)) ?? [];
    messages.push(...page);
    if (page.length < limit) return { messages, complete: true };
    before = page[page.length - 1]?.id ?? null;
    if (before === null) return { messages, complete: true };
  }
  return { messages, complete: false };
}

export async function runWelcomeCleanup(opts: CleanupOptions): Promise<CleanupCounts> {
  const counts: CleanupCounts = { scanned: 0, candidates: 0, deleted: 0, skipped: 0, errors: 0, skippedBy: {}, aborted: null, scanComplete: false };
  const nap = opts.sleepFn ?? sleep;
  const { messages, complete } = await scanChannel(opts.rest, opts.ctx.channelId, normalizeScanLimit(opts.scanLimit));
  counts.scanned = messages.length;
  counts.scanComplete = complete;
  const candidates: RawMessage[] = [];
  for (const m of messages) {
    const verdict = classifyMessage(m, opts.ctx);
    if (verdict === 'candidate') {
      candidates.push(m);
    } else {
      counts.skipped++;
      counts.skippedBy[verdict] = (counts.skippedBy[verdict] ?? 0) + 1;
    }
  }
  counts.candidates = candidates.length;
  if (!opts.execute) return counts;

  let consecutive = 0;
  let first = true;
  for (const m of candidates) {
    if (!first) await nap(MIN_DELETE_GAP_MS);
    first = false;
    try {
      await opts.rest.request('DELETE', `/channels/${opts.ctx.channelId}/messages/${m.id}`, undefined);
      counts.deleted++;
      consecutive = 0;
    } catch (err) {
      const code = discordCode(err);
      if (code === 10008) {
        counts.skipped++;
        counts.skippedBy.already_gone = (counts.skippedBy.already_gone ?? 0) + 1;
        continue;
      }
      counts.errors++;
      consecutive++;
      if (code !== null && PERMANENT_CODES.has(code)) {
        counts.aborted = 'permanent_error';
        break;
      }
      if (discordStatus(err) === 429) {
        counts.aborted = 'rate_limit';
        break;
      }
      if (consecutive >= MAX_CONSECUTIVE_ERRORS) {
        counts.aborted = 'too_many_errors';
        break;
      }
    }
  }
  return counts;
}

export interface Args {
  execute: boolean;
  scanLimit: number;
  json: boolean;
}

export function parseArgs(argv: string[]): Args {
  let execute = false;
  let dry = false;
  let json = false;
  let scanLimit: number | undefined;
  for (const arg of argv) {
    if (arg === '--execute') execute = true;
    else if (arg === '--dry-run') dry = true;
    else if (arg === '--json') json = true;
    else if (/^--scan-limit=\d+$/.test(arg)) scanLimit = Number(arg.slice('--scan-limit='.length));
    else throw new Error('Unbekannte Option (erlaubt: --execute, --dry-run, --scan-limit=N, --json)');
  }
  if (execute && dry) throw new Error('--execute und --dry-run schließen sich aus');
  return { execute, json, scanLimit: normalizeScanLimit(scanLimit) };
}

export function formatReport(mode: 'dry-run' | 'execute', counts: CleanupCounts, scanLimit: number): string {
  const lines = [
    `MagguuBot Willkommenskarten-Bereinigung · Modus: ${mode}`,
    `scanned=${counts.scanned} (Limit ${scanLimit}${counts.scanComplete ? ', Kanal vollständig gelesen' : ', Kanal evtl. noch älter'})`,
    `candidates=${counts.candidates} deleted=${counts.deleted} skipped=${counts.skipped} errors=${counts.errors}`,
    ...Object.entries(counts.skippedBy).map(([k, v]) => `  skipped.${k}=${v}`),
  ];
  if (counts.aborted) lines.push(`ABBRUCH: ${counts.aborted}`);
  if (mode === 'dry-run') lines.push('Dry-Run: es wurde nichts gelöscht. Zum Löschen: --execute (nicht wiederherstellbar).');
  return `${lines.join('\n')}\n`;
}

