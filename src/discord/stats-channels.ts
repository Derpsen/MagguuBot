import { ChannelType, type VoiceChannel } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { getClient } from './client.js';

interface StatsTarget {
  prefix: string;
  compute: (guild: import('discord.js').Guild) => string;
}

const TARGETS: StatsTarget[] = [
  { prefix: '👥 Mitglieder: ', compute: (g) => String(g.memberCount) },
  { prefix: '📈 Boosts: ', compute: (g) => String(g.premiumSubscriptionCount ?? 0) },
  {
    prefix: '🤖 Bot-Uptime: ',
    compute: () => {
      const s = Math.floor(process.uptime());
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      return d > 0 ? `${d}d ${h}h` : `${h}h`;
    },
  },
];

export async function updateStatsChannels(): Promise<void> {
  const client = getClient();
  const guild = await client.guilds.fetch(config.DISCORD_GUILD_ID).catch(() => null);
  if (!guild) return;

  const voiceChannels = guild.channels.cache.filter(
    (c): c is VoiceChannel => c.type === ChannelType.GuildVoice,
  );

  for (const target of TARGETS) {
    const channel = voiceChannels.find((c) => c.name.startsWith(target.prefix));
    if (!channel) continue;
    const newName = `${target.prefix}${target.compute(guild)}`;
    if (channel.name === newName) continue;
    try {
      await channel.setName(newName, 'stats refresh');
    } catch (err) {
      logger.warn({ err, channel: channel.name }, 'stats channel rename failed');
    }
  }
}
