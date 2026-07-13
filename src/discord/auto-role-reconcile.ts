export const AUTO_ROLE_RECONCILE_LIMIT = 50;
export const AUTO_ROLE_RECONCILE_WINDOW_DAYS = 30;
export const AUTO_ROLE_RECONCILE_WINDOW_MS = AUTO_ROLE_RECONCILE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export interface AutoRoleReconcileFacts {
  isBot: boolean;
  hasTargetRole: boolean;
  hasOnlyEveryoneRole: boolean;
  joinedTimestamp: number | null;
}

/**
 * Backfill only recent, otherwise roleless humans. This repairs missed join
 * events without changing intentionally roleless legacy accounts.
 */
export function isAutoRoleReconcileCandidate(
  facts: AutoRoleReconcileFacts,
  now = Date.now(),
): boolean {
  return !facts.isBot
    && !facts.hasTargetRole
    && facts.hasOnlyEveryoneRole
    && facts.joinedTimestamp !== null
    && facts.joinedTimestamp >= now - AUTO_ROLE_RECONCILE_WINDOW_MS
    && facts.joinedTimestamp <= now;
}
