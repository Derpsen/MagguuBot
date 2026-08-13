export interface PlexActivityIdentity {
  sessionKey?: string | number;
  ratingKey?: string | number;
  user?: string;
  player?: string;
  title?: string;
  showTitle?: string;
  season?: string;
  episode?: string;
  mediaType?: string;
}

export function plexActivityCorrelationKey(identity: PlexActivityIdentity): string | null {
  const user = normalize(identity.user);
  const player = normalize(identity.player);
  if (normalize(identity.mediaType) === 'track' && (user || player)) {
    return `music:${user || '-'}:${player || '-'}`.slice(0, 500);
  }

  const sessionKey = clean(identity.sessionKey);
  if (sessionKey) return `session:${sessionKey}`;

  const media = clean(identity.ratingKey)
    ? `rating:${clean(identity.ratingKey)}`
    : normalize([
        identity.showTitle,
        identity.season,
        identity.episode,
        identity.title,
      ].filter(Boolean).join('|'));

  if (!media || (!user && !player)) return null;
  return `fallback:${user || '-'}:${player || '-'}:${media}`.slice(0, 500);
}

export function preservePlexActivityState(current: string | undefined, incoming: string): string {
  return current === 'watched' && incoming === 'stop' ? 'watched' : incoming;
}

export const PLEX_PAUSE_HOLD_MS = 2 * 60_000;

export type PlexActivityDecision =
  | { action: 'apply'; displayKind: string; pausedAt: Date | null }
  | { action: 'defer-pause'; pausedAt: Date }
  | { action: 'ignore'; pausedAt: Date | null };

export function decidePlexActivityEvent(input: {
  currentState?: string;
  incoming: string;
  pausedAt?: Date | null;
  now?: Date;
}): PlexActivityDecision {
  const now = input.now ?? new Date();
  if (input.incoming === 'pause') {
    if (input.currentState === 'pause') return { action: 'ignore', pausedAt: null };
    if (input.pausedAt) return { action: 'ignore', pausedAt: input.pausedAt };
    return { action: 'defer-pause', pausedAt: now };
  }
  if (input.incoming === 'resume') {
    if (input.currentState === 'pause') return { action: 'apply', displayKind: 'play', pausedAt: null };
    return { action: 'ignore', pausedAt: null };
  }
  return {
    action: 'apply',
    displayKind: preservePlexActivityState(input.currentState, input.incoming),
    pausedAt: null,
  };
}

export function shouldFlushDeferredPause(pausedAt: Date | null | undefined, now = new Date()): boolean {
  return Boolean(pausedAt && now.getTime() - pausedAt.getTime() >= PLEX_PAUSE_HOLD_MS);
}

function clean(value: string | number | undefined): string {
  return value === undefined ? '' : String(value).trim();
}

function normalize(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ') ?? '';
}
