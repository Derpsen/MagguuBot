import { PermissionFlagsBits, type PermissionsBitField } from 'discord.js';

const LABELS = new Map<bigint, string>([
  [PermissionFlagsBits.ViewChannel, 'Kanal ansehen'],
  [PermissionFlagsBits.SendMessages, 'Nachrichten senden'],
  [PermissionFlagsBits.ManageMessages, 'Nachrichten verwalten'],
  [PermissionFlagsBits.ReadMessageHistory, 'Nachrichtenverlauf lesen'],
  [PermissionFlagsBits.MentionEveryone, 'Erwähne @everyone, @here und alle Rollen'],
]);

export const ANNOUNCE_CHANNEL_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
] as const;

export const PURGE_CHANNEL_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ReadMessageHistory,
] as const;

/** Permissions from `required` the member lacks in the channel (null perms = all missing). */
export function missingChannelPermissions(
  perms: Readonly<PermissionsBitField> | null | undefined,
  required: readonly bigint[],
): bigint[] {
  if (!perms) return [...required];
  return required.filter((flag) => !perms.has(flag));
}

/** German ephemeral reply for an invoker lacking channel rights, or null when all are present. */
export function invokerChannelError(channelMention: string, missing: readonly bigint[]): string | null {
  if (missing.length === 0) return null;
  const names = missing.map((flag) => `\`${LABELS.get(flag) ?? flag.toString()}\``).join(', ');
  return `❌ Dir fehlen in ${channelMention} die Rechte: ${names}.`;
}

/**
 * A custom role ping is allowed only for mentionable roles or when the invoker
 * may mention everything in that channel; the bot (Administrator) would
 * otherwise ping any role on the invoker's behalf.
 */
export function rolePingAllowed(roleMentionable: boolean, invokerPerms: Readonly<PermissionsBitField> | null | undefined): boolean {
  return roleMentionable || Boolean(invokerPerms?.has(PermissionFlagsBits.MentionEveryone));
}
