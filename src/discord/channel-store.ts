import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { channelConfig } from '../db/schema.js';

export type ChannelKey =
  | 'grabs'
  | 'imports'
  | 'failures'
  | 'requests'
  | 'approvals'
  | 'newOnPlex'
  | 'plexActivity'
  | 'maintainerr'
  | 'health'
  | 'welcome'
  | 'auditLog'
  | 'modLog'
  | 'github'
  | 'starboard'
  | 'blueTracker'
  | 'addonUpdates'
  | 'faq'
  | 'suggestions';

const FALLBACK_ENV: Record<ChannelKey, string | undefined> = {
  grabs: config.DISCORD_CHANNEL_GRABS,
  imports: config.DISCORD_CHANNEL_IMPORTS,
  failures: config.DISCORD_CHANNEL_FAILURES,
  requests: config.DISCORD_CHANNEL_REQUESTS,
  approvals: config.DISCORD_CHANNEL_APPROVALS,
  newOnPlex: config.DISCORD_CHANNEL_NEW_ON_PLEX,
  plexActivity: config.DISCORD_CHANNEL_PLEX_ACTIVITY,
  maintainerr: config.DISCORD_CHANNEL_MAINTAINERR,
  health: config.DISCORD_CHANNEL_HEALTH,
  welcome: config.DISCORD_CHANNEL_WELCOME,
  auditLog: config.DISCORD_CHANNEL_AUDIT_LOG,
  modLog: config.DISCORD_CHANNEL_MOD_LOG,
  github: config.DISCORD_CHANNEL_GITHUB,
  starboard: config.DISCORD_CHANNEL_STARBOARD,
  blueTracker: config.DISCORD_CHANNEL_BLUE_TRACKER,
  addonUpdates: config.DISCORD_CHANNEL_ADDON_UPDATES,
  faq: config.DISCORD_CHANNEL_FAQ,
  suggestions: undefined,
};

export function getChannel(key: ChannelKey): string | undefined {
  const row = db
    .select()
    .from(channelConfig)
    .where(and(eq(channelConfig.guildId, config.DISCORD_GUILD_ID), eq(channelConfig.key, key)))
    .get();
  if (row?.channelId) return row.channelId;
  return FALLBACK_ENV[key];
}

export function saveChannel(key: ChannelKey, channelId: string): void {
  db.insert(channelConfig)
    .values({ guildId: config.DISCORD_GUILD_ID, key, channelId })
    .onConflictDoUpdate({
      target: [channelConfig.guildId, channelConfig.key],
      set: { channelId, updatedAt: new Date() },
    })
    .run();
}
