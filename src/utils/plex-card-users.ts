import { createHash } from 'node:crypto';
import { clipPlexText, normPlexText, PLEX_CARD_MAX_USER } from './plex-card.js';

/**
 * Who gets a Plex card and under which name. Pure: the env strings are parsed here, the caller
 * (discord/plex-card.ts) hands in the current config values.
 */

export interface PlexCardUserConfig {
  /** normalized Plex name → display name */
  aliases: Map<string, string>;
  /** normalized Plex name or alias → no card at all */
  exclude: Set<string>;
}

export interface PlexCardUser {
  /** Identity of the card (normalized display name). */
  key: string;
  /** Escaped later by the renderer; clipped and single-line here. */
  name: string;
}

/** Upper bound of cards per channel: a stray webhook flood cannot spam the channel. */
export const PLEX_CARD_MAX_USERS = 25;

/** `{"plexname":"Alias"}` or `plexname=Alias,other=Alias2`; malformed input yields no aliases. */
export function parsePlexCardAliases(raw: string | undefined | null): Map<string, string> {
  const out = new Map<string, string>();
  const text = (raw ?? '').trim();
  if (!text) return out;
  const add = (from: unknown, to: unknown): void => {
    if (typeof from !== 'string' || typeof to !== 'string') return;
    const key = normPlexText(clipPlexText(from, PLEX_CARD_MAX_USER));
    const alias = clipPlexText(to, PLEX_CARD_MAX_USER);
    if (key && alias) out.set(key, alias);
  };
  if (text.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [from, to] of Object.entries(parsed)) add(from, to);
      }
    } catch {
      // malformed JSON: no aliases rather than a crash at the first webhook
    }
    return out;
  }
  for (const part of text.split(',')) {
    const at = part.indexOf('=');
    if (at > 0) add(part.slice(0, at), part.slice(at + 1));
  }
  return out;
}

export function parsePlexCardExclude(raw: string | undefined | null): Set<string> {
  const out = new Set<string>();
  for (const part of (raw ?? '').split(',')) {
    const key = normPlexText(clipPlexText(part, PLEX_CARD_MAX_USER));
    if (key) out.add(key);
  }
  return out;
}

export function parsePlexCardUserConfig(aliases: string | undefined, exclude: string | undefined): PlexCardUserConfig {
  return { aliases: parsePlexCardAliases(aliases), exclude: parsePlexCardExclude(exclude) };
}

/** Maps the raw Plex user name of a webhook to its card identity; null = no card (anonymous or excluded). */
export function resolvePlexCardUser(raw: string | undefined | null, cfg: PlexCardUserConfig): PlexCardUser | null {
  const plexName = clipPlexText(raw, PLEX_CARD_MAX_USER);
  const lookup = normPlexText(plexName);
  if (!lookup || cfg.exclude.has(lookup)) return null;
  const name = cfg.aliases.get(lookup) ?? plexName;
  const key = normPlexText(name);
  if (!key || cfg.exclude.has(key)) return null;
  return { key, name };
}

/** Short stable tag for logs: no user name or id leaves the process, but cards stay distinguishable. */
export function plexCardTag(userKey: string): string {
  return createHash('sha256').update(userKey).digest('hex').slice(0, 8);
}
