import { Hono } from 'hono';
import { ChannelType, type GuildTextBasedChannel } from 'discord.js';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import {
  channelConfig,
  reminders,
  rolePanels,
  seerrRequests,
  starboardPosts,
  userXp,
  warnings,
  webhookEvents,
  type RolePanelEntry,
} from '../../db/schema.js';
import { getChannel, saveChannel, type ChannelKey } from '../../discord/channel-store.js';
import { getClient } from '../../discord/client.js';
import { approveSeerrRequest, declineSeerrRequest } from '../../services/seerr.js';
import { getAllSettings, setSetting } from '../../settings.js';
import { logger } from '../../utils/logger.js';
import { getSession, requireAdmin } from '../auth/middleware.js';

export const adminRouter = new Hono();

adminRouter.use('*', requireAdmin);

adminRouter.get('/me', (c) => {
  const session = getSession(c);
  return c.json({
    id: session.userId,
    username: session.username,
    globalName: session.globalName,
    avatarUrl: session.avatarUrl,
  });
});

adminRouter.get('/stats', async (c) => {
  const warningsCount =
    db.select({ count: sql<number>`count(*)` }).from(warnings).get()?.count ?? 0;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const webhooksLast24h =
    db
      .select({ count: sql<number>`count(*)` })
      .from(webhookEvents)
      .where(gt(webhookEvents.createdAt, since))
      .get()?.count ?? 0;

  const topXp = db.select().from(userXp).orderBy(desc(userXp.xp)).limit(1).get();

  let topUser: { username: string; xp: number; level: number } | null = null;
  if (topXp) {
    const resolved = await resolveUsername(topXp.userId);
    topUser = { username: resolved, xp: topXp.xp, level: topXp.level };
  }

  const recentWarnings = db
    .select()
    .from(warnings)
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
    db.select({ count: sql<number>`count(*)` }).from(reminders).get()?.count ?? 0;
  const pendingSeerrCount =
    db
      .select({ count: sql<number>`count(*)` })
      .from(seerrRequests)
      .where(eq(seerrRequests.status, 'pending'))
      .get()?.count ?? 0;
  const starboardCount =
    db.select({ count: sql<number>`count(*)` }).from(starboardPosts).get()?.count ?? 0;

  return c.json({
    uptimeSeconds: Math.floor(process.uptime()),
    warningsCount,
    webhooksLast24h,
    topUser,
    recentActions,
    remindersCount,
    pendingSeerrCount,
    starboardCount,
  });
});

adminRouter.get('/warnings', async (c) => {
  const rows = db
    .select()
    .from(warnings)
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
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ ok: false, error: 'bad id' }, 400);
  db.delete(warnings).where(eq(warnings.id, id)).run();
  return c.json({ ok: true });
});

adminRouter.get('/xp', async (c) => {
  const rows = db.select().from(userXp).orderBy(desc(userXp.xp)).limit(50).all();
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
      eventType: r.eventType,
      status: r.status,
      error: r.error,
      channelId: r.channelId,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// ─── Settings ────────────────────────────────────────────────────────────────

const settingsSchema = z.object({
  starboardThreshold: z.number().int().min(1).max(1000).optional(),
  starboardEmoji: z.string().min(1).max(32).optional(),
  automodInviteFilter: z.boolean().optional(),
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

  logger.info({ keys: Object.keys(data), by: getSession(c).userId }, 'settings updated via dashboard');
  return c.json({ ok: true, settings: getAllSettings() });
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

  saveChannel(key, parsed.data.channelId);
  logger.info({ key, channelId: parsed.data.channelId, by: getSession(c).userId }, 'channel remapped via dashboard');
  return c.json({ ok: true });
});

// ─── Reminders ───────────────────────────────────────────────────────────────

adminRouter.get('/reminders', async (c) => {
  const rows = db.select().from(reminders).orderBy(reminders.dueAt).limit(100).all();
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
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ ok: false, error: 'bad id' }, 400);
  db.delete(reminders).where(eq(reminders.id, id)).run();
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

adminRouter.post('/seerr/:id/approve', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ ok: false, error: 'bad id' }, 400);
  try {
    await approveSeerrRequest(id);
    db.update(seerrRequests).set({ status: 'approved' }).where(eq(seerrRequests.seerrRequestId, id)).run();
    return c.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, 'seerr approve via dashboard failed');
    return c.json({ ok: false, error: 'approve failed' }, 502);
  }
});

adminRouter.post('/seerr/:id/decline', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ ok: false, error: 'bad id' }, 400);
  try {
    await declineSeerrRequest(id);
    db.update(seerrRequests).set({ status: 'declined' }).where(eq(seerrRequests.seerrRequestId, id)).run();
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
