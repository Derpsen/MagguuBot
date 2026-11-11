import type { Context } from 'hono';
import {
  and,
  desc,
  eq,
  gt,
  isNull,
  like,
  or,
  sql
} from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import {
  customCommands,
  livePanels,
  reminders,
  scheduledAnnouncements,
  seerrRequests,
  starboardPosts,
  tickets,
  userXp,
  warnings,
  webhookEvents
} from '../../db/schema.js';
import { getChannel } from '../../discord/channel-store.js';
import { getClient } from '../../discord/client-ref.js';
import { getServiceHealth } from '../service-health.js';
import { readBuildInfo } from '../../embeds/status.js';
import { resolveUsername } from './helpers.js';

const globalSearchSchema = z.string().trim().min(2).max(100);

export const getSearch = async (c: Context<any, '/search'>) => {
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
        to: '/members?tab=xp',
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
    .map((row) => ({ kind: 'ticket', label: `Ticket #${row.id}`, description: `${row.closedAt ? 'geschlossen' : 'offen'} · ${row.topic ?? 'ohne Thema'}`, to: '/moderation?tab=tickets' }));
  const warningResults = db
    .select({ id: warnings.id, userId: warnings.userId, reason: warnings.reason })
    .from(warnings)
    .where(or(like(warnings.reason, pattern), like(warnings.userId, pattern), like(warnings.moderatorId, pattern)))
    .orderBy(desc(warnings.createdAt))
    .limit(6)
    .all()
    .map((row) => ({ kind: 'warning', label: `Verwarnung #${row.id}`, description: `${row.reason ?? 'ohne Grund'} · ${row.userId}`, to: '/moderation?tab=warnings' }));
  const webhookResults = db
    .select({ id: webhookEvents.id, source: webhookEvents.source, eventType: webhookEvents.eventType, status: webhookEvents.status })
    .from(webhookEvents)
    .where(or(like(webhookEvents.source, pattern), like(webhookEvents.eventType, pattern), like(webhookEvents.error, pattern)))
    .orderBy(desc(webhookEvents.createdAt))
    .limit(6)
    .all()
    .map((row) => ({ kind: 'webhook', label: `${row.source} · ${row.eventType}`, description: `Webhook · ${row.status} · #${row.id}`, to: '/webhooks' }));
  return c.json({ results: [...memberResults, ...requestResults, ...ticketResults, ...warningResults, ...webhookResults].slice(0, 20) });
};

export const getStats = async (c: Context<any, '/stats'>) => {
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
    build: readBuildInfo(),
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
      plexStaleSessionMinutes: config.PLEX_STALE_SESSION_MINUTES,
    },
  });
};

export const getServicesHealth = async (c: Context<any, '/services/health'>) => {
  return c.json({ services: await getServiceHealth(c.req.query('force') === 'true') });
};
