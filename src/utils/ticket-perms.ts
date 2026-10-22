/**
 * Permission spec for private ticket channels and the 🎫 TICKETS category.
 * Pure: used by `createPrivateTicketChannel` and the acceptance test ticket,
 * so the live check exercises exactly what the bot creates.
 */
import { PermissionFlagsBits } from 'discord.js';
import { STAFF_ROLE_NAMES } from '../discord/server-layout.js';

export const TICKET_MODERATOR_ROLE_NAMES: ReadonlySet<string> = new Set(STAFF_ROLE_NAMES);

export interface OverwriteBits {
  id: string;
  /** 0 = role, 1 = member */
  type: 0 | 1;
  allow: bigint;
  deny: bigint;
}

const bits = (...flags: bigint[]): bigint => flags.reduce((a, b) => a | b, 0n);

export const TICKET_OPENER_ALLOW = bits(
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
);
export const TICKET_MODERATOR_ALLOW = bits(
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
);
export const TICKET_BOT_ALLOW = bits(
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.AttachFiles,
);

export function ticketChannelOverwrites(input: {
  everyoneId: string;
  openerId: string;
  moderatorRoleIds: readonly string[];
  botUserId?: string;
}): OverwriteBits[] {
  const out: OverwriteBits[] = [
    { id: input.everyoneId, type: 0, allow: 0n, deny: PermissionFlagsBits.ViewChannel },
    { id: input.openerId, type: 1, allow: TICKET_OPENER_ALLOW, deny: 0n },
    ...input.moderatorRoleIds.map((id) => ({ id, type: 0 as const, allow: TICKET_MODERATOR_ALLOW, deny: 0n })),
  ];
  // The bot overwrite is part of the create call: after "everyone: no view" it must still see the channel.
  if (input.botUserId && input.botUserId !== input.openerId) {
    out.push({ id: input.botUserId, type: 1, allow: TICKET_BOT_ALLOW, deny: 0n });
  } else if (input.botUserId) {
    const opener = out[1]!;
    opener.allow |= TICKET_BOT_ALLOW;
  }
  return out;
}

/** The category itself is hidden from everyone; ticket channels carry their own overwrites. */
export function ticketCategoryOverwrites(input: { everyoneId: string; moderatorRoleIds: readonly string[]; botUserId?: string }): OverwriteBits[] {
  return [
    { id: input.everyoneId, type: 0, allow: 0n, deny: PermissionFlagsBits.ViewChannel },
    ...input.moderatorRoleIds.map((id) => ({ id, type: 0 as const, allow: PermissionFlagsBits.ViewChannel, deny: 0n })),
    ...(input.botUserId ? [{ id: input.botUserId, type: 1 as const, allow: TICKET_BOT_ALLOW, deny: 0n }] : []),
  ];
}

/** Check a live overwrite list against the spec: the opener/staff can see it, nobody else can. */
export function verifyTicketOverwrites(
  live: ReadonlyArray<{ id: string; type: number; allow: string; deny: string }>,
  expected: readonly OverwriteBits[],
): string[] {
  const problems: string[] = [];
  for (const exp of expected) {
    const got = live.find((o) => o.id === exp.id);
    if (!got) {
      problems.push(`Overwrite für ${exp.id} fehlt`);
      continue;
    }
    if ((BigInt(got.allow) & exp.allow) !== exp.allow) problems.push(`${exp.id}: erlaubte Rechte fehlen`);
    if ((BigInt(got.deny) & exp.deny) !== exp.deny) problems.push(`${exp.id}: verbotene Rechte fehlen`);
  }
  return problems;
}
