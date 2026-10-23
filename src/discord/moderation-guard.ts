export type ModerationAction = 'ban' | 'kick' | 'timeout';

export interface RoleLike<R> {
  comparePositionTo(role: R): number;
}

export interface GuardMember<R = unknown> {
  id: string;
  roles: { highest: R & RoleLike<R> };
  bannable: boolean;
  kickable: boolean;
  moderatable: boolean;
}

export interface ModerationGuardInput<R> {
  action: ModerationAction;
  guildOwnerId: string;
  botUserId: string;
  invokerId: string;
  invoker: GuardMember<R> | null;
  targetId: string;
  /** null when the target is not (or no longer) a member of the guild. */
  target: GuardMember<R> | null;
}

const VERB: Record<ModerationAction, string> = {
  ban: 'bannen',
  kick: 'kicken',
  timeout: 'timeouten',
};

const PASSIVE: Record<ModerationAction, string> = {
  ban: 'gebannt',
  kick: 'gekickt',
  timeout: 'getimeoutet',
};

/**
 * Role-hierarchy gate for /ban, /kick and /timeout. The bot holds Administrator,
 * so Discord's own hierarchy check only covers the bot; without this a junior
 * moderator could act on higher-ranked staff. Returns a German error message or
 * null when the action is allowed.
 */
export function checkModerationTarget<R>(input: ModerationGuardInput<R>): string | null {
  const { action, guildOwnerId, botUserId, invokerId, invoker, targetId, target } = input;

  if (targetId === invokerId) return `❌ Du kannst dich nicht selbst ${VERB[action]}.`;
  if (targetId === botUserId) return `❌ Den Bot selbst kannst du nicht ${VERB[action]}.`;
  if (targetId === guildOwnerId) return `❌ Der Server-Owner kann nicht ${PASSIVE[action]} werden.`;

  if (!target) {
    // Banning by ID a user who already left has no hierarchy to compare.
    return action === 'ban' ? null : 'User ist nicht im Server.';
  }

  if (invokerId !== guildOwnerId) {
    if (!invoker) return '❌ Deine Rollen konnten nicht geprüft werden. Bitte erneut versuchen.';
    if (invoker.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
      return '❌ Deine höchste Rolle muss über der höchsten Rolle des Ziels stehen.';
    }
  }

  const botCan =
    action === 'ban' ? target.bannable : action === 'kick' ? target.kickable : target.moderatable;
  if (!botCan) return `Konnte nicht ${VERB[action]} — Bot-Rolle muss über der Ziel-Rolle stehen.`;

  return null;
}
