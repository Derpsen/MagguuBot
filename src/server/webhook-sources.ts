export const REPLAYABLE_WEBHOOK_SOURCES = [
  'sonarr',
  'radarr',
  'seerr',
  'tautulli',
  'sabnzbd',
  'maintainerr',
  'github',
] as const;

export type ReplayableWebhookSource = (typeof REPLAYABLE_WEBHOOK_SOURCES)[number];

export type WebhookReplayBlockReason = 'unsupported-source' | 'already-posted';

const replayableWebhookSources = new Set<string>(REPLAYABLE_WEBHOOK_SOURCES);

export function isReplayableWebhookSource(source: string): source is ReplayableWebhookSource {
  return replayableWebhookSources.has(source);
}

export function webhookReplayBlockReason(
  source: string,
  status: string,
): WebhookReplayBlockReason | null {
  if (!isReplayableWebhookSource(source)) return 'unsupported-source';
  if (status === 'posted') return 'already-posted';
  return null;
}
