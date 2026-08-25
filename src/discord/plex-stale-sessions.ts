import { EmbedBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { plexActivityMessages } from '../db/schema.js';
import { Colors } from '../embeds/colors.js';
import { getActiveSessions, terminateSession, type TautulliSession } from '../services/tautulli.js';
import { logger } from '../utils/logger.js';
import {
  decideStaleSession,
  nextProgressWatch,
  shouldCloseOrphanActivityCard,
  type PlexProgressWatch,
} from '../utils/plex-activity.js';
import { getClient } from './client.js';

const TERMINATE_COOLDOWN_MS = 5 * 60_000;
const lastProgress = new Map<string, PlexProgressWatch>();
const lastTerminatedAt = new Map<string, number>();

export async function runPlexStaleSessionTick(now = new Date()): Promise<void> {
  const staleAfterMs = config.PLEX_STALE_SESSION_MINUTES * 60_000;
  if (staleAfterMs <= 0 || !config.TAUTULLI_URL || !config.TAUTULLI_API_KEY) return;

  const sessions = await getActiveSessions();
  if (sessions === null) return;

  await terminateStaleSessions(sessions, staleAfterMs, now.getTime());
  await closeOrphanActivityCards(sessions, now);
}

async function terminateStaleSessions(
  sessions: TautulliSession[],
  staleAfterMs: number,
  nowMs: number,
): Promise<void> {
  const seen = new Set<string>();

  for (const session of sessions) {
    const id = session.sessionKey ?? session.sessionId;
    if (!id) continue;
    seen.add(id);

    const watch = nextProgressWatch(lastProgress.get(id), session.progressMs, nowMs);
    lastProgress.set(id, watch);

    const reason = decideStaleSession({
      state: session.state,
      pausedCounterSeconds: session.pausedCounterSeconds,
      live: session.live,
      progressWatch: watch,
      now: nowMs,
      staleAfterMs,
    });
    if (!reason) continue;

    const previous = lastTerminatedAt.get(id);
    if (previous !== undefined && nowMs - previous < TERMINATE_COOLDOWN_MS) continue;

    const ok = await terminateSession({
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      message: 'Wiedergabe automatisch beendet (keine aktive Session).',
    });
    if (!ok) continue;
    lastTerminatedAt.set(id, nowMs);
    logger.info(
      { user: session.user, player: session.player, reason, title: session.title },
      'stale Plex session terminated',
    );
  }

  for (const id of [...lastProgress.keys()]) {
    if (!seen.has(id)) lastProgress.delete(id);
  }
  for (const [id, terminatedAt] of lastTerminatedAt) {
    if (!seen.has(id) && nowMs - terminatedAt >= TERMINATE_COOLDOWN_MS) {
      lastTerminatedAt.delete(id);
    }
  }
}

async function closeOrphanActivityCards(sessions: TautulliSession[], now: Date): Promise<void> {
  const rows = db.select().from(plexActivityMessages).all();
  for (const row of rows) {
    if (!shouldCloseOrphanActivityCard({
      state: row.state,
      correlationKey: row.correlationKey,
      updatedAt: row.updatedAt,
      sessions,
      now,
    })) continue;

    try {
      const channel = await getClient().channels.fetch(row.channelId);
      if (!channel?.isTextBased() || !('messages' in channel)) {
        markStopped(row.id, now);
        continue;
      }
      const message = await channel.messages.fetch(row.messageId);
      const source = message.embeds[0];
      const embed = source
        ? EmbedBuilder.from(source)
        : new EmbedBuilder().setDescription(message.content || 'Plex');
      embed
        .setColor(Colors.muted)
        .setTitle('⏹️ Gestoppt')
        .setTimestamp(now)
        .setFooter({ text: 'MagguuBot · Plex-Aktivität' });
      await message.edit({ embeds: [embed] });
      markStopped(row.id, now);
    } catch (err) {
      if (isAlreadyGone(err)) {
        markStopped(row.id, now);
        continue;
      }
      logger.warn({ err, messageId: row.messageId }, 'orphan Plex activity stop failed');
    }
  }
}

function markStopped(id: number, now: Date): void {
  db.update(plexActivityMessages)
    .set({ state: 'stop', pausedAt: null, updatedAt: now })
    .where(eq(plexActivityMessages.id, id))
    .run();
}

function isAlreadyGone(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('code' in err)) return false;
  return err.code === 10_003 || err.code === 10_008;
}
