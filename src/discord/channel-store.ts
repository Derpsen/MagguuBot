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
  | 'health'
  | 'welcome'
  | 'auditLog'
  | 'modLog'
  | 'github'
  | 'starboard';

const FALLBACK_ENV: Record<ChannelKey, string | undefined> = {
  grabs: config.DISCORD_CHANNEL_GRABS,
  imports: config.DISCORD_CHANNEL_IMPORTS,
  failures: config.DISCORD_CHANNEL_FAILURES,
  requests: config.DISCORD_CHANNEL_REQUESTS,
  approvals: config.DISCORD_CHANNEL_APPROVALS,
  newOnPlex: config.DISCORD_CHANNEL_NEW_ON_PLEX,
  health: config.DISCORD_CHANNEL_HEALTH,
  welcome: config.DISCORD_CHANNEL_WELCOME,
  auditLog: config.DISCORD_CHANNEL_AUDIT_LOG,
  modLog: config.DISCORD_CHANNEL_MOD_LOG,
  github: config.DISCORD_CHANNEL_GITHUB,
  starboard: config.DISCORD_CHANNEL_STARBOARD,
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
