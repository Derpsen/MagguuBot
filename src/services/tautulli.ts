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

interface TautulliActivityEnvelope {
  stream_count?: string | number;
  stream_count_transcode?: string | number;
  sessions?: TautulliSessionRaw[];
}

export interface TautulliSessionRaw {
  user?: string;
  friendly_name?: string;
  player?: string;
  product?: string;
  platform?: string;
  state?: 'playing' | 'paused' | 'buffering' | string;
  media_type?: 'movie' | 'episode' | 'track' | 'clip' | string;
  full_title?: string;
  title?: string;
  grandparent_title?: string;
  parent_title?: string;
  parent_media_index?: string | number;
  media_index?: string | number;
  year?: string | number;
  duration?: string | number;
  view_offset?: string | number;
  progress_percent?: string | number;
  thumb?: string;
  art?: string;
  transcode_decision?: string;
  stream_video_resolution?: string;
  bandwidth?: string | number;
}

export interface TautulliSession {
  user: string;
  player: string;
  state: string;
  mediaType: string;
  title: string;
  durationMs: number;
  progressMs: number;
  progressPercent: number;
  thumbPath: string | null;
  decision: string | null;
  resolution: string | null;
  bandwidthKbps: number;
}

export async function getActivePlexStreamCount(): Promise<number | null> {
  const data = await tautulliFetch<TautulliActivityEnvelope>('get_activity');
  if (!data) return null;
  const raw = data.stream_count;
  if (raw === undefined || raw === null) return 0;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : 0;
}

function intish(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : 0;
}

function buildSessionTitle(s: TautulliSessionRaw): string {
  if (s.media_type === 'episode' && s.grandparent_title) {
    const season = intish(s.parent_media_index);
    const episode = intish(s.media_index);
    const code = season || episode ? ` · S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}` : '';
    return `${s.grandparent_title}${code}${s.title ? ` — ${s.title}` : ''}`;
  }
  if (s.full_title) return s.full_title;
  const year = s.year ? ` (${s.year})` : '';
  return `${s.title ?? 'Unknown'}${year}`;
}

export async function getActiveSessions(): Promise<TautulliSession[] | null> {
  const data = await tautulliFetch<TautulliActivityEnvelope>('get_activity');
  if (!data) return null;
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  return sessions.map((s): TautulliSession => {
    const durationMs = intish(s.duration);
    const progressMs = intish(s.view_offset);
    const pct = intish(s.progress_percent);
    return {
      user: (s.friendly_name && s.friendly_name.trim()) || s.user || 'unknown',
      player: s.player || s.product || s.platform || 'unknown',
      state: s.state || 'unknown',
      mediaType: s.media_type || 'unknown',
      title: buildSessionTitle(s),
      durationMs,
      progressMs,
      progressPercent: durationMs > 0 ? Math.min(100, Math.round((progressMs / durationMs) * 100)) : pct,
      thumbPath: s.thumb || s.art || null,
      decision: s.transcode_decision || null,
      resolution: s.stream_video_resolution || null,
      bandwidthKbps: intish(s.bandwidth),
    };
  });
}

export function pickStatSection(
  sections: TautulliStatSection[],
  statId: 'top_movies' | 'top_tv' | 'top_users',
): TautulliStatSection | undefined {
  return sections.find((s) => s.stat_id === statId);
}
