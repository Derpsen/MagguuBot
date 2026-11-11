import type { Context } from 'hono';
import { PermissionFlagsBits } from 'discord.js';
import { z } from 'zod';
import { config } from '../../config.js';
import { resolveAutoRoleTarget } from '../../discord/auto-role.js';
import { AUTO_ROLE_RECONCILE_LIMIT, AUTO_ROLE_RECONCILE_WINDOW_DAYS, isAutoRoleReconcileCandidate } from '../../discord/auto-role-reconcile.js';
import { getClient } from '../../discord/client-ref.js';
import { checkRoleAssignment } from '../../discord/role-assignment.js';
import { getAllSettings, getSetting, setSetting } from '../../settings.js';
import { logger } from '../../utils/logger.js';
import { recordAdminAudit } from '../auth/audit.js';
import { getSession } from '../auth/middleware.js';

const autoRoleReconcileInFlight = new Set<string>();

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

export const getSettings = (c: Context<any, '/settings'>) => c.json(getAllSettings());

export const putSettings = async (c: Context<any, '/settings'>) => {
  const body = await c.req.json().catch(() => null);
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: 'invalid body', issues: parsed.error.flatten() }, 400);

  const data = parsed.data;
  if (data.autoRoleId !== undefined && data.autoRoleId !== getSetting('autoRoleId')) {
    const guild = await getClient().guilds.fetch(config.DISCORD_GUILD_ID).catch(() => null);
    if (!guild) {
      return c.json({ ok: false, error: 'Der konfigurierte Discord-Server ist nicht erreichbar.' }, 503);
    }
    const target = await resolveAutoRoleTarget(guild, data.autoRoleId);
    if (data.autoRoleId && target.role?.id !== data.autoRoleId) {
      return c.json({ ok: false, error: 'Die ausgewählte Startrolle wurde im Server nicht gefunden.' }, 422);
    }
    if (!target.role) {
      return c.json({ ok: false, error: target.issue ?? 'Keine Startrolle gefunden.' }, 422);
    }
    if (!target.assignment?.assignable) {
      return c.json({
        ok: false,
        error: target.assignment?.issue ?? 'Die Startrolle kann vom Bot nicht vergeben werden.',
        issueCode: target.assignment?.issueCode ?? null,
      }, 422);
    }
  }
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
};

export const getGuild = async (c: Context<any, '/guild'>) => {
  const client = getClient();
  const guild = await client.guilds.fetch(config.DISCORD_GUILD_ID).catch(() => null);
  if (!guild) {
    return c.json({
      roles: [],
      autoRole: {
        roleId: null,
        roleName: null,
        source: 'none',
        assignable: false,
        issue: 'Der konfigurierte Discord-Server ist nicht erreichbar.',
        warning: null,
        botHighestRoleName: null,
        canManageRoles: false,
      },
    });
  }
  await Promise.all([
    guild.roles.fetch().catch(() => null),
    guild.members.me ? Promise.resolve(guild.members.me) : guild.members.fetchMe().catch(() => null),
  ]);
  const autoRole = await resolveAutoRoleTarget(guild);
  const roles = Array.from(guild.roles.cache.values())
    .filter((r) => r.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map((r) => {
      const assignment = checkRoleAssignment(guild, r);
      return {
        id: r.id,
        name: r.name,
        color: r.color,
        managed: r.managed,
        position: r.position,
        assignable: assignment.assignable,
        assignmentIssue: assignment.issue,
        assignmentIssueCode: assignment.issueCode,
      };
    });
  const me = guild.members.me;
  return c.json({
    roles,
    autoRole: {
      roleId: autoRole.role?.id ?? null,
      roleName: autoRole.role?.name ?? null,
      configuredRoleId: autoRole.configuredRoleId,
      source: autoRole.source,
      assignable: autoRole.assignment?.assignable ?? false,
      issue: autoRole.issue,
      issueCode: autoRole.assignment?.issueCode ?? null,
      warning: autoRole.warning,
      botHighestRoleName: me?.roles.highest.name ?? null,
      canManageRoles: me?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false,
    },
  });
};

export const postAutoRoleReconcile = async (c: Context<any, '/auto-role/reconcile'>) => {
  const guild = await getClient().guilds.fetch(config.DISCORD_GUILD_ID).catch(() => null);
  if (!guild) {
    return c.json({ ok: false, error: 'Der konfigurierte Discord-Server ist nicht erreichbar.' }, 503);
  }
  if (autoRoleReconcileInFlight.has(guild.id)) {
    return c.json({
      ok: false,
      error: 'Für diesen Server läuft bereits eine Startrollen-Nachpflege.',
    }, 409);
  }

  autoRoleReconcileInFlight.add(guild.id);
  try {
    const target = await resolveAutoRoleTarget(guild);
    if (!target.role || !target.assignment?.assignable) {
      return c.json({
        ok: false,
        error: target.issue ?? 'Die Startrolle kann nicht vergeben werden.',
        issueCode: target.assignment?.issueCode ?? null,
      }, 422);
    }
    const role = target.role;

    const members = await guild.members.fetch().catch((err) => {
      logger.warn({ err, guildId: guild.id }, 'auto-role reconciliation could not fetch members');
      return null;
    });
    if (!members) {
      return c.json({
        ok: false,
        error: 'Mitglieder konnten nicht geladen werden. Prüfe den „Server Members Intent“ im Discord Developer Portal.',
      }, 502);
    }

    const now = Date.now();
    const candidates = Array.from(members.values())
      .filter((member) => isAutoRoleReconcileCandidate({
        isBot: member.user.bot,
        hasTargetRole: member.roles.cache.has(role.id),
        hasOnlyEveryoneRole: member.roles.cache.every((memberRole) => memberRole.id === guild.id),
        joinedTimestamp: member.joinedTimestamp,
      }, now))
      .sort((a, b) => (b.joinedTimestamp ?? 0) - (a.joinedTimestamp ?? 0));
    const selected = candidates.slice(0, AUTO_ROLE_RECONCILE_LIMIT);
    const failures: Array<{ userId: string; error: string }> = [];
    let assigned = 0;
    for (const member of selected) {
      try {
        await member.roles.add(role, 'missing auto-role reconciled via dashboard');
        assigned += 1;
      } catch (err) {
        failures.push({
          userId: member.id,
          error: err instanceof Error ? err.message.slice(0, 300) : 'Unbekannter Discord-Fehler',
        });
      }
    }

    const result = {
      ok: true as const,
      role: { id: role.id, name: role.name },
      examined: members.size,
      candidates: candidates.length,
      attempted: selected.length,
      assigned,
      failed: failures.length,
      skipped: candidates.length - selected.length,
      truncated: candidates.length > selected.length,
      windowDays: AUTO_ROLE_RECONCILE_WINDOW_DAYS,
      failures: failures.slice(0, 10),
    };
    logger.info(
      {
        guildId: guild.id,
        roleId: role.id,
        by: getSession(c).userId,
        examined: result.examined,
        candidates: result.candidates,
        assigned: result.assigned,
        failed: result.failed,
        truncated: result.truncated,
        windowDays: result.windowDays,
      },
      'auto-role reconciliation completed',
    );
    recordAdminAudit(c, {
      action: 'auto_role.reconcile',
      target: role.id,
      detail: {
        examined: result.examined,
        candidates: result.candidates,
        attempted: result.attempted,
        assigned: result.assigned,
        failed: result.failed,
        truncated: result.truncated,
        windowDays: result.windowDays,
      },
    });
    return c.json(result);
  } finally {
    autoRoleReconcileInFlight.delete(guild.id);
  }
};
