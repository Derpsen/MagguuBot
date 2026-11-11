import { ChannelType } from 'discord.js';
import { config } from '../../config.js';
import { getClient } from '../../discord/client-ref.js';

export async function isConfiguredGuildTextChannel(channelId: string): Promise<boolean> {
  const guild = await getClient().guilds.fetch(config.DISCORD_GUILD_ID).catch(() => null);
  if (!guild) return false;
  const channel = guild.channels.cache.get(channelId)
    ?? await guild.channels.fetch(channelId).catch(() => null);
  return channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement;
}

export async function resolveUsername(userId: string): Promise<string> {
  try {
    const client = getClient();
    const user = await client.users.fetch(userId).catch(() => null);
    return user?.username ?? userId;
  } catch {
    return userId;
  }
}
