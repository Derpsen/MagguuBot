export type WebhookRetryState = 'pending' | 'resolved' | 'exhausted';

export function webhookRetryState(
  originalStatus: string,
  success: boolean,
  retryCount: number,
  maxAttempts: number,
): WebhookRetryState {
  if (success) return 'resolved';
  if (originalStatus !== 'failed') return 'exhausted';
  return retryCount >= maxAttempts ? 'exhausted' : 'pending';
}
