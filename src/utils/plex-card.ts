import { createHash } from 'node:crypto';
import { EmbedBuilder } from 'discord.js';
import { Colors, FOOTER_ICONS, truncate } from '../embeds/colors.js';

/**
 * Pure model of the single Plex activity card: which sessions are running and
 * the last few finished ones. Events fold into this state; the card is only
 * rendered from it, so the same state always yields the same embed (and hash).
 */

export type PlexCardSessionState = 'play' | 'pause' | 'buffer';
export type PlexCardRecentKind = 'stop' | 'watched' | 'error' | 'info';

export interface PlexCardSession {
  key: string;
  sessionKey: string | null;
  user: string;
  player: string;
  title: string;
  mediaType: string;
  state: PlexCardSessionState;
  watched: boolean;
  startedAt: number;
  updatedAt: number;
}

export interface PlexCardRecent {
  key: string | null;
  kind: PlexCardRecentKind;
  user: string;
  title: string;
  at: number;
}

export interface PlexCardState {
  sessions: PlexCardSession[];
  recent: PlexCardRecent[];
  changedAt: number;
}

export interface PlexCardEvent {
  kind: string;
  key: string | null;
  sessionKey?: string | null;
  user?: string;
  player?: string;
  title?: string;
  mediaType?: string;
  at: number;
}

export const PLEX_CARD_MAX_RECENT = 6;
export const PLEX_CARD_MAX_SESSIONS = 12;
/** A watched flag followed by the real stop within this window upgrades the entry instead of adding a line. */
export const PLEX_CARD_WATCHED_MERGE_MS = 5 * 60_000;
/** Without Tautulli to confirm, a session with no event for this long is considered gone. */
export const PLEX_CARD_SESSION_TTL_MS = 6 * 60 * 60_000;

export function emptyPlexCardState(now = 0): PlexCardState {
  return { sessions: [], recent: [], changedAt: now };
}

function norm(value: string | undefined | null): string {
  return value?.trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ') ?? '';
}

function pushRecent(recent: PlexCardRecent[], entry: PlexCardRecent): PlexCardRecent[] {
  const last = recent[0];
  if (last && last.kind === entry.kind && last.key === entry.key && norm(last.title) === norm(entry.title)
    && norm(last.user) === norm(entry.user)) {
    return recent;
  }
  return [entry, ...recent].slice(0, PLEX_CARD_MAX_RECENT);
}

function sessionRecent(session: PlexCardSession, kind: PlexCardRecentKind, at: number): PlexCardRecent {
  return { key: session.key, kind, user: session.user, title: session.title, at };
}

/** Folds one Tautulli event into the card state. Returns the same object when nothing changed. */
export function applyPlexCardEvent(state: PlexCardState, event: PlexCardEvent): PlexCardState {
  const next = reduce(state, event);
  if (next === state) return state;
  return { ...next, changedAt: event.at };
}

function reduce(state: PlexCardState, event: PlexCardEvent): PlexCardState {
  const kind = event.kind;
  if (kind !== 'play' && kind !== 'pause' && kind !== 'resume' && kind !== 'stop'
    && kind !== 'watched' && kind !== 'buffer' && kind !== 'error') {
    return state;
  }
  if (!event.key) return reduceAnonymous(state, event);

  const index = state.sessions.findIndex((s) => s.key === event.key);
  const current = index >= 0 ? state.sessions[index] : undefined;

  // Music keeps one key across tracks; late events of the previous track must not touch the new one.
  if (current && event.mediaType?.toLowerCase() === 'track' && kind !== 'play'
    && current.sessionKey && event.sessionKey && current.sessionKey !== event.sessionKey) {
    return state;
  }

  if (kind === 'play' || kind === 'resume' || kind === 'buffer' || kind === 'pause') {
    const target: PlexCardSessionState = kind === 'pause' ? 'pause' : kind === 'buffer' ? 'buffer' : 'play';
    if (!current && kind !== 'play') {
      // A pause/resume/buffer for a session we never saw start (e.g. bot was down): adopt it.
      return withSession(state, newSession(event, target));
    }
    if (!current) return withSession(state, newSession(event, 'play'));
    const title = event.title?.trim() || current.title;
    const sameTrackSession = !event.sessionKey || event.sessionKey === current.sessionKey;
    // A fresh play on an existing key with a different title/session = next track/episode on that player.
    const updated: PlexCardSession = {
      ...current,
      sessionKey: event.sessionKey ?? current.sessionKey,
      title,
      state: target,
      watched: kind === 'play' && (title !== current.title || !sameTrackSession) ? false : current.watched,
      startedAt: kind === 'play' && (title !== current.title || !sameTrackSession) ? event.at : current.startedAt,
      updatedAt: event.at,
    };
    if (sameSession(current, updated)) return state;
    const sessions = state.sessions.slice();
    sessions[index] = updated;
    return { ...state, sessions };
  }

  if (kind === 'watched') {
    if (current) {
      if (current.watched) return state;
      const sessions = state.sessions.slice();
      sessions[index] = { ...current, watched: true, updatedAt: event.at };
      return { ...state, sessions };
    }
    const recentIndex = state.recent.findIndex((r) => r.key === event.key && r.kind === 'stop'
      && event.at - r.at <= PLEX_CARD_WATCHED_MERGE_MS);
    if (recentIndex >= 0) {
      const recent = state.recent.slice();
      recent[recentIndex] = { ...recent[recentIndex]!, kind: 'watched' };
      return { ...state, recent };
    }
    const already = state.recent.some((r) => r.key === event.key && r.kind === 'watched'
      && event.at - r.at <= PLEX_CARD_WATCHED_MERGE_MS);
    if (already) return state;
    return {
      ...state,
      recent: pushRecent(state.recent, {
        key: event.key, kind: 'watched', user: event.user?.trim() || '', title: event.title?.trim() || 'Unbekannt', at: event.at,
      }),
    };
  }

  if (kind === 'stop') {
    if (!current) return state;
    return {
      sessions: state.sessions.filter((_, i) => i !== index),
      recent: pushRecent(state.recent, sessionRecent(current, current.watched ? 'watched' : 'stop', event.at)),
      changedAt: state.changedAt,
    };
  }

  // error: shown as a recent line, session (if any) stays as is.
  return {
    ...state,
    recent: pushRecent(state.recent, {
      key: event.key,
      kind: 'error',
      user: event.user?.trim() || current?.user || '',
      title: event.title?.trim() || current?.title || 'Unbekannt',
      at: event.at,
    }),
  };
}

/** Events without user/player cannot be tied to a session; they only leave a short history line. */
function reduceAnonymous(state: PlexCardState, event: PlexCardEvent): PlexCardState {
  const kind: PlexCardRecentKind | null = event.kind === 'play' ? 'info'
    : event.kind === 'stop' ? 'stop'
      : event.kind === 'watched' ? 'watched'
        : event.kind === 'error' ? 'error' : null;
  if (!kind) return state;
  const title = event.title?.trim() || 'Unbekannt';
  const recent = pushRecent(state.recent, { key: null, kind, user: event.user?.trim() || '', title, at: event.at });
  return recent === state.recent ? state : { ...state, recent };
}

function newSession(event: PlexCardEvent, state: PlexCardSessionState): PlexCardSession {
  return {
    key: event.key ?? '',
    sessionKey: event.sessionKey ?? null,
    user: event.user?.trim() || '',
    player: event.player?.trim() || '',
    title: event.title?.trim() || 'Unbekannt',
    mediaType: event.mediaType?.trim() || '',
    state,
    watched: false,
    startedAt: event.at,
    updatedAt: event.at,
  };
}

function withSession(state: PlexCardState, session: PlexCardSession): PlexCardState {
  // One player can only play one thing: a new session on the same user+player replaces the old one.
  const user = norm(session.user);
  const player = norm(session.player);
  const replaced: PlexCardSession[] = [];
  const kept = state.sessions.filter((s) => {
    const same = (user || player) && norm(s.user) === user && norm(s.player) === player && s.key !== session.key;
    if (same) replaced.push(s);
    return !same;
  });
  let recent = state.recent;
  for (const old of replaced) {
    if (norm(old.title) !== norm(session.title)) recent = pushRecent(recent, sessionRecent(old, old.watched ? 'watched' : 'stop', session.startedAt));
  }
  const sessions = [session, ...kept].slice(0, PLEX_CARD_MAX_SESSIONS);
  return { sessions, recent, changedAt: state.changedAt };
}

function sameSession(a: PlexCardSession, b: PlexCardSession): boolean {
  return a.sessionKey === b.sessionKey && a.title === b.title && a.state === b.state
    && a.watched === b.watched && a.startedAt === b.startedAt;
}

/** Moves sessions without a recent event out of the running list (stale/orphan handling). */
export function closePlexCardSessions(
  state: PlexCardState,
  shouldClose: (session: PlexCardSession) => boolean,
  now: number,
): PlexCardState {
  const closing = state.sessions.filter(shouldClose);
  if (closing.length === 0) return state;
  let recent = state.recent;
  for (const session of closing) recent = pushRecent(recent, sessionRecent(session, session.watched ? 'watched' : 'stop', now));
  return { sessions: state.sessions.filter((s) => !closing.includes(s)), recent, changedAt: now };
}

const STATE_ICON: Record<PlexCardSessionState, string> = { play: '▶️', pause: '⏸️', buffer: '🔄' };
const RECENT_ICON: Record<PlexCardRecentKind, string> = { stop: '⏹️', watched: '✅', error: '⚠️', info: '▶️' };

function unixSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

function sessionLine(session: PlexCardSession): string {
  const who = session.user ? `**${truncate(session.user, 40)}** · ` : '';
  const where = session.player ? ` · ${truncate(session.player, 40)}` : '';
  const done = session.watched ? ' ✅' : '';
  return `${STATE_ICON[session.state]} ${who}${truncate(session.title, 120)}${where}${done} · seit <t:${unixSeconds(session.startedAt)}:R>`;
}

function recentLine(entry: PlexCardRecent): string {
  const who = entry.user ? `**${truncate(entry.user, 40)}** · ` : '';
  return `${RECENT_ICON[entry.kind]} ${who}${truncate(entry.title, 120)} · <t:${unixSeconds(entry.at)}:R>`;
}

/** Builds the card embed. Deterministic for a given state: no "now", relative times are Discord timestamps. */
export function buildPlexCardEmbed(state: PlexCardState): EmbedBuilder {
  const running = state.sessions.filter((s) => s.state !== 'pause');
  const embed = new EmbedBuilder()
    .setColor(running.length > 0 ? Colors.success : state.sessions.length > 0 ? Colors.warn : Colors.muted)
    .setAuthor({ name: 'Plex · Aktivität' })
    .setTitle(state.sessions.length === 0
      ? '🎬 Gerade läuft nichts'
      : `🎬 ${state.sessions.length === 1 ? '1 Wiedergabe' : `${state.sessions.length} Wiedergaben`}`)
    .setFooter({ text: 'MagguuBot · Plex-Aktivität (eine Karte, wird aktualisiert)', iconURL: FOOTER_ICONS.bot });
  if (state.changedAt > 0) embed.setTimestamp(new Date(state.changedAt));

  if (state.sessions.length > 0) {
    embed.setDescription(truncate(state.sessions.map(sessionLine).join('\n'), 3800));
  }
  if (state.recent.length > 0) {
    embed.addFields({ name: 'Zuletzt', value: truncate(state.recent.map(recentLine).join('\n'), 1000) });
  }
  if (state.sessions.length === 0 && state.recent.length === 0) {
    embed.setDescription('Sobald jemand etwas abspielt, erscheint es hier.');
  }
  return embed;
}

/** Content hash of an embed without its timestamp; equal hash = nothing visible changed. */
export function plexCardHash(embed: EmbedBuilder): string {
  const { timestamp: _timestamp, ...rest } = embed.toJSON();
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}
