import type { Context } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { reminders, reputation, userXp } from '../../db/schema.js';
import { parsePositiveId } from './validation.js';
import { resolveUsername } from './helpers.js';

export const getXp = async (c: Context<any, '/xp'>) => {
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
};

export const getReminders = async (c: Context<any, '/reminders'>) => {
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
};

export const deleteRemindersId = (c: Context<any, '/reminders/:id'>) => {
  const id = parsePositiveId(c.req.param('id'));
  if (id === null) return c.json({ ok: false, error: 'bad id' }, 400);
  db.delete(reminders)
    .where(and(eq(reminders.guildId, config.DISCORD_GUILD_ID), eq(reminders.id, id)))
    .run();
  return c.json({ ok: true });
};

export const getReputation = async (c: Context<any, '/reputation'>) => {
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
};
