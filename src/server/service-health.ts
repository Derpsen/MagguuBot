import { desc, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { webhookEvents } from '../db/schema.js';
import { getRadarrStatus } from '../services/radarr.js';
import { getSabVersion } from '../services/sabnzbd.js';
import { getSeerrStatus } from '../services/seerr.js';
import { getSonarrStatus } from '../services/sonarr.js';
import { getActivePlexStreamCount } from '../services/tautulli.js';

export type ServiceHealthState = 'ok' | 'error' | 'disabled' | 'waiting';

export interface ServiceHealthResult {
  key: string;
  label: string;
  state: ServiceHealthState;
  latencyMs: number | null;
  detail: string;
  lastEventAt: string | null;
}

let cache: { at: number; value: ServiceHealthResult[] } | null = null;
const CACHE_MS = 20_000;

export async function getServiceHealth(force = false): Promise<ServiceHealthResult[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const results = await Promise.all([
    probe('sonarr', 'Sonarr', Boolean(config.SONARR_URL && config.SONARR_API_KEY), async () => {
      const status = await getSonarrStatus();
      if (!status) throw new Error('keine Statusantwort');
      return status.version ? `Version ${status.version}` : 'erreichbar';
    }),
    probe('radarr', 'Radarr', Boolean(config.RADARR_URL && config.RADARR_API_KEY), async () => {
      const status = await getRadarrStatus();
      if (!status) throw new Error('keine Statusantwort');
      return status.version ? `Version ${status.version}` : 'erreichbar';
    }),
    probe('seerr', 'Seerr', Boolean(config.SEERR_URL && config.SEERR_API_KEY), async () => {
      const status = await getSeerrStatus();
      if (!status) throw new Error('keine Statusantwort');
      return status.version ? `Version ${status.version}` : 'erreichbar';
    }),
    probe('sabnzbd', 'SABnzbd', Boolean(config.SAB_URL && config.SAB_API_KEY), async () => {
      const status = await getSabVersion();
      if (!status) throw new Error('keine Statusantwort');
      return status.version ? `Version ${status.version}` : 'erreichbar';
    }),
    probe('tautulli', 'Tautulli', Boolean(config.TAUTULLI_URL && config.TAUTULLI_API_KEY), async () => {
      const streams = await getActivePlexStreamCount();
      if (streams === null) throw new Error('keine Statusantwort');
      return `${streams} aktive Streams`;
    }),
    maintainerrHealth(),
  ]);
  cache = { at: Date.now(), value: results };
  return results;
}

async function probe(
  key: string,
  label: string,
  configured: boolean,
  request: () => Promise<string>,
): Promise<ServiceHealthResult> {
  if (!configured) return { key, label, state: 'disabled', latencyMs: null, detail: 'nicht eingerichtet', lastEventAt: null };
  const start = performance.now();
  try {
    const detail = await request();
    return { key, label, state: 'ok', latencyMs: Math.round(performance.now() - start), detail, lastEventAt: null };
  } catch (err) {
    return {
      key,
      label,
      state: 'error',
      latencyMs: Math.round(performance.now() - start),
      detail: err instanceof Error ? err.message : 'nicht erreichbar',
      lastEventAt: null,
    };
  }
}

function maintainerrHealth(): ServiceHealthResult {
  const latest = db
    .select({ status: webhookEvents.status, createdAt: webhookEvents.createdAt })
    .from(webhookEvents)
    .where(eq(webhookEvents.source, 'maintainerr'))
    .orderBy(desc(webhookEvents.createdAt))
    .limit(1)
    .get();
  if (!latest) {
    return { key: 'maintainerr', label: 'Maintainerr', state: 'waiting', latencyMs: null, detail: 'wartet auf ersten Webhook', lastEventAt: null };
  }
  return {
    key: 'maintainerr',
    label: 'Maintainerr',
    state: latest.status === 'failed' ? 'error' : 'ok',
    latencyMs: null,
    detail: latest.status === 'failed' ? 'letzte Zustellung fehlgeschlagen' : 'Webhook verbunden',
    lastEventAt: latest.createdAt.toISOString(),
  };
}
