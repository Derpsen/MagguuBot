import { config } from '../config.js';

const IMG_BASE = 'https://image.tmdb.org/t/p';

export function tmdbPoster(path: string | null | undefined, size: 'w342' | 'w500' | 'original' = 'w500'): string | null {
  if (!path) return null;
  return `${IMG_BASE}/${size}${path}`;
}

export function tmdbBackdrop(path: string | null | undefined, size: 'w780' | 'w1280' | 'original' = 'w1280'): string | null {
  if (!path) return null;
  return `${IMG_BASE}/${size}${path}`;
}

export interface TmdbMovie {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  runtime?: number;
  genres?: { id: number; name: string }[];
}

export interface TmdbTv {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  vote_average: number;
  genres?: { id: number; name: string }[];
}

export async function getTmdbMovie(id: number): Promise<TmdbMovie | null> {
  if (!config.TMDB_API_KEY) return null;
  const res = await fetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${config.TMDB_API_KEY}`);
  if (!res.ok) return null;
  return (await res.json()) as TmdbMovie;
}

export async function getTmdbTv(id: number): Promise<TmdbTv | null> {
  if (!config.TMDB_API_KEY) return null;
  const res = await fetch(`https://api.themoviedb.org/3/tv/${id}?api_key=${config.TMDB_API_KEY}`);
  if (!res.ok) return null;
  return (await res.json()) as TmdbTv;
}
