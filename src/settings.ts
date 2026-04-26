import { and, eq } from 'drizzle-orm';
import { config } from './config.js';
import { db } from './db/client.js';
import { botSettings } from './db/schema.js';

export type SettingKey =
  | 'starboardThreshold'
  | 'starboardEmoji'
  | 'automodInviteFilter'
  | 'automodCapsFilter'
  | 'automodCapsThreshold'
  | 'automodCapsMinLen'
  | 'automodMentionSpam'
  | 'automodMentionThreshold'
  | 'automodExternalLinkFilter'
  | 'automodBlockedPhrases'
  | 'autoRoleId'
  | 'aiModerationEnabled'
  | 'aiModerationThreshold'
  | 'welcomeDmTemplate';

export interface SettingValueMap {
  starboardThreshold: number;
  starboardEmoji: string;
  automodInviteFilter: boolean;
  automodCapsFilter: boolean;
  automodCapsThreshold: number;
  automodCapsMinLen: number;
  automodMentionSpam: boolean;
  automodMentionThreshold: number;
  automodExternalLinkFilter: boolean;
  automodBlockedPhrases: string;
  autoRoleId: string | null;
  aiModerationEnabled: boolean;
  aiModerationThreshold: number;
  welcomeDmTemplate: string;
}

interface SettingDef<T> {
  parse: (raw: string) => T;
  serialize: (value: T) => string;
  envValue: () => T;
}

const asBool = (raw: string): boolean => raw === 'true' || raw === '1';
const asInt = (fallback: number) => (raw: string): number => {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
};

const DEFS: { [K in SettingKey]: SettingDef<SettingValueMap[K]> } = {
  starboardThreshold: {
    parse: asInt(3),
    serialize: String,
    envValue: () => config.STARBOARD_THRESHOLD,
  },
  starboardEmoji: {
    parse: (raw) => raw || '⭐',
    serialize: (v) => v,
    envValue: () => config.STARBOARD_EMOJI,
  },
  automodInviteFilter: {
    parse: asBool,
    serialize: (v) => (v ? 'true' : 'false'),
    envValue: () => config.AUTOMOD_INVITE_FILTER,
  },
  automodCapsFilter: {
    parse: asBool,
    serialize: (v) => (v ? 'true' : 'false'),
    envValue: () => config.AUTOMOD_CAPS_FILTER,
  },
  automodCapsThreshold: {
    parse: asInt(70),
    serialize: String,
    envValue: () => config.AUTOMOD_CAPS_THRESHOLD,
  },
  automodCapsMinLen: {
    parse: asInt(10),
    serialize: String,
    envValue: () => config.AUTOMOD_CAPS_MIN_LEN,
  },
  automodMentionSpam: {
    parse: asBool,
    serialize: (v) => (v ? 'true' : 'false'),
    envValue: () => config.AUTOMOD_MENTION_SPAM,
  },
  automodMentionThreshold: {
    parse: asInt(5),
    serialize: String,
    envValue: () => config.AUTOMOD_MENTION_THRESHOLD,
  },
  automodExternalLinkFilter: {
    parse: asBool,
    serialize: (v) => (v ? 'true' : 'false'),
    envValue: () => config.AUTOMOD_EXTERNAL_LINK_FILTER,
  },
  automodBlockedPhrases: {
    parse: (raw) => raw,
    serialize: (v) => v,
    envValue: () => '',
  },
  autoRoleId: {
    parse: (raw) => (raw || null),
    serialize: (v) => v ?? '',
    envValue: () => config.AUTO_ROLE_ID ?? null,
  },
  aiModerationEnabled: {
    parse: asBool,
    serialize: (v) => (v ? 'true' : 'false'),
    envValue: () => false,
  },
  aiModerationThreshold: {
    parse: (raw) => {
      const n = Number.parseFloat(raw);
      return Number.isFinite(n) ? n : 0.7;
    },
    serialize: String,
    envValue: () => 0.7,
  },
  welcomeDmTemplate: {
    parse: (raw) => raw,
    serialize: (v) => v,
    envValue: () => '',
  },
};

export function getSetting<K extends SettingKey>(key: K): SettingValueMap[K] {
  const row = db
    .select()
    .from(botSettings)
    .where(and(eq(botSettings.guildId, config.DISCORD_GUILD_ID), eq(botSettings.key, key)))
    .get();
  const def = DEFS[key];
  if (row?.value !== undefined && row.value !== '') {
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
    automodCapsFilter: getSetting('automodCapsFilter'),
    automodCapsThreshold: getSetting('automodCapsThreshold'),
    automodCapsMinLen: getSetting('automodCapsMinLen'),
    automodMentionSpam: getSetting('automodMentionSpam'),
    automodMentionThreshold: getSetting('automodMentionThreshold'),
    automodExternalLinkFilter: getSetting('automodExternalLinkFilter'),
    automodBlockedPhrases: getSetting('automodBlockedPhrases'),
    autoRoleId: getSetting('autoRoleId'),
    aiModerationEnabled: getSetting('aiModerationEnabled'),
    aiModerationThreshold: getSetting('aiModerationThreshold'),
    welcomeDmTemplate: getSetting('welcomeDmTemplate'),
  };
}
