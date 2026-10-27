import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { plexCleanupState } from '../db/schema.js';
import { protectedMessageIds } from '../rollout/live.js';
import { logger } from '../utils/logger.js';
import { classifyCleanupMessage, type CleanupMessageView } from '../utils/plex-card-cleanup.js';
import { getClient } from './client.js';
import { discordErrorCode, type PlexCardSyncStatus } from './plex-card-manager.js';

/**
 * One-time removal of the old Plex activity cards (the former single card and earlier Plex cards) in the
 * configured Plex channel, after the per-user cards are live.
 *
 * Hard rules: bot-authored messages with a former Plex-activity footer only (see utils/plex-card-cleanup.ts);
 * messages tracked in SQLite (user cards, weekly card, digest, ...) are never touched; single `message.delete()`
 * calls with a delay, never a bulk delete; the result is persisted so it runs once, also across restarts.
 *
 * Grep the container log for `Plex card cleanup finished` (field `deleted`).
 */

export const PLEX_CLEANUP_PAGE_SIZE = 100;
/** The cleanup must see the per-user cards in sync for this long, and no post for this long, before it starts. */
export const PLEX_CLEANUP_STABLE_MS = 60_000;
export const PLEX_CLEANUP_DELETE_DELAY_MS = 1_200;
export const PLEX_CLEANUP_PAGE_DELAY_MS = 600;
/** Retry of an aborted run (permissions/channel) after this long; after the attempt limit it stays failed. */
export const PLEX_CLEANUP_RETRY_MS = 6 * 60 * 60_000;
export const PLEX_CLEANUP_MAX_ATTEMPTS = 3;
const MAX_CONSECUTIVE_PERMISSION_ERRORS = 3;
const MAX_CONSECUTIVE_ERRORS = 5;

export interface CleanupChannel {
  messages: {
    fetch(options: { limit: number; before?: string }): Promise<{ values(): IterableIterator<CleanupRawMessage> }>;
  };
}

/** The slice of a discord.js Message the cleanup reads. */
export interface CleanupRawMessage {
  id: string;
  author: { id: string };
  pinned: boolean;
  content: string;
  embeds: Array<{ title?: string | null; author?: { name?: string | null } | null; footer?: { text?: string | null } | null }>;
  delete(): Promise<unknown>;
}

export type CleanupStatus = 'done' | 'aborted' | 'failed';

export interface CleanupStateRow {
  status: CleanupStatus;
  attempts: number;
  scanned: number;
  candidates: number;
  deleted: number;
  skipped: number;
  errors: number;
  scanLimit: number;
  finishedAt: number;
}

export interface CleanupStateStore {
  load(): CleanupStateRow | null;
  save(row: CleanupStateRow): void;
}

export interface CleanupDeps {
  channel: CleanupChannel;
  botId: string;
  protectedIds: ReadonlySet<string>;
  state: CleanupStateStore;
  scanLimit: number;
  dryRun: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  deleteDelayMs?: number;
  pageDelayMs?: number;
  /**
   * Re-checked before every single delete (emergency brake while a run is in progress). When it turns false the
   * run stops at once and persists nothing, so the next enabled run starts clean (attempt counter untouched).
   */
  enabled?: () => boolean;
  log?: (level: 'info' | 'warn', msg: string, data?: Record<string, unknown>) => void;
}

export interface CleanupOutcome {
  ran: boolean;
  dryRun: boolean;
  status: CleanupStatus | 'dry-run' | 'skipped';
  scanned: number;
  candidates: number;
  deleted: number;
  skipped: number;
  errors: number;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => {
  const handle = setTimeout(resolve, ms);
  handle.unref?.();
});

/** Snowflake compare without precision loss. */
function olderId(a: string, b: string): boolean {
  try {
    return BigInt(a) < BigInt(b);
  } catch {
    return a.length === b.length ? a < b : a.length < b.length;
  }
}

function isChannelLevel(code: number | null): boolean {
  return code === 50_001 || code === 10_003;
}

/**
 * Whether a persisted result still blocks a new run.
 *
 * `done` normally stays final. One deliberate exception: when that run stopped at its scan limit (it scanned as
 * many messages as its limit allowed, so older cards beyond it may remain) and the configured limit has since
 * been RAISED, the run is not final and starts again with the new limit (same classifier, same protected set,
 * same gate, same pacing). This is the intended way to re-run: raise PLEX_CARD_CLEANUP_SCAN_LIMIT (max 2000).
 */
export function cleanupIsFinal(row: CleanupStateRow | null, now: number, scanLimit?: number): boolean {
  if (!row) return false;
  if (row.status === 'done') {
    const stoppedAtLimit = row.scanLimit > 0 && row.scanned >= row.scanLimit;
    return !(scanLimit !== undefined && stoppedAtLimit && scanLimit > row.scanLimit);
  }
  if (row.status === 'failed') return true;
  return now - row.finishedAt < PLEX_CLEANUP_RETRY_MS;
}

/**
 * The core run: scan (paginated, bounded), classify, log the candidate count, delete one by one, log the
 * result, persist it. Dry run only counts and logs; it persists nothing, so a later real run still happens.
 */
export async function runPlexCardCleanup(deps: CleanupDeps): Promise<CleanupOutcome> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? realSleep;
  const log = deps.log ?? (() => {});
  const deleteDelay = deps.deleteDelayMs ?? PLEX_CLEANUP_DELETE_DELAY_MS;
  const pageDelay = deps.pageDelayMs ?? PLEX_CLEANUP_PAGE_DELAY_MS;
  const previous = deps.state.load();
  const outcome: CleanupOutcome = {
    ran: true, dryRun: deps.dryRun, status: 'done', scanned: 0, candidates: 0, deleted: 0, skipped: 0, errors: 0,
  };
  if (!deps.dryRun && cleanupIsFinal(previous, now(), deps.scanLimit)) return { ...outcome, ran: false, status: 'skipped' };

  // A re-run after a raised scan limit (previous run `done`) is a fresh run with its own attempt budget.
  const attempts = previous?.status === 'done' ? 1 : (previous?.attempts ?? 0) + 1;
  const persist = (status: CleanupStatus): void => {
    if (deps.dryRun) return;
    deps.state.save({
      status, attempts, scanned: outcome.scanned, candidates: outcome.candidates, deleted: outcome.deleted,
      skipped: outcome.skipped, errors: outcome.errors, scanLimit: deps.scanLimit, finishedAt: now(),
    });
  };
  const abort = (reason: string, code: number | null): CleanupOutcome => {
    const status: CleanupStatus = attempts >= PLEX_CLEANUP_MAX_ATTEMPTS ? 'failed' : 'aborted';
    persist(status);
    outcome.status = deps.dryRun ? 'dry-run' : status;
    log('warn', 'Plex card cleanup aborted', {
      reason, code, attempt: attempts, status, scanned: outcome.scanned, candidates: outcome.candidates,
      deleted: outcome.deleted, skipped: outcome.skipped, errors: outcome.errors,
    });
    return outcome;
  };

  // 1. scan: newest first, `before` pagination, bounded by scanLimit
  const candidates: CleanupRawMessage[] = [];
  const skipReasons: Record<string, number> = {};
  let before: string | undefined;
  let scanLimitReached = false;
  try {
    while (outcome.scanned < deps.scanLimit) {
      const limit = Math.min(PLEX_CLEANUP_PAGE_SIZE, deps.scanLimit - outcome.scanned);
      const page = [...(await deps.channel.messages.fetch(before ? { limit, before } : { limit })).values()];
      if (page.length === 0) break;
      let oldest = page[0]!.id;
      for (const raw of page) {
        if (olderId(raw.id, oldest)) oldest = raw.id;
        outcome.scanned += 1;
        const view: CleanupMessageView = {
          id: raw.id,
          authorId: raw.author.id,
          pinned: raw.pinned,
          content: raw.content ?? '',
          embeds: raw.embeds.map((e) => ({ title: e.title ?? null, author: e.author?.name ?? null, footer: e.footer?.text ?? null })),
        };
        const verdict = classifyCleanupMessage(view, { botId: deps.botId, protectedIds: deps.protectedIds });
        if (verdict === 'candidate') candidates.push(raw);
        else skipReasons[verdict] = (skipReasons[verdict] ?? 0) + 1;
      }
      before = oldest;
      if (page.length < limit) break;
      if (outcome.scanned >= deps.scanLimit) scanLimitReached = true;
      else await sleep(pageDelay);
    }
  } catch (err) {
    return abort('scan failed', discordErrorCode(err));
  }
  outcome.candidates = candidates.length;
  log('info', 'Plex card cleanup: candidates found', {
    candidates: candidates.length, scanned: outcome.scanned, scanLimit: deps.scanLimit, scanLimitReached,
    dryRun: deps.dryRun, kept: skipReasons,
  });

  // 2. dry run: counted and logged, nothing deleted, nothing persisted
  if (deps.dryRun) {
    outcome.status = 'dry-run';
    log('info', 'Plex card cleanup finished', {
      status: 'dry-run', dryRun: true, wouldDelete: candidates.length, deleted: 0, skipped: 0, errors: 0,
      scanned: outcome.scanned, scanLimit: deps.scanLimit,
    });
    return outcome;
  }

  // 3. delete one by one (never bulkDelete), polite delay in between
  let consecutivePermission = 0;
  let consecutiveErrors = 0;
  for (const message of candidates) {
    if (deps.enabled && !deps.enabled()) {
      outcome.status = 'aborted';
      log('warn', 'Plex card cleanup stopped: disabled while running', {
        deleted: outcome.deleted, skipped: outcome.skipped, errors: outcome.errors, remaining: candidates.length - outcome.deleted - outcome.skipped - outcome.errors,
      });
      return outcome;
    }
    try {
      await message.delete();
      outcome.deleted += 1;
      consecutivePermission = 0;
      consecutiveErrors = 0;
    } catch (err) {
      const code = discordErrorCode(err);
      if (isChannelLevel(code)) {
        outcome.errors += 1;
        return abort('channel-level Discord error', code);
      }
      if (code === 10_008) {
        outcome.skipped += 1; // already gone
        consecutivePermission = 0;
        consecutiveErrors = 0;
      } else if (code === 50_013) {
        outcome.errors += 1;
        consecutivePermission += 1;
        if (consecutivePermission >= MAX_CONSECUTIVE_PERMISSION_ERRORS) return abort('missing permissions', code);
      } else {
        outcome.errors += 1;
        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) return abort('repeated delete errors', code);
      }
    }
    await sleep(deleteDelay);
  }

  // Leftover cards (delete errors that are not 'already gone'): not 'done' - a bounded retry (the same 6 h spacing
  // and 3-attempt cap as an abort) rescans and only ever sees what is left. Lower risk than silently leaving
  // stale cards: the retry uses the identical classification, protected set and politeness, and it ends by itself.
  if (outcome.errors > 0) {
    const status: CleanupStatus = attempts >= PLEX_CLEANUP_MAX_ATTEMPTS ? 'failed' : 'aborted';
    persist(status);
    outcome.status = status;
    log('warn', 'Plex card cleanup finished with leftovers', {
      status, attempt: attempts, dryRun: false, deleted: outcome.deleted, skipped: outcome.skipped, errors: outcome.errors,
      candidates: outcome.candidates, scanned: outcome.scanned, scanLimit: deps.scanLimit, scanLimitReached,
    });
    return outcome;
  }

  persist('done');
  log('info', 'Plex card cleanup finished', {
    status: 'done', dryRun: false, deleted: outcome.deleted, skipped: outcome.skipped, errors: outcome.errors,
    candidates: outcome.candidates, scanned: outcome.scanned, scanLimit: deps.scanLimit, scanLimitReached,
  });
  return outcome;
}

// ─── wiring: scheduler gate + SQLite state ───────────────────────────────────

export function plexCleanupStateStore(channelId: string): CleanupStateStore {
  const where = and(eq(plexCleanupState.guildId, config.DISCORD_GUILD_ID), eq(plexCleanupState.channelId, channelId));
  return {
    load() {
      const row = db.select().from(plexCleanupState).where(where).get();
      if (!row) return null;
      return {
        status: row.status === 'done' || row.status === 'failed' ? row.status : 'aborted',
        attempts: row.attempts, scanned: row.scanned, candidates: row.candidates, deleted: row.deleted,
        skipped: row.skipped, errors: row.errors, scanLimit: row.scanLimit, finishedAt: row.finishedAt.getTime(),
      };
    },
    save(row) {
      const values = {
        guildId: config.DISCORD_GUILD_ID,
        channelId,
        status: row.status,
        attempts: row.attempts,
        scanned: row.scanned,
        candidates: row.candidates,
        deleted: row.deleted,
        skipped: row.skipped,
        errors: row.errors,
        scanLimit: row.scanLimit,
        finishedAt: new Date(row.finishedAt),
      };
      db.insert(plexCleanupState).values(values).onConflictDoUpdate({
        target: [plexCleanupState.guildId, plexCleanupState.channelId],
        set: values,
      }).run();
    },
  };
}

/** The slice of the discord.js client the tick touches (injectable so tests can prove it is never reached). */
export interface CleanupClient {
  user?: { id: string } | null;
  channels: { fetch(id: string): Promise<{ isTextBased(): boolean } | null> };
}

export interface CleanupGateState {
  syncedSince: number | null;
  running: boolean;
  dryRunDone: boolean;
}

export const cleanupGate: CleanupGateState = { syncedSince: null, running: false, dryRunDone: false };

/** Test seam: forget what this process observed. */
export function resetCleanupGate(): void {
  cleanupGate.syncedSince = null;
  cleanupGate.running = false;
  cleanupGate.dryRunDone = false;
}

/**
 * Pure gate: 'start' only when the per-user cards are live - at least one posted card, every card showing its
 * current state, no pause, a full minute of that in a row, and no card posted in the last minute. The first call
 * that sees the synced state only starts the clock, so the cleanup can never run in the tick that created the cards.
 */
export function evaluateCleanupGate(
  sync: PlexCardSyncStatus,
  now: number,
  gate: CleanupGateState = cleanupGate,
): 'start' | 'wait' {
  const live = sync.posted >= 1 && sync.unsynced === 0 && !sync.paused;
  if (!live) {
    gate.syncedSince = null;
    return 'wait';
  }
  if (gate.syncedSince === null) {
    gate.syncedSince = now;
    return 'wait';
  }
  if (now - gate.syncedSince < PLEX_CLEANUP_STABLE_MS) return 'wait';
  if (sync.lastPostAt !== 0 && now - sync.lastPostAt < PLEX_CLEANUP_STABLE_MS) return 'wait';
  return 'start';
}

/**
 * Called at the end of every Plex card tick (30 s); see `evaluateCleanupGate` for when it actually starts.
 */
export async function runPlexCardCleanupTick(
  channelId: string,
  sync: PlexCardSyncStatus,
  now = Date.now(),
  run: (deps: CleanupDeps) => Promise<CleanupOutcome> = runPlexCardCleanup,
  resolveClient: () => CleanupClient = getClient as unknown as () => CleanupClient,
): Promise<CleanupOutcome | null> {
  if (!config.PLEX_CARD_CLEANUP_ENABLED || cleanupGate.running) return null;
  if (config.PLEX_CARD_CLEANUP_DRY_RUN && cleanupGate.dryRunDone) return null;
  const store = plexCleanupStateStore(channelId);
  if (!config.PLEX_CARD_CLEANUP_DRY_RUN && cleanupIsFinal(store.load(), now, config.PLEX_CARD_CLEANUP_SCAN_LIMIT)) return null;

  if (evaluateCleanupGate(sync, now) !== 'start') return null;

  cleanupGate.running = true;
  try {
    const client = resolveClient();
    const botId = client.user?.id;
    if (!botId) return null;
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !('messages' in channel)) return null;
    const outcome = await run({
      channel: channel as unknown as CleanupChannel,
      botId,
      // everything the bot tracks as live - except the two tables of the former Plex cards, which are the target
      protectedIds: protectedMessageIds(['plex_activity_card', 'plex_activity_messages']),
      state: store,
      scanLimit: config.PLEX_CARD_CLEANUP_SCAN_LIMIT,
      dryRun: config.PLEX_CARD_CLEANUP_DRY_RUN,
      enabled: () => config.PLEX_CARD_CLEANUP_ENABLED,
      log: (level, msg, data) => logger[level](data ?? {}, msg),
    });
    if (config.PLEX_CARD_CLEANUP_DRY_RUN) cleanupGate.dryRunDone = true;
    return outcome;
  } catch (err) {
    logger.warn({ err, code: discordErrorCode(err) }, 'Plex card cleanup could not start');
    return null;
  } finally {
    cleanupGate.running = false;
  }
}
