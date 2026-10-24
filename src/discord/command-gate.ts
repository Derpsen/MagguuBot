import type { PermissionsBitField } from 'discord.js';

/**
 * Central slash-command gate: the command's `default_member_permissions` (a decimal string in the command JSON)
 * must all be held by the invoker. Fails closed: missing/unknown member permissions (DM context, partial
 * interaction) count as denied, and an unparsable value denies instead of throwing.
 */
export function lacksCommandPermission(
  requiredPermissions: string | null | undefined,
  memberPermissions: Readonly<Pick<PermissionsBitField, 'has'>> | null | undefined,
): boolean {
  return commandDenyReason(requiredPermissions, memberPermissions) !== null;
}

/** Why the gate denies (category only, for the audit log); `null` = allowed. */
export type CommandDenyReason = 'invalid-permission-spec' | 'no-member-context' | 'missing-permission';

export function commandDenyReason(
  requiredPermissions: string | null | undefined,
  memberPermissions: Readonly<Pick<PermissionsBitField, 'has'>> | null | undefined,
): CommandDenyReason | null {
  if (!requiredPermissions) return null;
  let required: bigint;
  try {
    required = BigInt(requiredPermissions);
  } catch {
    return 'invalid-permission-spec';
  }
  if (!memberPermissions) return 'no-member-context';
  return memberPermissions.has(required) ? null : 'missing-permission';
}
