/**
 * Import de-duplication: one card per imported episode / movie within a window, and
 * a SABnzbd "complete" is dropped when Sonarr/Radarr reported the same release.
 */

/** Release name for matching (case, separators and file extension ignored). */
export function normRelease(name: string | null | undefined): string {
  return (name ?? '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.(mkv|mp4|avi|m4v|ts|nzb)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export interface ImportIdentity {
  service: 'sonarr' | 'radarr';
  title: string;
  /** series.id / movie.id when present */
  mediaId?: number | string;
  episodes?: Array<{ season?: number; number?: number }>;
  downloadId?: string;
  releaseNames?: Array<string | null | undefined>;
}

/** Item keys: one per episode (Sonarr) or one per movie (Radarr). */
export function importItemKeys(i: ImportIdentity): string[] {
  const media = `${i.service}:${i.mediaId ?? i.title.toLowerCase()}`;
  if (i.service === 'radarr') return [media];
  const eps = (i.episodes ?? []).filter((e) => e.season !== undefined && e.number !== undefined);
  if (!eps.length) return [`${media}:${i.downloadId ?? 'file'}`];
  return eps.map((e) => `${media}:S${e.season}E${e.number}`);
}

export function importNameKeys(i: ImportIdentity): string[] {
  return [...(i.downloadId ? [`dl:${i.downloadId.toLowerCase()}`] : []), ...(i.releaseNames ?? []).map(normRelease).filter((n) => n.length >= 6).map((n) => `rel:${n}`)];
}

/** Keys remembered for `ttlMs` (injectable clock). */
export class TtlKeys {
  private readonly seen = new Map<string, number>();
  constructor(private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  private prune(): void {
    const t = this.now();
    for (const [k, at] of this.seen) if (t - at >= this.ttlMs) this.seen.delete(k);
  }

  has(key: string): boolean {
    this.prune();
    return this.seen.has(key);
  }

  /** True when every key was already seen (and nothing new to post). */
  allSeen(keys: readonly string[]): boolean {
    this.prune();
    return keys.length > 0 && keys.every((k) => this.seen.has(k));
  }

  add(keys: readonly string[]): void {
    const t = this.now();
    for (const k of keys) this.seen.set(k, t);
  }
}
