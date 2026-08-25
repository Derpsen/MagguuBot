export const TAUTULLI_RECENTLY_ADDED = 'recently_added';

export function normalizeTautulliEvent(event: string): string {
  return event.toLowerCase().trim().replace(/[\s-]+/g, '_');
}

export function resolveTautulliEventName(event: string): string | undefined {
  const t = normalizeTautulliEvent(event);
  if (t === 'created' || t === 'recently_added' || t === 'new_media') return TAUTULLI_RECENTLY_ADDED;
  return t || undefined;
}
