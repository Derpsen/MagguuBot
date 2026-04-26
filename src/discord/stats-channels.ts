import { ChannelType, type VoiceChannel } from 'discord.js';
import { config } from '../config.js';
import { getActivePlexStreamCount } from '../services/tautulli.js';
import { logger } from '../utils/logger.js';
import { getClient } from './client.js';

interface StatsTarget {
  prefix: string;
  compute: (guild: import('discord.js').Guild) => string | Promise<string>;
}

export const STATS_CHANNEL_PREFIXES = {
  members: '👥 Mitglieder: ',
  boosts: '📈 Boosts: ',
  inVoice: '🎙 In Voice: ',
  uptime: '🤖 Bot-Uptime: ',
  plexStreams: '🎬 Plex: ',
} as const;

const TARGETS: StatsTarget[] = [
  { prefix: STATS_CHANNEL_PREFIXES.members, compute: (g) => String(g.memberCount) },
  { prefix: STATS_CHANNEL_PREFIXES.boosts, compute: (g) => String(g.premiumSubscriptionCount ?? 0) },
  {
    prefix: STATS_CHANNEL_PREFIXES.inVoice,
    compute: (g) => {
      const inVoice = g.voiceStates.cache.filter((s) => s.channelId !== null && !s.member?.user.bot).size;
      return String(inVoice);
    },
  },
  {
    prefix: STATS_CHANNEL_PREFIXES.uptime,
    compute: () => {
      const s = Math.floor(process.uptime());
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      return d > 0 ? `${d}d ${h}h` : `${h}h`;
    },
  },
  {
    prefix: STATS_CHANNEL_PREFIXES.plexStreams,
    compute: async () => {
      const count = await getActivePlexStreamCount();
      return count === null ? '—' : String(count);
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
    const value = await target.compute(guild);
    const newName = `${target.prefix}${value}`;
    if (channel.name === newName) continue;
    try {
      await channel.setName(newName, 'stats refresh');
    } catch (err) {
      logger.warn({ err, channel: channel.name }, 'stats channel rename failed');
    }
  }
}
