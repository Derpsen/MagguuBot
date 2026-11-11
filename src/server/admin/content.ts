import type { Context } from 'hono';
import { type GuildTextBasedChannel } from 'discord.js';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import {
  autoresponders,
  customCommands,
  rolePanels,
  scheduledAnnouncements,
  type RolePanelEntry
} from '../../db/schema.js';
import { invalidateAutoresponderCache } from '../../discord/autoresponder.js';
import { getClient } from '../../discord/client-ref.js';
import { logger } from '../../utils/logger.js';
import { recordAdminAudit } from '../auth/audit.js';
import { getSession } from '../auth/middleware.js';
import { isSafeRegexPattern, parsePositiveId } from './validation.js';

export const getRolePanels = async (c: Context<any, '/role-panels'>) => {
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
};

export const deleteRolePanelsMessageId = async (c: Context<any, '/role-panels/:messageId'>) => {
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
};

// ─── Tags (Custom Commands) ─────────────────────────────────────────────────

export const getTags = (c: Context<any, '/tags'>) => {
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
};

const tagSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,29}$/, 'a-z, 0-9, dash; max 30'),
  response: z.string().min(1).max(2000),
});

export const postTags = async (c: Context<any, '/tags'>) => {
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
};

export const deleteTagsName = (c: Context<any, '/tags/:name'>) => {
  const name = c.req.param('name');
  db.delete(customCommands)
    .where(and(eq(customCommands.guildId, config.DISCORD_GUILD_ID), eq(customCommands.name, name)))
    .run();
  recordAdminAudit(c, { action: 'tag.delete', target: name });
  return c.json({ ok: true });
};

// ─── Autoresponders ─────────────────────────────────────────────────────────

export const getAutoresponders = (c: Context<any, '/autoresponders'>) => {
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
};

const AUTO_DELETE_MAX = 3600;

const autoresponderSchema = z.object({
  pattern: z.string().min(1).max(200),
  response: z.string().min(1).max(1500),
  matchType: z.enum(['substring', 'word', 'regex']),
  autoDeleteSeconds: z.number().int().min(0).max(AUTO_DELETE_MAX).nullable().optional(),
  asEmbed: z.boolean().optional(),
});

export const postAutoresponders = async (c: Context<any, '/autoresponders'>) => {
  const parsed = autoresponderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'invalid body' }, 400);

  if (parsed.data.matchType === 'regex') {
    if (!isSafeRegexPattern(parsed.data.pattern)) {
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
};

const autoresponderPatchSchema = z.object({
  pattern: z.string().min(1).max(200).optional(),
  response: z.string().min(1).max(1500).optional(),
  matchType: z.enum(['substring', 'word', 'regex']).optional(),
  enabled: z.boolean().optional(),
  autoDeleteSeconds: z.number().int().min(0).max(AUTO_DELETE_MAX).nullable().optional(),
  asEmbed: z.boolean().optional(),
});

export const patchAutorespondersId = async (c: Context<any, '/autoresponders/:id'>) => {
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
  if (resultingMatchType === 'regex' && !isSafeRegexPattern(resultingPattern)) {
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
};

export const deleteAutorespondersId = (c: Context<any, '/autoresponders/:id'>) => {
  const id = parsePositiveId(c.req.param('id'));
  if (id === null) return c.json({ ok: false, error: 'bad id' }, 400);
  db.delete(autoresponders)
    .where(and(eq(autoresponders.guildId, config.DISCORD_GUILD_ID), eq(autoresponders.id, id)))
    .run();
  invalidateAutoresponderCache();
  recordAdminAudit(c, { action: 'autoresponder.delete', target: String(id) });
  return c.json({ ok: true });
};

// ─── Scheduled Announcements ────────────────────────────────────────────────

export const getScheduled = (c: Context<any, '/scheduled'>) => {
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
};

const scheduledPatchSchema = z.object({
  recurrence: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
  fireAt: z.string().datetime().optional(),
});

export const patchScheduledId = async (c: Context<any, '/scheduled/:id'>) => {
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
};

export const deleteScheduledId = (c: Context<any, '/scheduled/:id'>) => {
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
};
