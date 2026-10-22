/**
 * Stale-ID scan: every channel / category / role id the bot has stored (channel
 * keys, panel settings, live config rows) must exist in the guild. Pure apart
 * from the read-only SQLite collector. Used by /doctor, the daily self-check and
 * `dist/rollout/discord-acceptance.js`.
 */
import { roleNameCandidates } from '../discord/server-layout.js';

export type StoredKind = 'channel' | 'category' | 'role' | 'roleName';

export interface StoredRef {
  /** Where it is stored, e.g. `channel_config.grabs` or `bot_settings.birthdayChannelId`. */
  source: string;
  kind: StoredKind;
  /** Snowflake (or the role name for `roleName`). */
  id: string;
}

export interface GuildIndex {
  channels: ReadonlyMap<string, { name: string; type: number; parentId: string | null }>;
  roleIds: ReadonlySet<string>;
  roleNames: ReadonlySet<string>;
  /** 🗄️ ARCHIV category id; channels under it count as gone for routing targets. */
  archiveId: string | null;
}

export type StaleProblem = 'missing' | 'archived' | 'wrong-type';

export interface StaleRef extends StoredRef {
  problem: StaleProblem;
  name?: string;
}

const CATEGORY = 4;

/** Sources whose target must be an active (non-archived) channel. History rows may point anywhere. */
const ACTIVE_REQUIRED = /^(channel_config|live_panels|welcome_messages|sticky_messages|rss_feeds|bot_settings)\b/;

export function findStaleRefs(refs: readonly StoredRef[], guild: GuildIndex): StaleRef[] {
  const out: StaleRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const dedupe = `${ref.source}|${ref.kind}|${ref.id}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    if (ref.kind === 'role') {
      if (!guild.roleIds.has(ref.id)) out.push({ ...ref, problem: 'missing' });
      continue;
    }
    if (ref.kind === 'roleName') {
      if (!roleNameCandidates(ref.id).some((n) => guild.roleNames.has(n))) out.push({ ...ref, problem: 'missing' });
      continue;
    }
    const ch = guild.channels.get(ref.id);
    if (!ch) {
      out.push({ ...ref, problem: 'missing' });
      continue;
    }
    if ((ref.kind === 'category') !== (ch.type === CATEGORY)) {
      out.push({ ...ref, problem: 'wrong-type', name: ch.name });
      continue;
    }
    if (ref.kind === 'channel' && guild.archiveId && ch.parentId === guild.archiveId && ACTIVE_REQUIRED.test(ref.source)) {
      out.push({ ...ref, problem: 'archived', name: ch.name });
    }
  }
  return out;
}

export function describeStaleRef(ref: StaleRef): string {
  const what = ref.kind === 'roleName' ? `Rolle „${ref.id}“` : `${ref.kind === 'role' ? 'Rolle' : ref.kind === 'category' ? 'Kategorie' : 'Kanal'} ${ref.id}`;
  switch (ref.problem) {
    case 'missing': return `${ref.source}: ${what} existiert nicht`;
    case 'archived': return `${ref.source}: ${what} (#${ref.name}) liegt im Archiv`;
    case 'wrong-type': return `${ref.source}: ${what} (#${ref.name}) hat den falschen Typ`;
  }
}

// ─── Collector (read-only SQLite) ────────────────────────────────────────

export interface SqliteLike {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
}

interface RowSpec {
  table: string;
  columns: Array<{ column: string; kind: StoredKind }>;
  /** Only "live" rows (open tickets, enabled feeds …). Ignored if a referenced column is missing. */
  where?: string;
  label?: string;
}

const ROW_SPECS: readonly RowSpec[] = [
  { table: 'live_panels', columns: [{ column: 'channel_id', kind: 'channel' }], where: 'enabled = 1', label: 'kind' },
  { table: 'welcome_messages', columns: [{ column: 'channel_id', kind: 'channel' }], label: 'plan_name' },
  { table: 'sticky_messages', columns: [{ column: 'channel_id', kind: 'channel' }] },
  { table: 'rss_feeds', columns: [{ column: 'channel_id', kind: 'channel' }], where: 'enabled = 1', label: 'name' },
  { table: 'role_panels', columns: [{ column: 'channel_id', kind: 'channel' }], label: 'title' },
  { table: 'countdowns', columns: [{ column: 'channel_id', kind: 'channel' }], where: 'finished = 0', label: 'title' },
  { table: 'scheduled_announcements', columns: [{ column: 'channel_id', kind: 'channel' }], where: '(fired = 0 OR recurrence IS NOT NULL)', label: 'title' },
  { table: 'giveaways', columns: [{ column: 'channel_id', kind: 'channel' }, { column: 'required_role_id', kind: 'role' }], where: 'ended = 0', label: 'prize' },
  { table: 'tickets', columns: [{ column: 'channel_id', kind: 'channel' }], where: 'closed_at IS NULL', label: 'id' },
  { table: 'movie_nights', columns: [{ column: 'channel_id', kind: 'channel' }], where: 'closed_at IS NULL', label: 'title' },
  { table: 'jtc_rooms', columns: [{ column: 'channel_id', kind: 'channel' }, { column: 'text_channel_id', kind: 'channel' }] },
];

const SNOWFLAKE = /^\d{17,20}$/;
const ident = (s: string): string => `"${s.replace(/"/g, '""')}"`;

function columnsOf(db: SqliteLike, table: string): Set<string> {
  try {
    return new Set((db.prepare(`PRAGMA table_info(${ident(table)})`).all() as Array<{ name: string }>).map((c) => c.name));
  } catch {
    return new Set();
  }
}

/** Setting keys that hold ids (bot_settings, already parsed by getSetting). */
export const ID_SETTINGS: ReadonlyArray<{ key: string; kind: StoredKind }> = [
  { key: 'jtcChannelId', kind: 'channel' },
  { key: 'jtcCategoryId', kind: 'category' },
  { key: 'birthdayChannelId', kind: 'channel' },
  { key: 'autoRoleId', kind: 'role' },
  { key: 'birthdayRoleId', kind: 'role' },
];

export function collectStoredRefs(
  db: SqliteLike,
  guildId: string,
  settings: Readonly<Record<string, unknown>>,
): StoredRef[] {
  const refs: StoredRef[] = [];
  const add = (source: string, kind: StoredKind, value: unknown): void => {
    if (typeof value !== 'string' || !value) return;
    if (kind === 'roleName' || SNOWFLAKE.test(value)) refs.push({ source, kind, id: value });
  };

  const cc = columnsOf(db, 'channel_config');
  if (cc.has('key') && cc.has('channel_id')) {
    for (const r of db.prepare('SELECT key, channel_id FROM channel_config WHERE guild_id = ?').all(guildId) as Array<{ key: string; channel_id: string }>) {
      add(`channel_config.${r.key}`, 'channel', r.channel_id);
    }
  }
  for (const { key, kind } of ID_SETTINGS) add(`bot_settings.${key}`, kind, settings[key]);

  for (const spec of ROW_SPECS) {
    const cols = columnsOf(db, spec.table);
    const present = spec.columns.filter((c) => cols.has(c.column));
    if (!present.length) continue;
    const whereCols = (spec.where?.match(/[a-z_]+(?= (?:=|IS))/g) ?? []);
    const filters = [cols.has('guild_id') ? 'guild_id = ?' : null, spec.where && whereCols.every((c) => cols.has(c)) ? spec.where : null].filter(Boolean);
    const label = spec.label && cols.has(spec.label) ? `, ${ident(spec.label)} AS label` : '';
    const sql = `SELECT ${present.map((c) => ident(c.column)).join(', ')}${label} FROM ${ident(spec.table)}${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''}`;
    const rows = db.prepare(sql).all(...(cols.has('guild_id') ? [guildId] : [])) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const tag = row.label !== undefined && row.label !== null ? `[${String(row.label).slice(0, 40)}]` : '';
      for (const c of present) add(`${spec.table}${tag}.${c.column}`, c.kind, row[c.column]);
    }
  }

  // Role panels store their role ids in a JSON column.
  const rp = columnsOf(db, 'role_panels');
  if (rp.has('roles')) {
    for (const r of db.prepare(`SELECT roles FROM role_panels${rp.has('guild_id') ? ' WHERE guild_id = ?' : ''}`).all(...(rp.has('guild_id') ? [guildId] : [])) as Array<{ roles: string | null }>) {
      for (const id of String(r.roles ?? '').match(/\d{17,20}/g) ?? []) add('role_panels.roles', 'role', id);
    }
  }
  // Ticket categories ping roles by NAME.
  const tc = columnsOf(db, 'ticket_categories');
  if (tc.has('ping_roles')) {
    for (const r of db.prepare(`SELECT key, ping_roles FROM ticket_categories${tc.has('guild_id') ? ' WHERE guild_id = ?' : ''}`).all(...(tc.has('guild_id') ? [guildId] : [])) as Array<{ key: string; ping_roles: string | null }>) {
      for (const name of parseNameList(r.ping_roles)) add(`ticket_categories[${r.key}].ping_roles`, 'roleName', name);
    }
  }
  return refs;
}

function parseNameList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch { /* comma list */ }
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
