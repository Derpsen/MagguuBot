import { Hono } from 'hono';
import { desc, eq, gt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { userXp, warnings, webhookEvents } from '../../db/schema.js';
import { getClient } from '../../discord/client.js';
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
  const warningsCount = db
    .select({ count: sql<number>`count(*)` })
    .from(warnings)
    .get()?.count ?? 0;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const webhooksLast24h = db
    .select({ count: sql<number>`count(*)` })
    .from(webhookEvents)
    .where(gt(webhookEvents.createdAt, since))
    .get()?.count ?? 0;

  const topXp = db
    .select()
    .from(userXp)
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

  return c.json({
    uptimeSeconds: Math.floor(process.uptime()),
    warningsCount,
    webhooksLast24h,
    topUser,
    recentActions,
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
    rows.map((w) => ({
      id: w.id,
      userId: w.userId,
      moderatorId: w.moderatorId,
      reason: w.reason,
      createdAt: w.createdAt.toISOString(),
    })),
  );
});

adminRouter.delete('/warnings/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ ok: false, error: 'bad id' }, 400);
  db.delete(warnings).where(eq(warnings.id, id)).run();
  return c.json({ ok: true });
});

adminRouter.get('/xp', async (c) => {
  const rows = db
    .select()
    .from(userXp)
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
      eventType: r.eventType,
      status: r.status,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

async function resolveUsername(userId: string): Promise<string> {
  try {
    const client = getClient();
    const user = await client.users.fetch(userId).catch(() => null);
    return user?.username ?? userId;
  } catch {
    return userId;
  }
}
