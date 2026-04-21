import { config } from '../config.js';
import { ArrClient } from './arr-client.js';

export interface SonarrQueueItem {
  id: number;
  seriesId: number;
  title: string;
  size: number;
  sizeleft: number;
  status: string;
  timeleft?: string;
  estimatedCompletionTime?: string;
  indexer?: string;
}

export interface SonarrQueueResponse {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: SonarrQueueItem[];
}

export interface SonarrSeries {
  id: number;
  title: string;
  year: number;
  tvdbId: number;
  imdbId?: string;
  images: { coverType: string; remoteUrl?: string }[];
  status: string;
}

export const sonarr =
  config.SONARR_URL && config.SONARR_API_KEY
    ? new ArrClient('sonarr', config.SONARR_URL, config.SONARR_API_KEY)
    : null;

export async function getSonarrQueue(): Promise<SonarrQueueResponse | null> {
  if (!sonarr) return null;
  return sonarr.get<SonarrQueueResponse>('/api/v3/queue?pageSize=50&includeSeries=true');
}

export async function searchSonarr(query: string): Promise<SonarrSeries[]> {
  if (!sonarr) return [];
  return sonarr.get<SonarrSeries[]>(`/api/v3/series/lookup?term=${encodeURIComponent(query)}`);
}

export interface ArrSystemStatus {
  version: string;
  branch?: string;
  startTime?: string;
}

export interface ArrHealthIssue {
  source?: string;
  type?: 'ok' | 'warning' | 'error';
  message?: string;
}

export interface ArrDiskSpace {
  path: string;
  label?: string;
  freeSpace: number;
  totalSpace: number;
}

export async function getSonarrStatus(): Promise<ArrSystemStatus | null> {
  if (!sonarr) return null;
  return sonarr.get<ArrSystemStatus>('/api/v3/system/status');
}

export async function getSonarrHealth(): Promise<ArrHealthIssue[]> {
  if (!sonarr) return [];
  return sonarr.get<ArrHealthIssue[]>('/api/v3/health');
}

export async function getSonarrDiskSpace(): Promise<ArrDiskSpace[]> {
  if (!sonarr) return [];
  return sonarr.get<ArrDiskSpace[]>('/api/v3/diskspace');
}

export interface SonarrCalendarEntry {
  id: number;
  title: string;
  airDateUtc: string;
  seasonNumber: number;
  episodeNumber: number;
  hasFile: boolean;
  series?: { title: string; year?: number };
}

export async function getSonarrCalendar(startIso: string, endIso: string): Promise<SonarrCalendarEntry[]> {
  if (!sonarr) return [];
  const q = `start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&includeSeries=true`;
  return sonarr.get<SonarrCalendarEntry[]>(`/api/v3/calendar?${q}`);
}
