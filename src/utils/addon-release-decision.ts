export interface ReleaseLike {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
}

export type PollDecision = 'seed' | 'skip' | 'announce';

/** Empty store = first start: seed with the current latest instead of announcing it. */
export function decideRelease(release: ReleaseLike, announced: readonly string[]): PollDecision {
  if (release.draft || release.prerelease) return 'skip';
  if (announced.length === 0) return 'seed';
  const tag = release.tag_name.trim().toLowerCase();
  return announced.some((t) => t.trim().toLowerCase() === tag) ? 'skip' : 'announce';
}
