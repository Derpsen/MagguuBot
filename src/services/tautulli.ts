import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { buildServiceUrl } from './service-url.js';

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

const TAUTULLI_TIMEOUT_MS = 10_000;

async function tautulliRequest<T>(
  cmd: string,
  params: Record<string, string> = {},
): Promise<{ ok: true; data: T } | { ok: false }> {
  if (!config.TAUTULLI_URL || !config.TAUTULLI_API_KEY) return { ok: false };
  const q = new URLSearchParams({ apikey: config.TAUTULLI_API_KEY, cmd, ...params });
  const url = `${buildServiceUrl(config.TAUTULLI_URL, '/api/v2')}?${q.toString()}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TAUTULLI_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) {
      logger.warn({ cmd, status: res.status }, 'tautulli request failed');
      return { ok: false };
    }
    const envelope = (await res.json()) as TautulliEnvelope<T>;
    if (envelope.response.result !== 'success') {
      logger.warn({ cmd, message: envelope.response.message }, 'tautulli returned error');
      return { ok: false };
    }
    return { ok: true, data: envelope.response.data };
  } catch (err) {
    logger.warn({ err, cmd }, 'tautulli fetch error');
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

async function tautulliFetch<T>(cmd: string, params: Record<string, string> = {}): Promise<T | null> {
  const result = await tautulliRequest<T>(cmd, params);
  return result.ok ? result.data : null;
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
  session_key?: string | number;
  session_id?: string | number;
  paused_counter?: string | number;
  live?: string | number | boolean;
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
  sessionKey: string | null;
  sessionId: string | null;
  user: string;
  player: string;
  state: string;
  mediaType: string;
  title: string;
  durationMs: number;
  progressMs: number;
  progressPercent: number;
  pausedCounterSeconds: number;
  live: boolean;
  thumbPath: string | null;
  decision: string | null;
  resolution: string | null;
  bandwidthKbps: number;
}

export async function terminateSession(input: {
  sessionKey?: string | null;
  sessionId?: string | null;
  message?: string;
}): Promise<boolean> {
  const params: Record<string, string> = {};
  if (input.sessionKey) params.session_key = input.sessionKey;
  else if (input.sessionId) params.session_id = input.sessionId;
  else return false;
  if (input.message) params.message = input.message;
  const result = await tautulliRequest('terminate_session', params);
  return result.ok;
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
      sessionKey: stringish(s.session_key),
      sessionId: stringish(s.session_id),
      user: (s.friendly_name && s.friendly_name.trim()) || s.user || 'unknown',
      player: s.player || s.product || s.platform || 'unknown',
      state: s.state || 'unknown',
      mediaType: s.media_type || 'unknown',
      title: buildSessionTitle(s),
      durationMs,
      progressMs,
      progressPercent: durationMs > 0 ? Math.min(100, Math.round((progressMs / durationMs) * 100)) : pct,
      pausedCounterSeconds: intish(s.paused_counter),
      live: isLiveFlag(s.live),
      thumbPath: s.thumb || s.art || null,
      decision: s.transcode_decision || null,
      resolution: s.stream_video_resolution || null,
      bandwidthKbps: intish(s.bandwidth),
    };
  });
}

function stringish(value: string | number | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function isLiveFlag(value: string | number | boolean | undefined | null): boolean {
  return value === true || value === 1 || value === '1';
}

export function pickStatSection(
  sections: TautulliStatSection[],
  statId: 'top_movies' | 'top_tv' | 'top_users',
): TautulliStatSection | undefined {
  return sections.find((s) => s.stat_id === statId);
}
