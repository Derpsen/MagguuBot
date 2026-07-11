import { Hono } from 'hono';
import { ChannelType, type GuildTextBasedChannel } from 'discord.js';
import { and, desc, eq, gt, isNull, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import {
  adminAuditLog,
  autoresponders,
  customCommands,
  reminders,
  livePanels,
  reputation,
  rolePanels,
  rssFeeds,
  scheduledAnnouncements,
  seerrRequests,
  starboardPosts,
  tickets,
  userXp,
  warnings,
  webhookEvents,
  type RolePanelEntry,
} from '../../db/schema.js';
import { invalidateAutoresponderCache } from '../../discord/autoresponder.js';
import { getChannel, saveChannel, type ChannelKey } from '../../discord/channel-store.js';
import { getClient } from '../../discord/client.js';
import { approveSeerrRequest, declineSeerrRequest } from '../../services/seerr.js';
import { getAllSettings, setSetting } from '../../settings.js';
import { logger } from '../../utils/logger.js';
import { recordAdminAudit } from '../auth/audit.js';
import { getSession, requireAdmin } from '../auth/middleware.js';
import { revokeUserSessions } from '../auth/revocations.js';
import { clearSessionCookie } from '../auth/session.js';
import { attemptWebhookEvent, recordFailedWebhookAttempt } from '../webhook-retry.js';
import { getServiceHealth } from '../service-health.js';
import {
  isReplayableWebhookSource,
  webhookReplayBlockReason,
} from '../webhook-sources.js';
import { parseWebhookClearScope } from './webhook-clear-scope.js';

export const adminRouter = new Hono();

adminRouter.use('*', requireAdmin);

function parsePositiveId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

adminRouter.get('/me', (c) => {
  const session = getSession(c);
  return c.json({
    id: session.userId,
    username: session.username,
    globalName: session.globalName,
    avatarUrl: session.avatarUrl,
  });
});

adminRouter.post('/logout', (c) => {
  recordAdminAudit(c, { action: 'session.logout' });
  clearSessionCookie(c);
  return c.json({ ok: true });
});

const globalSearchSchema = z.string().trim().min(2).max(100);

adminRouter.get('/search', async (c) => {
  const parsed = globalSearchSchema.safeParse(c.req.query('q'));
  if (!parsed.success) return c.json({ results: [] });
  const query = parsed.data;
  const pattern = `%${query}%`;
  const guild = getClient().guilds.cache.get(config.DISCORD_GUILD_ID);
  const normalized = query.toLocaleLowerCase('de-DE');
  const memberResults = guild
    ? [...guild.members.cache.values()]
      .filter((member) =>
        member.id.includes(query)
        || member.displayName.toLocaleLowerCase('de-DE').includes(normalized)
        || member.user.username.toLocaleLowerCase('de-DE').includes(normalized),
      )
      .slice(0, 6)
      .map((member) => ({
        kind: 'user',
        label: member.displayName,
        description: `Nutzer · ${member.user.username}`,
        to: '/leaderboard',
      }))
    : [];
  const requestResults = db
    .select({ id: seerrRequests.id, title: seerrRequests.title, status: seerrRequests.status, requestedBy: seerrRequests.requestedBy })
    .from(seerrRequests)
    .where(or(like(seerrRequests.title, pattern), like(seerrRequests.requestedBy, pattern)))
    .orderBy(desc(seerrRequests.createdAt))
    .limit(6)
    .all()
    .map((row) => ({ kind: 'request', label: row.title, description: `Seerr · ${row.status}${row.requestedBy ? ` · ${row.requestedBy}` : ''}`, to: '/requests' }));
  const ticketResults = db
    .select({ id: tickets.id, topic: tickets.topic, openerId: tickets.openerId, closedAt: tickets.closedAt })
    .from(tickets)
    .where(or(like(tickets.topic, pattern), like(tickets.openerId, pattern), like(tickets.channelId, pattern)))
    .orderBy(desc(tickets.createdAt))
    .limit(6)
    .all()
    .map((row) => ({ kind: 'ticket', label: `Ticket #${row.id}`, description: `${row.closedAt ? 'geschlossen' : 'offen'} · ${row.topic ?? 'ohne Thema'}`, to: '/tickets' }));
  const warningResults = db
    .select({ id: warnings.id, userId: warnings.userId, reason: warnings.reason })
    .from(warnings)
    .where(or(like(warnings.reason, pattern), like(warnings.userId, pattern), like(warnings.moderatorId, pattern)))
    .orderBy(desc(warnings.createdAt))
    .limit(6)
    .all()
    .map((row) => ({ kind: 'warning', label: `Verwarnung #${row.id}`, description: `${row.reason ?? 'ohne Grund'} · ${row.userId}`, to: '/warnings' }));
  const webhookResults = db
    .select({ id: webhookEvents.id, source: webhookEvents.source, eventType: webhookEvents.eventType, status: webhookEvents.status })
    .from(webhookEvents)
    .where(or(like(webhookEvents.source, pattern), like(webhookEvents.eventType, pattern), like(webhookEvents.error, pattern)))
    .orderBy(desc(webhookEvents.createdAt))
    .limit(6)
    .all()
    .map((row) => ({ kind: 'webhook', label: `${row.source} · ${row.eventType}`, description: `Webhook · ${row.status} · #${row.id}`, to: '/webhooks' }));
  return c.json({ results: [...memberResults, ...requestResults, ...ticketResults, ...warningResults, ...webhookResults].slice(0, 20) });
});

adminRouter.get('/stats', async (c) => {
  const warningsCount =
    db
      .select({ count: sql<number>`count(*)` })
      .from(warnings)
      .where(eq(warnings.guildId, config.DISCORD_GUILD_ID))
      .get()?.count ?? 0;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const webhooksLast24h =
    db
      .select({ count: sql<number>`count(*)` })
      .from(webhookEvents)
      .where(gt(webhookEvents.createdAt, since))
      .get()?.count ?? 0;

  const topXp = db
    .select()
    .from(userXp)
    .where(eq(userXp.guildId, config.DISCORD_GUILD_ID))
    .orderBy(desc(userXp.xp))
    .limit(1)
    .get();

  let topUser: { username: string; xp: number; level: number } | null = null;
  if (topXp) {
    const resolved = await resolveUsername(topXp.userId);
    topUser = { username: resolved, xp: topXp.xp, level: topXp.level };
  }

  const recentWarnings = db
    .select()
    .from(warnings)
    .where(eq(warnings.guildId, config.DISCORD_GUILD_ID))
    .orderBy(desc(warnings.createdAt))
    .limit(5)
    .all();

  const recentActions = await Promise.all(
    recentWarnings.map(async (w) => ({
      id: w.id,
      action: 'warn',
      moderator: await resolveUsername(w.moderatorId),
      target: await resolveUsername(w.userId),
      createdAt: w.createdAt.toISOString(),
    })),
  );

  const remindersCount =
    db
      .select({ count: sql<number>`count(*)` })
      .from(reminders)
      .where(eq(reminders.guildId, config.DISCORD_GUILD_ID))
      .get()?.count ?? 0;
  const pendingSeerrCount =
    db
      .select({ count: sql<number>`count(*)` })
      .from(seerrRequests)
      .where(eq(seerrRequests.status, 'pending'))
      .get()?.count ?? 0;
  const starboardCount =
    db.select({ count: sql<number>`count(*)` }).from(starboardPosts).get()?.count ?? 0;
  const tagsCount =
    db.select({ count: sql<number>`count(*)` }).from(customCommands).get()?.count ?? 0;
  const openTicketsCount =
    db
      .select({ count: sql<number>`count(*)` })
      .from(tickets)
      .where(and(eq(tickets.guildId, config.DISCORD_GUILD_ID), isNull(tickets.closedAt)))
      .get()?.count ?? 0;
  const scheduledPending =
    db
      .select({ count: sql<number>`count(*)` })
      .from(scheduledAnnouncements)
      .where(
        and(
          eq(scheduledAnnouncements.guildId, config.DISCORD_GUILD_ID),
          eq(scheduledAnnouncements.fired, false),
        ),
      )
      .get()?.count ?? 0;
  const downloadPanel = db
    .select({ enabled: livePanels.enabled })
    .from(livePanels)
    .where(and(eq(livePanels.guildId, config.DISCORD_GUILD_ID), eq(livePanels.kind, 'downloads')))
    .get();

  return c.json({
    uptimeSeconds: Math.floor(process.uptime()),
    warningsCount,
    webhooksLast24h,
    topUser,
    recentActions,
    remindersCount,
    pendingSeerrCount,
    starboardCount,
    tagsCount,
    openTicketsCount,
    scheduledPending,
    automations: {
      weeklyDigest: config.WEEKLY_DIGEST_ENABLED && Boolean(getChannel('weeklyDigest')),
      downloadLive: Boolean(getChannel('downloadLive')) && downloadPanel?.enabled !== false,
      movieNight: Boolean(getChannel('movieNight')),
      automaticBackup: config.AUTOMATIC_BACKUP_ENABLED,
      webhookRetry: config.WEBHOOK_RETRY_ENABLED,
      plexActivityRetentionDays: config.PLEX_ACTIVITY_RETENTION_DAYS,
    },
  });
});

adminRouter.get('/services/health', async (c) => {
  return c.json({ services: await getServiceHealth(c.req.query('force') === 'true') });
});

adminRouter.get('/warnings', async (c) => {
  const rows = db
    .select()
    .from(warnings)
    .where(eq(warnings.guildId, config.DISCORD_GUILD_ID))
    .orderBy(desc(warnings.createdAt))
    .limit(200)
    .all();
  return c.json(
    await Promise.all(
      rows.map(async (w) => ({
        id: w.id,
        userId: w.userId,
        username: await resolveUsername(w.userId),
        moderatorId: w.moderatorId,
        moderator: await resolveUsername(w.moderatorId),
        reason: w.reason,
        createdAt: w.createdAt.toISOString(),
      })),
    ),
  );
});

adminRouter.delete('/warnings/:id', async (c) => {
  const id = parsePositiveId(c.req.param('id'));
  if (id === null) return c.json({ ok: false, error: 'bad id' }, 400);
  db.delete(warnings)
    .where(and(eq(warnings.guildId, config.DISCORD_GUILD_ID), eq(warnings.id, id)))
    .run();
  recordAdminAudit(c, { action: 'warning.delete', target: String(id) });
  return c.json({ ok: true });
});

adminRouter.get('/xp', async (c) => {
  const rows = db
    .select()
    .from(userXp)
    .where(eq(userXp.guildId, config.DISCORD_GUILD_ID))
    .orderBy(desc(userXp.xp))
    .limit(50)
    .all();
  const enriched = await Promise.all(
    rows.map(async (r) => ({
      userId: r.userId,
      username: await resolveUsername(r.userId),
      xp: r.xp,
      level: r.level,
      messagesCounted: r.messagesCounted,
    })),
  );
  return c.json(enriched);
});

adminRouter.get('/webhooks', (c) => {
  const rows = db
    .select()
    .from(webhookEvents)
    .orderBy(desc(webhookEvents.createdAt))
    .limit(100)
    .all();
  return c.json(
    rows.map((r) => ({
      id: r.id,
      source: r.source,
      replayable: isReplayableWebhookSource(r.source),
      eventType: r.eventType,
      status: r.status,
      error: r.error,
      channelId: r.channelId,
      retryCount: r.retryCount,
      retryState: r.retryState,
      nextRetryAt: r.nextRetryAt?.toISOString() ?? null,
      replayOfEventId: r.replayOfEventId,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

interface WebhookHealthRow {
  source: string;
  total: number;
  posted: number;
  failed: number;
  skipped: number;
  last_event_at: number | null;
  last_error_at: number | null;
  last_error: string | null;
}

adminRouter.get('/webhooks/health', (c) => {
  const since = Math.floor(Date.now()) - 24 * 60 * 60 * 1000;
  const rows = db.all(sql<WebhookHealthRow>`
    SELECT
      source,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) AS posted,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
      MAX(created_at) AS last_event_at,
      MAX(CASE WHEN status = 'failed' THEN created_at END) AS last_error_at,
      (
        SELECT error FROM webhook_events e2
        WHERE e2.source = webhook_events.source
          AND e2.status = 'failed'
        ORDER BY e2.created_at DESC
        LIMIT 1
      ) AS last_error
    FROM webhook_events
    WHERE created_at >= ${since}
    GROUP BY source
    ORDER BY total DESC
  `) as WebhookHealthRow[];

  return c.json({
    sinceIso: new Date(since).toISOString(),
    sources: rows.map((r) => ({
      source: r.source,
      total: Number(r.total),
      posted: Number(r.posted),
      failed: Number(r.failed),
      skipped: Number(r.skipped),
      lastEventAt: r.last_event_at ? new Date(Number(r.last_event_at)).toISOString() : null,
      lastErrorAt: r.last_error_at ? new Date(Number(r.last_error_at)).toISOString() : null,
      lastError: r.last_error,
    })),
  });
});

adminRouter.post('/webhooks/:id/replay', async (c) => {
  const id = parsePositiveId(c.req.param('id'));
  if (id === null) return c.json({ ok: false, error: 'bad id' }, 400);
  const event = db.select().from(webhookEvents).where(eq(webhookEvents.id, id)).get();
  if (!event) return c.json({ ok: false, error: 'event not found' }, 404);
  const replayBlockReason = webhookReplayBlockReason(event.source, event.status);
  if (replayBlockReason === 'unsupported-source') {
    return c.json({ ok: false, error: `source ${event.source} does not support replay` }, 422);
  }
  if (replayBlockReason === 'already-posted') {
    return c.json({ ok: false, error: 'successfully posted events cannot be replayed' }, 409);
  }
  try {
    const retry = await attemptWebhookEvent(event);
    const response = retry.response;
    const result = await response.json().catch(() => null) as unknown;
    recordAdminAudit(c, {
      action: 'webhook.replay',
      target: String(id),
      detail: { source: event.source, eventType: event.eventType, status: response.status },
    });
    if (!response.ok) {
      return c.json({ ok: false, error: 'replay rejected', status: response.status, result }, 502);
    }
    if (!retry.success) {
      return c.json({ ok: false, error: 'replay did not produce a successful delivery', generatedStatuses: retry.generatedStatuses }, 502);
    }
    return c.json({ ok: retry.success, status: response.status, result, generatedStatuses: retry.generatedStatuses });
  } catch (err) {
    try {
      recordFailedWebhookAttempt(event);
    } catch (stateErr) {
      logger.error({ err: stateErr, eventId: id }, 'failed to record manual webhook replay failure');
    }
    logger.warn({ err, eventId: id, source: event.source }, 'webhook replay failed');
    return c.json({ ok: false, error: err instanceof Error ? err.message : 'replay failed' }, 422);
  }
});

// ─── RSS feeds ───────────────────────────────────────────────────────────────

const rssFeedInput = z.object({
  name: z.string().trim().min(1).max(60),
  url: z.string().trim().url().max(500).refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, 'feed URL must use http or https'),
  channelId: z.string().regex(/^\d{17,20}$/),
  excludeKeywords: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  enabled: z.boolean().optional(),
});

async function isConfiguredGuildTextChannel(channelId: string): Promise<boolean> {
  const guild = await getClient().guilds.fetch(config.DISCORD_GUILD_ID).catch(() => null);
  if (!guild) return false;
  const channel = guild.channels.cache.get(channelId)
    ?? await guild.channels.fetch(channelId).catch(() => null);
  return channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement;
}

adminRouter.get('/rss', (c) => {
  const rows = db
    .select()
    .from(rssFeeds)
    .where(eq(rssFeeds.guildId, config.DISCORD_GUILD_ID))
    .all();
  return c.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      url: r.url,
      channelId: r.channelId,
      excludeKeywords: r.excludeKeywords ? JSON.parse(r.excludeKeywords) : [],
      enabled: r.enabled,
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
      lastError: r.lastError,
      lastErrorAt: r.lastErrorAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

adminRouter.post('/rss', async (c) => {
  const session = getSession(c);
  const body = await c.req.json().catch(() => null);
  const parsed = rssFeedInput.safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: 'invalid input' }, 400);
  if (!await isConfiguredGuildTextChannel(parsed.data.channelId)) {
    return c.json({ ok: false, error: 'channel not found in configured guild' }, 422);
  }
  const row = db
    .insert(rssFeeds)
    .values({
      guildId: config.DISCORD_GUILD_ID,
      name: parsed.data.name,
      url: parsed.data.url,
      channelId: parsed.data.channelId,
      excludeKeywords: parsed.data.excludeKeywords ? JSON.stringify(parsed.data.excludeKeywords) : null,
      enabled: parsed.data.enabled ?? true,
      createdBy: session.userId,
    })
    .returning({ id: rssFeeds.id })
    .get();
  return c.json({ ok: true, id: row?.id });
});

adminRouter.patch('/rss/:id', async (c) => {
  const id = parsePositiveId(c.req.param('id'));
  if (id === null) return c.json({ ok: false, error: 'bad id' }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = rssFeedInput.partial().safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: 'invalid input' }, 400);
  if (parsed.data.channelId !== undefined && !await isConfiguredGuildTextChannel(parsed.data.channelId)) {
    return c.json({ ok: false, error: 'channel not found in configured guild' }, 422);
  }
  const update: Partial<typeof rssFeeds.$inferInsert> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.url !== undefined) update.url = parsed.data.url;
  if (parsed.data.channelId !== undefined) update.channelId = parsed.data.channelId;
  if (parsed.data.excludeKeywords !== undefined) {
    update.excludeKeywords = parsed.data.excludeKeywords.length > 0
      ? JSON.stringify(parsed.data.excludeKeywords)
      : null;
  }
  if (parsed.data.enabled !== undefined) update.enabled = parsed.data.enabled;
  if (Object.keys(update).length === 0) return c.json({ ok: true });
  db.update(rssFeeds)
    .set(update)
    .where(and(eq(rssFeeds.guildId, config.DISCORD_GUILD_ID), eq(rssFeeds.id, id)))
    .run();
  return c.json({ ok: true });
});

adminRouter.delete('/rss/:id', (c) => {
  const id = parsePositiveId(c.req.param('id'));
  if (id === null) return c.json({ ok: false, error: 'bad id' }, 400);
  db.delete(rssFeeds)
    .where(and(eq(rssFeeds.guildId, config.DISCORD_GUILD_ID), eq(rssFeeds.id, id)))
    .run();
  return c.json({ ok: true });
});

adminRouter.delete('/webhooks', (c) => {
  const scope = parseWebhookClearScope(c.req.query('scope'));
  if (scope === null) return c.json({ ok: false, error: 'invalid scope' }, 400);
  let result: { changes: number };
  if (scope === 'failed') {
    result = db.delete(webhookEvents).where(eq(webhookEvents.status, 'failed')).run();
  } else if (scope === 'skipped') {
    result = db.delete(webhookEvents).where(eq(webhookEvents.status, 'skipped')).run();
  } else {
    result = db.delete(webhookEvents).run();
  }
  logger.info({ scope, deleted: result.changes }, 'webhook events cleared via dashboard');
  recordAdminAudit(c, { action: 'webhook_events.clear', target: scope, detail: { deleted: result.changes } });
  return c.json({ ok: true, deleted: result.changes });
});

// ─── Settings ────────────────────────────────────────────────────────────────

const settingsSchema = z.object({
  starboardThreshold: z.number().int().min(1).max(1000).optional(),
  starboardEmoji: z.string().min(1).max(32).optional(),
  automodInviteFilter: z.boolean().optional(),
  automodCapsFilter: z.boolean().optional(),
  automodCapsThreshold: z.number().int().min(0).max(100).optional(),
  automodCapsMinLen: z.number().int().min(1).max(1000).optional(),
  automodMentionSpam: z.boolean().optional(),
  automodMentionThreshold: z.number().int().min(1).max(100).optional(),
  automodExternalLinkFilter: z.boolean().optional(),
  automodBlockedPhrases: z.string().max(2000).optional(),
  autoRoleId: z.string().regex(/^\d{17,20}$/).nullable().optional(),
  aiModerationEnabled: z.boolean().optional(),
  aiModerationThreshold: z.number().min(0).max(1).optional(),
  welcomeDmTemplate: z.string().max(2000).optional(),
});

adminRouter.get('/settings', (c) => c.json(getAllSettings()));

adminRouter.put('/settings', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: 'invalid body', issues: parsed.error.flatten() }, 400);

  const data = parsed.data;
  if (data.starboardThreshold !== undefined) setSetting('starboardThreshold', data.starboardThreshold);
  if (data.starboardEmoji !== undefined) setSetting('starboardEmoji', data.starboardEmoji);
  if (data.automodInviteFilter !== undefined) setSetting('automodInviteFilter', data.automodInviteFilter);
  if (data.automodCapsFilter !== undefined) setSetting('automodCapsFilter', data.automodCapsFilter);
  if (data.automodCapsThreshold !== undefined) setSetting('automodCapsThreshold', data.automodCapsThreshold);
  if (data.automodCapsMinLen !== undefined) setSetting('automodCapsMinLen', data.automodCapsMinLen);
  if (data.automodMentionSpam !== undefined) setSetting('automodMentionSpam', data.automodMentionSpam);
  if (data.automodMentionThreshold !== undefined) setSetting('automodMentionThreshold', data.automodMentionThreshold);
  if (data.automodExternalLinkFilter !== undefined) setSetting('automodExternalLinkFilter', data.automodExternalLinkFilter);
  if (data.automodBlockedPhrases !== undefined) setSetting('automodBlockedPhrases', data.automodBlockedPhrases);
  if (data.autoRoleId !== undefined) setSetting('autoRoleId', data.autoRoleId);
  if (data.aiModerationEnabled !== undefined) setSetting('aiModerationEnabled', data.aiModerationEnabled);
  if (data.aiModerationThreshold !== undefined) setSetting('aiModerationThreshold', data.aiModerationThreshold);
  if (data.welcomeDmTemplate !== undefined) setSetting('welcomeDmTemplate', data.welcomeDmTemplate);

  logger.info({ keys: Object.keys(data), by: getSession(c).userId }, 'settings updated via dashboard');
  recordAdminAudit(c, { action: 'settings.update', detail: Object.keys(data) });
  return c.json({ ok: true, settings: getAllSettings() });
});

adminRouter.get('/guild', async (c) => {
  const client = getClient();
  const guild = await client.guilds.fetch(config.DISCORD_GUILD_ID).catch(() => null);
  if (!guild) return c.json({ roles: [] });
  const roles = Array.from(guild.roles.cache.values())
    .filter((r) => r.name !== '@everyone' && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color }));
  return c.json({ roles });
});

// ─── Channels ────────────────────────────────────────────────────────────────

const CHANNEL_KEYS: { key: ChannelKey; label: string; description: string }[] = [
  { key: 'grabs', label: 'Grabs', description: 'Sonarr/Radarr/SAB Grabs' },
  { key: 'imports', label: 'Imports', description: 'Erfolgreiche Imports' },
  { key: 'failures', label: 'Failures', description: 'Fehlerhafte Downloads' },
  { key: 'requests', label: 'Requests', description: 'Seerr Approved/Declined' },
  { key: 'approvals', label: 'Approvals', description: 'Seerr Pending mit Approve/Decline' },
  { key: 'newOnPlex', label: 'New on Plex', description: 'Tautulli recently_added' },
  { key: 'health', label: 'Health', description: 'Sonarr/Radarr/SAB Health Warnings' },
  { key: 'welcome', label: 'Welcome', description: 'Member-Join Welcome' },
  { key: 'auditLog', label: 'Audit Log', description: 'Joins/Leaves/Role-Changes' },
  { key: 'modLog', label: 'Mod Log', description: 'Moderation Actions' },
  { key: 'github', label: 'GitHub', description: 'GitHub Webhook Feed' },
  { key: 'starboard', label: 'Starboard', description: '⭐ Highlights' },
  { key: 'plexActivity', label: 'Plex Activity', description: 'Tautulli Playback Events' },
  { key: 'maintainerr', label: 'Maintainerr', description: 'Maintainerr Cleanup Events' },
  { key: 'blueTracker', label: 'Blue Tracker', description: 'WoW Blue-Tracker RSS' },
  { key: 'addonUpdates', label: 'Addon Updates', description: 'GitHub Addon-Repo Feed' },
  { key: 'faq', label: 'FAQ', description: 'FAQ Channel' },
  { key: 'suggestions', label: 'Suggestions', description: 'Community Suggestions' },
  { key: 'ticketLogs', label: 'Ticket Logs', description: 'Ticket Close/Transcript Logs' },
  { key: 'weeklyDigest', label: 'Wochenrückblick', description: 'Automatischer Wochen-Digest' },
  { key: 'downloadLive', label: 'Live Downloads', description: 'Aktualisierte Queue-Karte' },
  { key: 'movieNight', label: 'Movie Night', description: 'Nominierungen und Abstimmungen' },
];

adminRouter.get('/channels', async (c) => {
  const client = getClient();
  const guild = await client.guilds.fetch(config.DISCORD_GUILD_ID).catch(() => null);
  const textChannels = guild
    ? Array.from(guild.channels.cache.values())
        .filter((ch) => ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)
        .map((ch) => ({ id: ch.id, name: ch.name, parentName: ch.parent?.name ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const mappings = CHANNEL_KEYS.map(({ key, label, description }) => {
    const id = getChannel(key);
    const live = id ? textChannels.find((ch) => ch.id === id) : null;
    return {
      key,
      label,
      description,
      channelId: id ?? null,
      channelName: live?.name ?? null,
    };
  });

  return c.json({ mappings, available: textChannels });
});

const channelUpdateSchema = z.object({ channelId: z.string().regex(/^\d{17,20}$/) });

adminRouter.put('/channels/:key', async (c) => {
  const key = c.req.param('key') as ChannelKey;
  if (!CHANNEL_KEYS.some((k) => k.key === key)) {
    return c.json({ ok: false, error: 'unknown channel key' }, 400);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = channelUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: 'invalid body' }, 400);

  const client = getClient();
  const guild = client.guilds.cache.get(config.DISCORD_GUILD_ID);
  const ch = guild?.channels.cache.get(parsed.data.channelId);
  if (!ch || (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement)) {
    return c.json({ ok: false, error: 'channel not found or not a text channel' }, 422);
  }

  saveChannel(key, parsed.data.channelId);
  logger.info({ key, channelId: parsed.data.channelId, by: getSession(c).userId }, 'channel remapped via dashboard');
  recordAdminAudit(c, { action: 'channel.remap', target: key, detail: { channelId: parsed.data.channelId } });
  return c.json({ ok: true });
});

// ─── Reminders ───────────────────────────────────────────────────────────────

adminRouter.get('/reminders', async (c) => {
  const rows = db
    .select()
    .from(reminders)
    .where(eq(reminders.guildId, config.DISCORD_GUILD_ID))
    .orderBy(reminders.dueAt)
    .limit(100)
    .all();
  return c.json(
    await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        userId: r.userId,
        username: await resolveUsername(r.userId),
        channelId: r.channelId,
        message: r.message,
        dueAt: r.dueAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
      })),
    ),
  );
});

adminRouter.delete('/reminders/:id', (c) => {
  const id = parsePositiveId(c.req.param('id'));
  if (id === null) return c.json({ ok: false, error: 'bad id' }, 400);
  db.delete(reminders)
    .where(and(eq(reminders.guildId, config.DISCORD_GUILD_ID), eq(reminders.id, id)))
    .run();
  return c.json({ ok: true });
});

// ─── Seerr Requests ──────────────────────────────────────────────────────────

adminRouter.get('/seerr', (c) => {
  const rows = db
    .select()
    .from(seerrRequests)
    .orderBy(desc(seerrRequests.createdAt))
    .limit(100)
    .all();
  return c.json(
    rows.map((r) => ({
      id: r.id,
      seerrRequestId: r.seerrRequestId,
      mediaType: r.mediaType,
      title: r.title,
      status: r.status,
      requestedBy: r.requestedBy,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

adminRouter.get('/seerr/weekly', (c) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const total =
    db
      .select({ count: sql<number>`count(*)` })
      .from(seerrRequests)
      .where(gt(seerrRequests.createdAt, since))
      .get()?.count ?? 0;
  const approved =
    db
      .select({ count: sql<number>`count(*)` })
      .from(seerrRequests)
      .where(
        and(
          gt(seerrRequests.createdAt, since),
          sql`${seerrRequests.status} IN ('approved', 'available')`,
        ),
      )
      .get()?.count ?? 0;
  const declined =
    db
      .select({ count: sql<number>`count(*)` })
      .from(seerrRequests)
      .where(and(gt(seerrRequests.createdAt, since), eq(seerrRequests.status, 'declined')))
      .get()?.count ?? 0;
  const failed =
    db
      .select({ count: sql<number>`count(*)` })
      .from(seerrRequests)
      .where(and(gt(seerrRequests.createdAt, since), eq(seerrRequests.status, 'failed')))
      .get()?.count ?? 0;
  const pending =
    db
      .select({ count: sql<number>`count(*)` })
      .from(seerrRequests)
      .where(and(gt(seerrRequests.createdAt, since), eq(seerrRequests.status, 'pending')))
      .get()?.count ?? 0;

  const decided = approved + declined;
  const declineRate = decided > 0 ? Math.round((declined / decided) * 100) : 0;

  return c.json({
    sinceIso: since.toISOString(),
    total,
    approved,
    declined,
    failed,
    pending,
    declineRate,
  });
});

adminRouter.post('/seerr/:id/approve', async (c) => {
  const id = parsePositiveId(c.req.param('id'));
  if (id === null) return c.json({ ok: false, error: 'bad id' }, 400);
  try {
    await approveSeerrRequest(id);
    db.update(seerrRequests).set({ status: 'approved' }).where(eq(seerrRequests.seerrRequestId, id)).run();
    recordAdminAudit(c, { action: 'seerr.approve', target: String(id) });
    return c.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, 'seerr approve via dashboard failed');
    return c.json({ ok: false, error: 'approve failed' }, 502);
  }
});

adminRouter.post('/seerr/:id/decline', async (c) => {
  const id = parsePositiveId(c.req.param('id'));
  if (id === null) return c.json({ ok: false, error: 'bad id' }, 400);
  try {
    await declineSeerrRequest(id);
    db.update(seerrRequests).set({ status: 'declined' }).where(eq(seerrRequests.seerrRequestId, id)).run();
    recordAdminAudit(c, { action: 'seerr.decline', target: String(id) });
    return c.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, 'seerr decline via dashboard failed');
    return c.json({ ok: false, error: 'decline failed' }, 502);
  }
});

// ─── Role Panels ─────────────────────────────────────────────────────────────

adminRouter.get('/role-panels', async (c) => {
  const rows = db
    .select()
    .from(rolePanels)
    .where(eq(rolePanels.guildId, config.DISCORD_GUILD_ID))
    .orderBy(desc(rolePanels.updatedAt))
    .all();

  const client = getClient();
  const guild = await client.guilds.fetch(config.DISCORD_GUILD_ID).catch(() => null);

  return c.json(
    rows.map((r) => {
      const channel = guild?.channels.cache.get(r.channelId);
      const entries = r.roles as RolePanelEntry[];
      return {
        messageId: r.messageId,
        channelId: r.channelId,
        channelName: channel?.name ?? null,
        title: r.title,
        description: r.description,
        roles: entries.map((e) => {
          const role = guild?.roles.cache.get(e.roleId);
          return { roleId: e.roleId, roleName: role?.name ?? null, label: e.label, emoji: e.emoji ?? null };
        }),
        updatedAt: r.updatedAt.toISOString(),
      };
    }),
  );
});

adminRouter.delete('/role-panels/:messageId', async (c) => {
  const messageId = c.req.param('messageId');
  const row = db
    .select()
    .from(rolePanels)
    .where(
      and(
        eq(rolePanels.guildId, config.DISCORD_GUILD_ID),
        eq(rolePanels.messageId, messageId),
      ),
    )
    .get();
  if (!row) return c.json({ ok: false, error: 'not found' }, 404);

  try {
    const client = getClient();
    const channel = (await client.channels.fetch(row.channelId).catch(() => null)) as
      | GuildTextBasedChannel
      | null;
    if (channel?.isTextBased()) {
      const msg = await channel.messages.fetch(messageId).catch(() => null);
      await msg?.delete().catch(() => {});
    }
  } catch (err) {
    logger.warn({ err, messageId }, 'role-panel: failed to delete message; DB row will still be removed');
  }

  db.delete(rolePanels)
    .where(
      and(
        eq(rolePanels.guildId, config.DISCORD_GUILD_ID),
        eq(rolePanels.messageId, messageId),
      ),
    )
    .run();
  recordAdminAudit(c, { action: 'role-panel.delete', target: messageId });
  return c.json({ ok: true });
});

// ─── Tags (Custom Commands) ─────────────────────────────────────────────────

adminRouter.get('/tags', (c) => {
  const rows = db
    .select()
    .from(customCommands)
    .where(eq(customCommands.guildId, config.DISCORD_GUILD_ID))
    .orderBy(desc(customCommands.uses))
    .all();
  return c.json(
    rows.map((t) => ({
      name: t.name,
      response: t.response,
      uses: t.uses,
      createdBy: t.createdBy,
      updatedAt: t.updatedAt.toISOString(),
    })),
  );
});

const tagSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,29}$/, 'a-z, 0-9, dash; max 30'),
  response: z.string().min(1).max(2000),
});

adminRouter.post('/tags', async (c) => {
  const parsed = tagSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'invalid body', issues: parsed.error.flatten() }, 400);

  const existing = db
    .select()
    .from(customCommands)
    .where(
      and(eq(customCommands.guildId, config.DISCORD_GUILD_ID), eq(customCommands.name, parsed.data.name)),
    )
    .get();

  if (existing) {
    db.update(customCommands)
      .set({ response: parsed.data.response, updatedAt: new Date() })
      .where(
        and(
          eq(customCommands.guildId, config.DISCORD_GUILD_ID),
          eq(customCommands.name, parsed.data.name),
        ),
      )
      .run();
  } else {
    db.insert(customCommands)
      .values({
        guildId: config.DISCORD_GUILD_ID,
        name: parsed.data.name,
        response: parsed.data.response,
        createdBy: getSession(c).userId,
      })
      .run();
  }
  return c.json({ ok: true });
});

adminRouter.delete('/tags/:name', (c) => {
  const name = c.req.param('name');
  db.delete(customCommands)
    .where(and(eq(customCommands.guildId, config.DISCORD_GUILD_ID), eq(customCommands.name, name)))
    .run();
  recordAdminAudit(c, { action: 'tag.delete', target: name });
  return c.json({ ok: true });
});

// ─── Autoresponders ─────────────────────────────────────────────────────────

adminRouter.get('/autoresponders', (c) => {
  const rows = db
    .select()
    .from(autoresponders)
    .where(eq(autoresponders.guildId, config.DISCORD_GUILD_ID))
    .orderBy(desc(autoresponders.createdAt))
    .all();
  return c.json(
    rows.map((r) => ({
      id: r.id,
      pattern: r.pattern,
      response: r.response,
      matchType: r.matchType,
      enabled: r.enabled,
      autoDeleteSeconds: r.autoDeleteSeconds,
      asEmbed: r.asEmbed,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

const AUTO_DELETE_MAX = 3600;
const REDOS_DENYLIST = /(\.\*|\.\+|\w\*|\w\+)\s*[+*]|\(\s*(\.\*|\.\+|\w\*|\w\+)\s*\)[+*]|\([^)]*[+*][^)]*\)[+*]/;

function isValidRegexPattern(pattern: string): boolean {
  if (REDOS_DENYLIST.test(pattern)) return false;
  try {
    new RegExp(pattern, 'i');
    return true;
  } catch {
    return false;
  }
}

const autoresponderSchema = z.object({
  pattern: z.string().min(1).max(200),
  response: z.string().min(1).max(1500),
  matchType: z.enum(['substring', 'word', 'regex']),
  autoDeleteSeconds: z.number().int().min(0).max(AUTO_DELETE_MAX).nullable().optional(),
  asEmbed: z.boolean().optional(),
});

adminRouter.post('/autoresponders', async (c) => {
  const parsed = autoresponderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'invalid body' }, 400);

  if (parsed.data.matchType === 'regex') {
    if (!isValidRegexPattern(parsed.data.pattern)) {
      return c.json({ ok: false, error: 'invalid or unsafe regex' }, 400);
    }
  }

  const ads = parsed.data.autoDeleteSeconds;
  const inserted = db
    .insert(autoresponders)
    .values({
      guildId: config.DISCORD_GUILD_ID,
      pattern: parsed.data.pattern,
      response: parsed.data.response,
      matchType: parsed.data.matchType,
      enabled: true,
      autoDeleteSeconds: ads && ads > 0 ? ads : null,
      asEmbed: parsed.data.asEmbed ?? false,
      createdBy: getSession(c).userId,
    })
    .returning({ id: autoresponders.id })
    .get();

  invalidateAutoresponderCache();
  return c.json({ ok: true, id: inserted?.id });
});

const autoresponderPatchSchema = z.object({
  pattern: z.string().min(1).max(200).optional(),
  response: z.string().min(1).max(1500).optional(),
  matchType: z.enum(['substring', 'word', 'regex']).optional(),
  enabled: z.boolean().optional(),
  autoDeleteSeconds: z.number().int().min(0).max(AUTO_DELETE_MAX).nullable().optional(),
  asEmbed: z.boolean().optional(),
});

adminRouter.patch('/autoresponders/:id', async (c) => {
  const id = parsePositiveId(c.req.param('id'));
  if (id === null) return c.json({ ok: false, error: 'bad id' }, 400);
  const parsed = autoresponderPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'invalid body' }, 400);

  const patch = parsed.data;
  if (Object.keys(patch).length === 0) return c.json({ ok: false, error: 'no fields' }, 400);

  const current = db
    .select({ pattern: autoresponders.pattern, matchType: autoresponders.matchType })
    .from(autoresponders)
    .where(and(eq(autoresponders.guildId, config.DISCORD_GUILD_ID), eq(autoresponders.id, id)))
    .get();
  if (!current) return c.json({ ok: false, error: 'not found' }, 404);

  const resultingMatchType = patch.matchType ?? current.matchType;
  const resultingPattern = patch.pattern ?? current.pattern;
  if (resultingMatchType === 'regex' && !isValidRegexPattern(resultingPattern)) {
    return c.json({ ok: false, error: 'invalid or unsafe regex' }, 400);
  }

  const updates = { ...patch };
  if (updates.autoDeleteSeconds === 0) updates.autoDeleteSeconds = null;

  db.update(autoresponders)
    .set(updates)
    .where(and(eq(autoresponders.guildId, config.DISCORD_GUILD_ID), eq(autoresponders.id, id)))
    .run();
  invalidateAutoresponderCache();
  return c.json({ ok: true });
});

adminRouter.delete('/autoresponders/:id', (c) => {
  const id = parsePositiveId(c.req.param('id'));
  if (id === null) return c.json({ ok: false, error: 'bad id' }, 400);
  db.delete(autoresponders)
    .where(and(eq(autoresponders.guildId, config.DISCORD_GUILD_ID), eq(autoresponders.id, id)))
    .run();
  invalidateAutoresponderCache();
  recordAdminAudit(c, { action: 'autoresponder.delete', target: String(id) });
  return c.json({ ok: true });
});

// ─── Scheduled Announcements ────────────────────────────────────────────────

adminRouter.get('/scheduled', (c) => {
  const rows = db
    .select()
    .from(scheduledAnnouncements)
    .where(eq(scheduledAnnouncements.guildId, config.DISCORD_GUILD_ID))
    .orderBy(scheduledAnnouncements.fireAt)
    .all();
  return c.json(
    rows.map((r) => ({
      id: r.id,
      channelId: r.channelId,
      title: r.title,
      message: r.message,
      color: r.color,
      fireAt: r.fireAt.toISOString(),
      fired: r.fired,
      recurrence: r.recurrence,
      lastFiredAt: r.lastFiredAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

const scheduledPatchSchema = z.object({
  recurrence: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
  fireAt: z.string().datetime().optional(),
});

adminRouter.patch('/scheduled/:id', async (c) => {
  const id = parsePositiveId(c.req.param('id'));
  if (id === null) return c.json({ ok: false, error: 'bad id' }, 400);
  const parsed = scheduledPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'invalid body' }, 400);

  const update: Partial<typeof scheduledAnnouncements.$inferInsert> = {};
  if (parsed.data.recurrence !== undefined) update.recurrence = parsed.data.recurrence;
  if (parsed.data.fireAt !== undefined) {
    update.fireAt = new Date(parsed.data.fireAt);
    update.fired = false;
  }
  if (Object.keys(update).length === 0) return c.json({ ok: true });

  db.update(scheduledAnnouncements)
    .set(update)
    .where(
      and(
        eq(scheduledAnnouncements.guildId, config.DISCORD_GUILD_ID),
        eq(scheduledAnnouncements.id, id),
      ),
    )
    .run();
  return c.json({ ok: true });
});

adminRouter.delete('/scheduled/:id', (c) => {
  const id = parsePositiveId(c.req.param('id'));
  if (id === null) return c.json({ ok: false, error: 'bad id' }, 400);
  db.delete(scheduledAnnouncements)
    .where(
      and(
        eq(scheduledAnnouncements.guildId, config.DISCORD_GUILD_ID),
        eq(scheduledAnnouncements.id, id),
      ),
    )
    .run();
  return c.json({ ok: true });
});

// ─── Tickets ────────────────────────────────────────────────────────────────

adminRouter.get('/tickets', async (c) => {
  const rows = db
    .select()
    .from(tickets)
    .where(eq(tickets.guildId, config.DISCORD_GUILD_ID))
    .orderBy(desc(tickets.createdAt))
    .limit(100)
    .all();
  return c.json(
    await Promise.all(
      rows.map(async (t) => ({
        id: t.id,
        channelId: t.channelId,
        opener: await resolveUsername(t.openerId),
        openerId: t.openerId,
        topic: t.topic,
        open: t.closedAt === null,
        createdAt: t.createdAt.toISOString(),
        closedAt: t.closedAt?.toISOString() ?? null,
      })),
    ),
  );
});

adminRouter.post('/tickets/:id/close', async (c) => {
  const id = parsePositiveId(c.req.param('id'));
  if (id === null) return c.json({ ok: false, error: 'bad id' }, 400);
  const ticket = db
    .select()
    .from(tickets)
    .where(and(eq(tickets.guildId, config.DISCORD_GUILD_ID), eq(tickets.id, id), isNull(tickets.closedAt)))
    .get();
  if (!ticket) return c.json({ ok: false, error: 'ticket not found or already closed' }, 404);

  db.update(tickets).set({ closedAt: new Date() }).where(eq(tickets.id, id)).run();

  try {
    const client = getClient();
    const ch = await client.channels.fetch(ticket.channelId).catch(() => null);
    if (ch && 'delete' in ch) await ch.delete('ticket closed via dashboard').catch(() => {});
  } catch {
    /* ignore */
  }

  recordAdminAudit(c, { action: 'ticket.close', target: String(id) });
  return c.json({ ok: true });
});

// ─── Reputation ─────────────────────────────────────────────────────────────

adminRouter.get('/reputation', async (c) => {
  const rows = db
    .select()
    .from(reputation)
    .where(eq(reputation.guildId, config.DISCORD_GUILD_ID))
    .orderBy(desc(reputation.rep))
    .limit(50)
    .all();
  return c.json(
    await Promise.all(
      rows.map(async (r) => ({
        userId: r.userId,
        username: await resolveUsername(r.userId),
        rep: r.rep,
      })),
    ),
  );
});

// ─── Audit log + session revocation ─────────────────────────────────────────

adminRouter.get('/audit-log', (c) => {
  const parsedLimit = z.coerce.number().int().min(1).max(1000).safeParse(c.req.query('limit') ?? 200);
  if (!parsedLimit.success) return c.json({ ok: false, error: 'invalid limit' }, 400);
  const rows = db
    .select()
    .from(adminAuditLog)
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(parsedLimit.data)
    .all();
  return c.json(
    rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      action: r.action,
      target: r.target,
      detail: r.detail,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

const revokeSchema = z.object({ userId: z.string().regex(/^\d{17,20}$/) });

adminRouter.post('/sessions/revoke', async (c) => {
  const parsed = revokeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'invalid body' }, 400);
  revokeUserSessions(parsed.data.userId);
  recordAdminAudit(c, { action: 'session.revoke', target: parsed.data.userId });
  return c.json({ ok: true });
});

// ─── helpers ────────────────────────────────────────────────────────────────

async function resolveUsername(userId: string): Promise<string> {
  try {
    const client = getClient();
    const user = await client.users.fetch(userId).catch(() => null);
    return user?.username ?? userId;
  } catch {
    return userId;
  }
}
