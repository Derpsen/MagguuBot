import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { rssFeeds } from '../../db/schema.js';
import { getSession } from '../auth/middleware.js';
import { parsePositiveId } from './validation.js';
import { isConfiguredGuildTextChannel } from './helpers.js';

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

export const getRss = (c: Context<any, '/rss'>) => {
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
};

export const postRss = async (c: Context<any, '/rss'>) => {
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
};

export const patchRssId = async (c: Context<any, '/rss/:id'>) => {
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
};

export const deleteRssId = (c: Context<any, '/rss/:id'>) => {
  const id = parsePositiveId(c.req.param('id'));
  if (id === null) return c.json({ ok: false, error: 'bad id' }, 400);
  db.delete(rssFeeds)
    .where(and(eq(rssFeeds.guildId, config.DISCORD_GUILD_ID), eq(rssFeeds.id, id)))
    .run();
  return c.json({ ok: true });
};
