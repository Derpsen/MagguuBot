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
