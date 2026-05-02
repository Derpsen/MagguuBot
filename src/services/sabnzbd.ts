import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface SabSlot {
  nzo_id: string;
  filename: string;
  cat?: string;
  status: string;
  mb: string;
  mbleft: string;
  percentage: string;
  timeleft?: string;
}

export interface SabQueueResponse {
  queue: {
    paused: boolean;
    noofslots_total: number;
    slots: SabSlot[];
    mb: string;
    mbleft: string;
    speed: string;
    timeleft?: string;
  };
}

const SAB_TIMEOUT_MS = 10_000;

async function sabFetch<T>(mode: string, extra: Record<string, string> = {}): Promise<T | null> {
  if (!config.SAB_URL || !config.SAB_API_KEY) return null;
  const params = new URLSearchParams({
    mode,
    output: 'json',
    apikey: config.SAB_API_KEY,
    ...extra,
  });
  const url = `${config.SAB_URL}/api?${params.toString()}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SAB_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.error({ mode, status: res.status, text }, 'sabnzbd request failed');
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.warn({ err, mode }, 'sabnzbd fetch error');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getSabQueue(): Promise<SabQueueResponse | null> {
  return sabFetch<SabQueueResponse>('queue', { limit: '20' });
}

export interface SabVersion {
  version: string;
}

export async function getSabVersion(): Promise<SabVersion | null> {
  return sabFetch<SabVersion>('version');
}
