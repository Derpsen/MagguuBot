/**
 * Everything the bot itself points at that must survive a role clean-up: role ids and role NAMES stored in its
 * database / env (auto role, birthday role, giveaway role, role panels, ticket ping roles, Raider.IO tiers and the
 * roles it handed out), the layout roles it looks up by name, and every channel it posts to.
 */
import { ROLE, ROLES } from '../discord/server-layout.js';
import { RANK_RULES } from '../discord/xp-ranks.js';
import { collectStoredRefs, type SqliteLike } from '../utils/stale-ids.js';
import { SNOWFLAKE } from './roles-model.js';

export interface RoleRefs {
  /** role id → why the bot references it (source labels only). */
  ids: Map<string, string[]>;
  /** role name → why the bot looks it up by name. */
  names: Map<string, string[]>;
  /** Channels the bot posts to (channel_config + other stored channel refs). */
  channelIds: Set<string>;
}

export function emptyRefs(): RoleRefs {
  return { ids: new Map(), names: new Map(), channelIds: new Set() };
}

function addTo(map: Map<string, string[]>, key: string, reason: string): void {
  const list = map.get(key) ?? [];
  if (!list.includes(reason)) list.push(reason);
  map.set(key, list);
}

/** Layout roles are looked up by name all over the bot (buttons, auto role, XP ranks, ticket pings). */
export function addLayoutNameRefs(refs: RoleRefs): void {
  for (const r of ROLES) {
    addTo(refs.names, r.name, 'Server-Layout');
    for (const old of r.oldNames ?? []) addTo(refs.names, old, 'Server-Layout (alter Name)');
  }
  for (const name of Object.values(ROLE)) addTo(refs.names, name, 'Rollen-Konstante');
  for (const rule of RANK_RULES) {
    addTo(refs.names, rule.roleName, 'XP-Rang');
    for (const n of rule.removeRoles ?? []) addTo(refs.names, n, 'XP-Rang');
  }
}

export interface RefInputs {
  db: SqliteLike;
  guildId: string;
  /** Parsed settings (`getAllSettings()`), used for the id settings (autoRoleId, birthdayRoleId …). */
  settings: Readonly<Record<string, unknown>>;
  /** AUTO_ROLE_ID env. */
  autoRoleEnv?: string | undefined;
  /** RIO_ROLE_THRESHOLDS env ("minScore=roleId,…" or JSON). */
  rioThresholdsEnv?: string | undefined;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function collectRoleRefs(input: RefInputs): RoleRefs {
  const refs = emptyRefs();
  addLayoutNameRefs(refs);
  const { db, guildId } = input;

  for (const r of safe(() => collectStoredRefs(db, guildId, input.settings), [])) {
    if (r.kind === 'role') addTo(refs.ids, r.id, r.source);
    else if (r.kind === 'roleName') addTo(refs.names, r.id, r.source);
    else refs.channelIds.add(r.id);
  }
  // Every snowflake in bot_settings (covers /rio-config tiers, panel settings and anything added later).
  for (const row of safe(() => db.prepare('SELECT key, value FROM bot_settings WHERE guild_id = ?').all(guildId) as Array<{ key: string; value: unknown }>, [])) {
    for (const id of String(row.value ?? '').match(/\d{17,20}/g) ?? []) addTo(refs.ids, id, `bot_settings.${row.key}`);
  }
  for (const row of safe(() => db.prepare('SELECT DISTINCT last_role_id AS id FROM rio_link WHERE guild_id = ? AND last_role_id IS NOT NULL').all(guildId) as Array<{ id: string }>, [])) {
    if (SNOWFLAKE.test(row.id)) addTo(refs.ids, row.id, 'rio_link (vergebene Score-Rolle)');
  }
  if (input.autoRoleEnv && SNOWFLAKE.test(input.autoRoleEnv)) addTo(refs.ids, input.autoRoleEnv, 'AUTO_ROLE_ID');
  for (const id of (input.rioThresholdsEnv ?? '').match(/\d{17,20}/g) ?? []) addTo(refs.ids, id, 'RIO_ROLE_THRESHOLDS');
  for (const row of safe(() => db.prepare('SELECT channel_id FROM channel_config WHERE guild_id = ?').all(guildId) as Array<{ channel_id: string }>, [])) {
    if (SNOWFLAKE.test(row.channel_id)) refs.channelIds.add(row.channel_id);
  }
  return refs;
}
