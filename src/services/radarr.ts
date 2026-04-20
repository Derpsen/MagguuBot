import { config } from '../config.js';
import { ArrClient } from './arr-client.js';

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
