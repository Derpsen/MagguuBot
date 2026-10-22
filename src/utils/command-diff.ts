/**
 * Compare registered slash commands (GET applications/{app}/guilds/{guild}/commands)
 * with the local command bodies. Used by startup registration and the acceptance CLI.
 * Pure: no Discord client, no config.
 */

export interface CommandShape {
  name: string;
  description?: string;
  default_member_permissions?: string | null;
  options?: Array<{ type: number; name: string; description?: string; options?: CommandShape['options'] }>;
}

/** Services that were removed from the stack; no command may still mention them. */
export const REMOVED_SERVICES = /\b(maintainerr|overseerr|jellyseerr|ombi|tdarr|lidarr|readarr|bazarr|uptime[ -]?kuma|kuma|twitch|notifiarr)\b/i;

export interface CommandDiff {
  missing: string[];
  extra: string[];
  /** `expected`/`actual` are set for description drift so reports can show both texts. */
  changed: Array<{ name: string; what: string; expected?: string; actual?: string }>;
  removedService: string[];
  global: string[];
}

/**
 * Discord stores descriptions normalised: variation selectors (U+FE0E/U+FE0F) are dropped
 * and surrounding whitespace trimmed. Compare in that form so an emoji like 🗄️ does not
 * show as permanent drift.
 */
export function normText(s: string | null | undefined): string {
  return (s ?? '').normalize('NFC').replace(/[\uFE0E\uFE0F]/g, '').replace(/\s+/g, ' ').trim();
}

function optionTree(options: CommandShape['options']): string {
  return JSON.stringify((options ?? []).map((o) => [o.type, o.name, normText(o.description), optionTree(o.options)]));
}

export function diffCommands(registered: readonly CommandShape[], local: readonly CommandShape[], global: readonly CommandShape[] = []): CommandDiff {
  const reg = new Map(registered.map((c) => [c.name, c]));
  const loc = new Map(local.map((c) => [c.name, c]));
  const changed: CommandDiff['changed'] = [];
  for (const [name, l] of loc) {
    const r = reg.get(name);
    if (!r) continue;
    if (normText(r.description) !== normText(l.description)) {
      changed.push({ name, what: 'Beschreibung', expected: l.description ?? '', actual: r.description ?? '' });
    } else if ((r.default_member_permissions ?? null) !== (l.default_member_permissions ?? null)) changed.push({ name, what: 'Rechte' });
    else if (optionTree(r.options) !== optionTree(l.options)) changed.push({ name, what: 'Optionen' });
  }
  const mentionsRemoved = (c: CommandShape): boolean =>
    REMOVED_SERVICES.test(c.name) || REMOVED_SERVICES.test(c.description ?? '') || REMOVED_SERVICES.test(optionTree(c.options));
  return {
    missing: [...loc.keys()].filter((n) => !reg.has(n)).sort(),
    extra: [...reg.keys()].filter((n) => !loc.has(n)).sort(),
    changed,
    removedService: [...new Set([...registered, ...local, ...global].filter(mentionsRemoved).map((c) => c.name))].sort(),
    global: global.map((c) => c.name).sort(),
  };
}

/** Registered guild commands match the code (names, descriptions, permissions, options). */
export function commandsInSync(d: CommandDiff): boolean {
  return d.missing.length === 0 && d.extra.length === 0 && d.changed.length === 0;
}
