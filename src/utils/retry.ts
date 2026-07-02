const WEBHOOK_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000] as const;

export function webhookRetryDelayMs(attemptsCompleted: number): number {
  const index = Math.max(0, Math.min(WEBHOOK_RETRY_DELAYS_MS.length - 1, Math.floor(attemptsCompleted)));
  return WEBHOOK_RETRY_DELAYS_MS[index] ?? WEBHOOK_RETRY_DELAYS_MS[0];
}
