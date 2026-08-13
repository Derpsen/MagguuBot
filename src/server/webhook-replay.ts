import { createHmac, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { config } from '../config.js';
import { githubWebhook } from './webhooks/github.js';
import { maintainerrWebhook } from './webhooks/maintainerr.js';
import { prowlarrWebhook } from './webhooks/prowlarr.js';
import { radarrWebhook } from './webhooks/radarr.js';
import { sabnzbdWebhook } from './webhooks/sabnzbd.js';
import { seerrWebhook } from './webhooks/seerr.js';
import { sonarrWebhook } from './webhooks/sonarr.js';
import { tautulliWebhook } from './webhooks/tautulli.js';
import { withWebhookReplayContext } from './webhook-retry-context.js';
import { isReplayableWebhookSource, type ReplayableWebhookSource } from './webhook-sources.js';

const ROUTES: Record<ReplayableWebhookSource, Hono> = {
  sonarr: sonarrWebhook,
  radarr: radarrWebhook,
  seerr: seerrWebhook,
  tautulli: tautulliWebhook,
  sabnzbd: sabnzbdWebhook,
  maintainerr: maintainerrWebhook,
  github: githubWebhook,
  prowlarr: prowlarrWebhook,
};

export async function replayWebhook(
  source: string,
  eventType: string,
  payload: unknown,
  replayOfEventId?: number,
): Promise<Response> {
  if (!isReplayableWebhookSource(source)) throw new Error(`source ${source} cannot be replayed`);
  const route = ROUTES[source];
  const body = JSON.stringify(payload);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (source === 'github') {
    if (!config.GITHUB_WEBHOOK_SECRET) throw new Error('GITHUB_WEBHOOK_SECRET is not configured');
    headers.set('x-github-event', eventType.split('.')[0] ?? eventType);
    headers.set('x-github-delivery', randomUUID());
    headers.set('x-magguu-replay', '1');
    headers.set(
      'x-hub-signature-256',
      `sha256=${createHmac('sha256', config.GITHUB_WEBHOOK_SECRET).update(body).digest('hex')}`,
    );
  }
  const request = async (): Promise<Response> => route.request('http://internal/', { method: 'POST', headers, body });
  return replayOfEventId
    ? withWebhookReplayContext({
        replayOfEventId,
        suppressRetrySchedule: true,
        source,
        eventType,
      }, request)
    : request();
}
