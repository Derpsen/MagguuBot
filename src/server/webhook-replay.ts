import { createHmac, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { config } from '../config.js';
import { githubWebhook } from './webhooks/github.js';
import { maintainerrWebhook } from './webhooks/maintainerr.js';
import { radarrWebhook } from './webhooks/radarr.js';
import { sabnzbdWebhook } from './webhooks/sabnzbd.js';
import { seerrWebhook } from './webhooks/seerr.js';
import { sonarrWebhook } from './webhooks/sonarr.js';
import { tautulliWebhook } from './webhooks/tautulli.js';

const ROUTES: Record<string, Hono> = {
  sonarr: sonarrWebhook,
  radarr: radarrWebhook,
  seerr: seerrWebhook,
  tautulli: tautulliWebhook,
  sabnzbd: sabnzbdWebhook,
  maintainerr: maintainerrWebhook,
  github: githubWebhook,
};

export async function replayWebhook(source: string, eventType: string, payload: unknown): Promise<Response> {
  const route = ROUTES[source];
  if (!route) throw new Error(`source ${source} cannot be replayed`);
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
  return route.request('http://internal/', { method: 'POST', headers, body });
}
