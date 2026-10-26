/**
 * ONE-TIME cleanup of the old public per-join welcome cards (removed from the bot on 2026-10-26). Not a feature:
 * no slash command, no tick, never runs on its own.
 *
 * Run INSIDE the bot container (token + guild come from its env, never printed):
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-welcome-cleanup.js              # DRY-RUN (default)
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-welcome-cleanup.js --execute    # really deletes
 * Options: --scan-limit=N (newest N messages, default 1000, max 10000), --json.
 *
 * Selector and safety rules: see welcome-cleanup.ts. Output is counters only (no names, ids or message text).
 * Deleted messages cannot be restored: check the dry-run number first.
 */
import { sqliteHandle } from '../db/client.js';
import { config } from '../config.js';
import { getChannel } from '../discord/channel-store.js';
import { DiscordRest } from './rest.js';
import { formatReport, parseArgs, runWelcomeCleanup } from './welcome-cleanup.js';

function safeAll(sql: string, ...params: unknown[]): Array<Record<string, unknown>> {
  try {
    return sqliteHandle.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

async function main(): Promise<{ code: number; output: string }> {
  const args = parseArgs(process.argv.slice(2));
  const guildId = config.DISCORD_GUILD_ID;
  const channelId = getChannel('welcome');
  if (!channelId) return { code: 1, output: 'Kein Willkommen-Kanal (Key welcome) konfiguriert: nichts zu tun.\n' };

  const rest = new DiscordRest(config.DISCORD_TOKEN, 'MagguuBot one-time welcome card cleanup');
  const me = (await rest.request<{ id: string }>('GET', '/users/@me')) as { id: string };
  const trackedIds = new Set<string>();
  for (const r of safeAll('SELECT message_id FROM welcome_messages WHERE guild_id = ?', guildId)) {
    if (typeof r.message_id === 'string') trackedIds.add(r.message_id);
  }
  const counter = safeAll('SELECT message_id FROM welcome_counter_card WHERE guild_id = ? AND channel_id = ?', guildId, channelId)[0];
  const counterId = typeof counter?.message_id === 'string' ? counter.message_id : null;

  const ctx = { channelId, botId: me.id, trackedIds, counterId };
  const counts = await runWelcomeCleanup({ rest, ctx, scanLimit: args.scanLimit, execute: args.execute });
  const mode = args.execute ? 'execute' : 'dry-run';
  const code = counts.aborted ? 2 : counts.errors > 0 ? 2 : 0;
  const output = args.json ? `${JSON.stringify({ mode, ...counts })}\n` : formatReport(mode, counts, args.scanLimit);
  return { code, output };
}

main().then(
  ({ code, output }) => process.stdout.write(output, () => process.exit(code)),
  (err: unknown) => {
    // Only the message of our own errors (no headers/token); DiscordError text carries ids, so print status only.
    const status = (err as { status?: number }).status;
    process.stderr.write(`Bereinigung fehlgeschlagen${status ? ` (HTTP ${status})` : `: ${(err as Error).message.slice(0, 120)}`}\n`);
    process.exit(1);
  },
);
