export const WEBHOOK_CLEAR_SCOPES = ['all', 'failed', 'skipped'] as const;

export type WebhookClearScope = (typeof WEBHOOK_CLEAR_SCOPES)[number];

const webhookClearScopes = new Set<string>(WEBHOOK_CLEAR_SCOPES);

export function parseWebhookClearScope(value: string | undefined): WebhookClearScope | null {
  const scope = value ?? 'all';
  return webhookClearScopes.has(scope) ? scope as WebhookClearScope : null;
}
