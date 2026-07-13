import type { Guild, GuildMember, Role } from 'discord.js';
import { getSetting } from '../settings.js';
import { logger } from '../utils/logger.js';
import { checkRoleAssignment, type RoleAssignmentCheck } from './role-assignment.js';

const FALLBACK_ROLE_NAME = 'Newcomer';

export type AutoRoleSource = 'configured' | 'newcomer-fallback' | 'none';

export interface AutoRoleResolution {
  configuredRoleId: string | null;
  role: Role | null;
  source: AutoRoleSource;
  assignment: RoleAssignmentCheck | null;
  issue: string | null;
  warning: string | null;
}

export interface AutoRoleApplyResult {
  status: 'assigned' | 'already-assigned' | 'unavailable' | 'blocked' | 'skipped-bot';
  roleId: string | null;
  roleName: string | null;
  source: AutoRoleSource;
  issue: string | null;
}

async function ensureBotMember(guild: Guild): Promise<void> {
  if (guild.members.me) return;
  await guild.members.fetchMe().catch((err) => {
    logger.warn({ err, guildId: guild.id }, 'failed to fetch bot member for auto-role');
    return null;
  });
}

export async function resolveAutoRoleTarget(
  guild: Guild,
  configuredRoleId: string | null = getSetting('autoRoleId'),
): Promise<AutoRoleResolution> {
  await ensureBotMember(guild);

  let warning: string | null = null;
  if (configuredRoleId) {
    const configuredRole = guild.roles.cache.get(configuredRoleId)
      ?? await guild.roles.fetch(configuredRoleId).catch(() => null);
    if (configuredRole) {
      const assignment = checkRoleAssignment(guild, configuredRole);
      return {
        configuredRoleId,
        role: configuredRole,
        source: 'configured',
        assignment,
        issue: assignment.issue,
        warning: null,
      };
    }
    warning = `Die konfigurierte Startrolle (${configuredRoleId}) wurde nicht gefunden; „${FALLBACK_ROLE_NAME}“ wird versucht.`;
  }

  let fallbackRole = guild.roles.cache.find(
    (role) => role.name.localeCompare(FALLBACK_ROLE_NAME, undefined, { sensitivity: 'accent' }) === 0,
  ) ?? null;
  if (!fallbackRole) {
    await guild.roles.fetch().catch((err) => {
      logger.warn({ err, guildId: guild.id }, 'failed to refresh guild roles for auto-role fallback');
      return null;
    });
    fallbackRole = guild.roles.cache.find(
      (role) => role.name.localeCompare(FALLBACK_ROLE_NAME, undefined, { sensitivity: 'accent' }) === 0,
    ) ?? null;
  }
  if (!fallbackRole) {
    return {
      configuredRoleId,
      role: null,
      source: 'none',
      assignment: null,
      issue: configuredRoleId
        ? `Die konfigurierte Rolle und die Ersatzrolle „${FALLBACK_ROLE_NAME}“ wurden nicht gefunden.`
        : `Es ist keine Startrolle konfiguriert und „${FALLBACK_ROLE_NAME}“ wurde nicht gefunden.`,
      warning,
    };
  }

  const assignment = checkRoleAssignment(guild, fallbackRole);
  return {
    configuredRoleId,
    role: fallbackRole,
    source: 'newcomer-fallback',
    assignment,
    issue: assignment.issue,
    warning,
  };
}

export async function applyAutoRole(member: GuildMember): Promise<AutoRoleApplyResult> {
  if (member.user.bot) {
    return { status: 'skipped-bot', roleId: null, roleName: null, source: 'none', issue: null };
  }

  const target = await resolveAutoRoleTarget(member.guild);
  if (!target.role) {
    logger.warn(
      { userId: member.id, guildId: member.guild.id, issue: target.issue },
      'auto-role target unavailable',
    );
    return {
      status: 'unavailable',
      roleId: null,
      roleName: null,
      source: target.source,
      issue: target.issue,
    };
  }
  if (!target.assignment?.assignable) {
    logger.warn(
      {
        userId: member.id,
        guildId: member.guild.id,
        roleId: target.role.id,
        issueCode: target.assignment?.issueCode,
        issue: target.issue,
      },
      'auto-role assignment blocked',
    );
    return {
      status: 'blocked',
      roleId: target.role.id,
      roleName: target.role.name,
      source: target.source,
      issue: target.issue,
    };
  }
  if (member.roles.cache.has(target.role.id)) {
    return {
      status: 'already-assigned',
      roleId: target.role.id,
      roleName: target.role.name,
      source: target.source,
      issue: null,
    };
  }

  await member.roles.add(
    target.role,
    target.source === 'configured' ? 'auto-role on join' : 'auto-role (Newcomer fallback)',
  );
  logger.info(
    {
      userId: member.id,
      guildId: member.guild.id,
      roleId: target.role.id,
      mode: target.source,
      warning: target.warning,
    },
    'auto-role applied',
  );
  return {
    status: 'assigned',
    roleId: target.role.id,
    roleName: target.role.name,
    source: target.source,
    issue: null,
  };
}
