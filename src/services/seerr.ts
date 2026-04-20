import { config } from '../config.js';
import { logger } from '../utils/logger.js';

interface SeerrOpts {
  method?: 'GET' | 'POST';
  body?: unknown;
}

async function seerrFetch<T>(path: string, opts: SeerrOpts = {}): Promise<T> {
  if (!config.SEERR_URL || !config.SEERR_API_KEY) {
    throw new Error('SEERR_URL/SEERR_API_KEY not configured');
  }
  const res = await fetch(`${config.SEERR_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'X-Api-Key': config.SEERR_API_KEY,
      'Content-Type': 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.error({ path, status: res.status, text }, 'seerr request failed');
    throw new Error(`Seerr ${path} → ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function approveSeerrRequest(requestId: number): Promise<void> {
  await seerrFetch(`/api/v1/request/${requestId}/approve`, { method: 'POST' });
}

export async function declineSeerrRequest(requestId: number): Promise<void> {
  await seerrFetch(`/api/v1/request/${requestId}/decline`, { method: 'POST' });
}
