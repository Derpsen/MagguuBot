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
  if (!requiredPermissions) return false;
  let required: bigint;
  try {
    required = BigInt(requiredPermissions);
  } catch {
    return true;
  }
  return !memberPermissions?.has(required);
}
