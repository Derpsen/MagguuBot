import type { Context } from 'hono';
import {
  and,
  desc,
  eq,
  isNull
} from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { adminAuditLog, tickets, warnings } from '../../db/schema.js';
import { getClient } from '../../discord/client-ref.js';
import { recordAdminAudit } from '../auth/audit.js';
import { parsePositiveId } from './validation.js';
import { resolveUsername } from './helpers.js';

export const getWarnings = async (c: Context<any, '/warnings'>) => {
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
};

export const deleteWarningsId = async (c: Context<any, '/warnings/:id'>) => {
  const id = parsePositiveId(c.req.param('id'));
  if (id === null) return c.json({ ok: false, error: 'bad id' }, 400);
  db.delete(warnings)
    .where(and(eq(warnings.guildId, config.DISCORD_GUILD_ID), eq(warnings.id, id)))
    .run();
  recordAdminAudit(c, { action: 'warning.delete', target: String(id) });
  return c.json({ ok: true });
};

export const getTickets = async (c: Context<any, '/tickets'>) => {
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
};

export const postTicketsIdClose = async (c: Context<any, '/tickets/:id/close'>) => {
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
};

export const getAuditLog = (c: Context<any, '/audit-log'>) => {
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
};
