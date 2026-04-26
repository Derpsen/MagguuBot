import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_API = 'https://api.themoviedb.org/3';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface TmdbMovie {
  poster_path?: string | null;
}
interface TmdbTv {
  poster_path?: string | null;
}

interface CacheEntry {
  url: string | null;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function getTmdbPosterUrl(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
): Promise<string | null> {
  if (!config.TMDB_API_KEY || !tmdbId) return null;
  const key = `${mediaType}:${tmdbId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.url;

  try {
    const url = `${TMDB_API}/${mediaType}/${tmdbId}?api_key=${config.TMDB_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      cache.set(key, { url: null, fetchedAt: Date.now() });
      return null;
    }
    const data = (await res.json()) as TmdbMovie | TmdbTv;
    const posterUrl = data.poster_path ? `${POSTER_BASE}${data.poster_path}` : null;
    cache.set(key, { url: posterUrl, fetchedAt: Date.now() });
    return posterUrl;
  } catch (err) {
    logger.debug({ err, mediaType, tmdbId }, 'tmdb poster fetch failed');
    return null;
  }
}
