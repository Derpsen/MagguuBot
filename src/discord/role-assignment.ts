import { PermissionFlagsBits, type Guild, type Role } from 'discord.js';

export type RoleAssignmentIssueCode =
  | 'bot-member-unavailable'
  | 'manage-roles-missing'
  | 'everyone-role'
  | 'managed-role'
  | 'role-hierarchy';

export interface RoleAssignmentCheck {
  assignable: boolean;
  issueCode: RoleAssignmentIssueCode | null;
  issue: string | null;
}

export interface RoleAssignmentFacts {
  botMemberAvailable: boolean;
  canManageRoles: boolean;
  targetIsEveryone: boolean;
  targetIsManaged: boolean;
  botRoleAboveTarget: boolean;
  botHighestRoleName: string | null;
  targetRoleName: string;
}

function blocked(issueCode: RoleAssignmentIssueCode, issue: string): RoleAssignmentCheck {
  return { assignable: false, issueCode, issue };
}

export function checkRoleAssignmentFacts(facts: RoleAssignmentFacts): RoleAssignmentCheck {
  if (!facts.botMemberAvailable) {
    return blocked(
      'bot-member-unavailable',
      'Das Bot-Mitglied konnte im Server nicht geladen werden.',
    );
  }
  if (!facts.canManageRoles) {
    return blocked(
      'manage-roles-missing',
      'Dem Bot fehlt die Discord-Berechtigung „Rollen verwalten“.',
    );
  }
  if (facts.targetIsEveryone) {
    return blocked('everyone-role', 'Die @everyone-Rolle kann nicht automatisch vergeben werden.');
  }
  if (facts.targetIsManaged) {
    return blocked(
      'managed-role',
      'Diese Rolle wird von Discord oder einer Integration verwaltet und kann nicht vergeben werden.',
    );
  }
  if (!facts.botRoleAboveTarget) {
    return blocked(
      'role-hierarchy',
      `Die höchste Bot-Rolle „${facts.botHighestRoleName ?? 'unbekannt'}“ muss über „${facts.targetRoleName}“ stehen.`,
    );
  }
  return { assignable: true, issueCode: null, issue: null };
}

/**
 * Mirrors Discord's role-assignment rules so the dashboard, /doctor and join
 * handler all report the same actionable reason before an API request fails.
 */
export function checkRoleAssignment(guild: Guild, role: Role): RoleAssignmentCheck {
  const me = guild.members.me;
  return checkRoleAssignmentFacts({
    botMemberAvailable: Boolean(me),
    canManageRoles: me?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false,
    targetIsEveryone: role.id === guild.id,
    targetIsManaged: role.managed,
    botRoleAboveTarget: me ? me.roles.highest.comparePositionTo(role) > 0 : false,
    botHighestRoleName: me?.roles.highest.name ?? null,
    targetRoleName: role.name,
  });
}
