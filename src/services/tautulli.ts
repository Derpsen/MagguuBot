import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface TautulliStatRow {
  title?: string;
  users_watched?: string;
  total_plays?: number;
  total_duration?: number;
  grandparent_title?: string;
  year?: number | string;
  thumb?: string;
  art?: string;
  user?: string;
  friendly_name?: string;
  rating_key?: string;
}

export interface TautulliStatSection {
  stat_id: string;
  stat_type?: string;
  stat_title?: string;
  rows: TautulliStatRow[];
}

interface TautulliEnvelope<T> {
  response: { result: 'success' | 'error'; data: T; message?: string };
}

async function tautulliFetch<T>(cmd: string, params: Record<string, string> = {}): Promise<T | null> {
  if (!config.TAUTULLI_URL || !config.TAUTULLI_API_KEY) return null;
  const q = new URLSearchParams({ apikey: config.TAUTULLI_API_KEY, cmd, ...params });
  const url = `${config.TAUTULLI_URL}/api/v2?${q.toString()}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn({ cmd, status: res.status }, 'tautulli request failed');
      return null;
    }
    const envelope = (await res.json()) as TautulliEnvelope<T>;
    if (envelope.response.result !== 'success') {
      logger.warn({ cmd, message: envelope.response.message }, 'tautulli returned error');
      return null;
    }
    return envelope.response.data;
  } catch (err) {
    logger.warn({ err, cmd }, 'tautulli fetch error');
    return null;
  }
}

export async function getHomeStats(
  timeRangeDays: number,
  statsCount: number,
): Promise<TautulliStatSection[] | null> {
  return tautulliFetch<TautulliStatSection[]>('get_home_stats', {
    time_range: String(timeRangeDays),
    stats_count: String(statsCount),
    stats_type: 'plays',
  });
}

export function pickStatSection(
  sections: TautulliStatSection[],
  statId: 'top_movies' | 'top_tv' | 'top_users',
): TautulliStatSection | undefined {
  return sections.find((s) => s.stat_id === statId);
}
