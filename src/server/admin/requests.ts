import type { Context } from 'hono';
import {
  and,
  desc,
  eq,
  gt,
  sql
} from 'drizzle-orm';
import { db } from '../../db/client.js';
import { seerrRequests } from '../../db/schema.js';
import { approveSeerrRequest, declineSeerrRequest } from '../../services/seerr.js';
import { logger } from '../../utils/logger.js';
import { recordAdminAudit } from '../auth/audit.js';
import { parsePositiveId } from './validation.js';

export const getSeerr = (c: Context<any, '/seerr'>) => {
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
};

export const getSeerrWeekly = (c: Context<any, '/seerr/weekly'>) => {
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
};

export const postSeerrIdApprove = async (c: Context<any, '/seerr/:id/approve'>) => {
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
};

export const postSeerrIdDecline = async (c: Context<any, '/seerr/:id/decline'>) => {
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
};
