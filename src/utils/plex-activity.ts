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

function clean(value: string | number | undefined): string {
  return value === undefined ? '' : String(value).trim();
}

function normalize(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ') ?? '';
}
