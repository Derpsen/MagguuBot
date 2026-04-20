import { and, eq } from 'drizzle-orm';
import { config } from './config.js';
import { db } from './db/client.js';
import { botSettings } from './db/schema.js';

export type SettingKey =
  | 'starboardThreshold'
  | 'starboardEmoji'
  | 'automodInviteFilter';

interface SettingDef<T> {
  parse: (raw: string) => T;
  serialize: (value: T) => string;
  envValue: () => T;
}

const DEFS: { [K in SettingKey]: SettingDef<SettingValueMap[K]> } = {
  starboardThreshold: {
    parse: (raw) => {
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : 3;
    },
    serialize: String,
    envValue: () => config.STARBOARD_THRESHOLD,
  },
  starboardEmoji: {
    parse: (raw) => raw || '⭐',
    serialize: (v) => v,
    envValue: () => config.STARBOARD_EMOJI,
  },
  automodInviteFilter: {
    parse: (raw) => raw === 'true' || raw === '1',
    serialize: (v) => (v ? 'true' : 'false'),
    envValue: () => config.AUTOMOD_INVITE_FILTER,
  },
};

export interface SettingValueMap {
  starboardThreshold: number;
  starboardEmoji: string;
  automodInviteFilter: boolean;
}

export function getSetting<K extends SettingKey>(key: K): SettingValueMap[K] {
  const row = db
    .select()
    .from(botSettings)
    .where(and(eq(botSettings.guildId, config.DISCORD_GUILD_ID), eq(botSettings.key, key)))
    .get();
  const def = DEFS[key];
  if (row?.value) {
    return def.parse(row.value) as SettingValueMap[K];
  }
  return def.envValue() as SettingValueMap[K];
}

export function setSetting<K extends SettingKey>(key: K, value: SettingValueMap[K]): void {
  const def = DEFS[key];
  const raw = def.serialize(value as never);
  db.insert(botSettings)
    .values({ guildId: config.DISCORD_GUILD_ID, key, value: raw })
    .onConflictDoUpdate({
      target: [botSettings.guildId, botSettings.key],
      set: { value: raw, updatedAt: new Date() },
    })
    .run();
}

export function getAllSettings(): SettingValueMap {
  return {
    starboardThreshold: getSetting('starboardThreshold'),
    starboardEmoji: getSetting('starboardEmoji'),
    automodInviteFilter: getSetting('automodInviteFilter'),
  };
}
