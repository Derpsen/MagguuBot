import { config } from '../config.js';
import { ArrClient } from './arr-client.js';
import type { ArrDiskSpace, ArrHealthIssue, ArrSystemStatus } from './sonarr.js';

export interface RadarrQueueItem {
  id: number;
  movieId: number;
  title: string;
  size: number;
  sizeleft: number;
  status: string;
  timeleft?: string;
  indexer?: string;
}

export interface RadarrQueueResponse {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: RadarrQueueItem[];
}

export interface RadarrMovie {
  id?: number;
  title: string;
  year: number;
  tmdbId: number;
  imdbId?: string;
  images: { coverType: string; remoteUrl?: string }[];
  overview?: string;
  status?: string;
}

export const radarr =
  config.RADARR_URL && config.RADARR_API_KEY
    ? new ArrClient('radarr', config.RADARR_URL, config.RADARR_API_KEY)
    : null;

export async function getRadarrQueue(): Promise<RadarrQueueResponse | null> {
  if (!radarr) return null;
  return radarr.get<RadarrQueueResponse>('/api/v3/queue?pageSize=50&includeMovie=true');
}

export async function searchRadarr(query: string): Promise<RadarrMovie[]> {
  if (!radarr) return [];
  return radarr.get<RadarrMovie[]>(`/api/v3/movie/lookup?term=${encodeURIComponent(query)}`);
}

export async function getRadarrStatus(): Promise<ArrSystemStatus | null> {
  if (!radarr) return null;
  return radarr.get<ArrSystemStatus>('/api/v3/system/status');
}

export async function getRadarrHealth(): Promise<ArrHealthIssue[]> {
  if (!radarr) return [];
  return radarr.get<ArrHealthIssue[]>('/api/v3/health');
}

export async function getRadarrDiskSpace(): Promise<ArrDiskSpace[]> {
  if (!radarr) return [];
  return radarr.get<ArrDiskSpace[]>('/api/v3/diskspace');
}

export interface RadarrCalendarEntry {
  id: number;
  title: string;
  year?: number;
  inCinemas?: string;
  physicalRelease?: string;
  digitalRelease?: string;
  hasFile: boolean;
}

export async function getRadarrCalendar(startIso: string, endIso: string): Promise<RadarrCalendarEntry[]> {
  if (!radarr) return [];
  const q = `start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`;
  return radarr.get<RadarrCalendarEntry[]>(`/api/v3/calendar?${q}`);
}
