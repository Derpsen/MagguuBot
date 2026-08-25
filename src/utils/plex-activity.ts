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

export const PLEX_ORPHAN_CARD_GRACE_MS = 3 * 60_000;
const OPEN_ACTIVITY_STATES = new Set(['play', 'pause', 'resume', 'buffer']);

export interface PlexProgressWatch {
  progressMs: number;
  unchangedSince: number;
}

export interface PlexLiveSessionMatch {
  sessionKey?: string | null;
  user?: string;
  player?: string;
  mediaType?: string;
}

export function isOpenPlexActivityState(state: string): boolean {
  return OPEN_ACTIVITY_STATES.has(state);
}

export function nextProgressWatch(
  previous: PlexProgressWatch | undefined,
  progressMs: number,
  now: number,
): PlexProgressWatch {
  if (previous && previous.progressMs === progressMs) return previous;
  return { progressMs, unchangedSince: now };
}

export function decideStaleSession(input: {
  state: string;
  pausedCounterSeconds: number;
  live: boolean;
  progressWatch: PlexProgressWatch;
  now: number;
  staleAfterMs: number;
}): 'paused' | 'stuck-progress' | null {
  if (input.staleAfterMs <= 0) return null;
  const state = input.state.toLowerCase();
  if (state === 'paused' && input.pausedCounterSeconds * 1000 >= input.staleAfterMs) {
    return 'paused';
  }
  if (input.live) return null;
  if (
    (state === 'playing' || state === 'paused' || state === 'buffering')
    && input.now - input.progressWatch.unchangedSince >= input.staleAfterMs
  ) {
    return 'stuck-progress';
  }
  return null;
}

export function plexActivityMatchesLiveSession(
  correlationKey: string,
  session: PlexLiveSessionMatch,
): boolean {
  const sessionKey = clean(session.sessionKey);
  if (sessionKey && correlationKey === `session:${sessionKey}`) return true;

  const user = normalize(session.user);
  const player = normalize(session.player);
  if (!user && !player) return false;
  if (correlationKey === `music:${user || '-'}:${player || '-'}`) return true;
  return correlationKey.startsWith(`fallback:${user || '-'}:${player || '-'}:`);
}

export function shouldCloseOrphanActivityCard(input: {
  state: string;
  correlationKey: string;
  updatedAt: Date;
  sessions: readonly PlexLiveSessionMatch[];
  now: Date;
  graceMs?: number;
}): boolean {
  if (!isOpenPlexActivityState(input.state)) return false;
  if (input.sessions.some((session) => plexActivityMatchesLiveSession(input.correlationKey, session))) {
    return false;
  }
  const grace = input.graceMs ?? PLEX_ORPHAN_CARD_GRACE_MS;
  return input.now.getTime() - input.updatedAt.getTime() >= grace;
}

function clean(value: string | number | null | undefined): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalize(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ') ?? '';
}
