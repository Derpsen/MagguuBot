import { EmbedBuilder, type Guild, type TextChannel, type User } from 'discord.js';
import { Colors } from '../embeds/colors.js';
import { logger } from '../utils/logger.js';
import { getChannel } from './channel-store.js';

export type ModAction =
  | 'warn'
  | 'timeout'
  | 'untimeout'
  | 'kick'
  | 'ban'
  | 'unban'
  | 'purge'
  | 'automod';

interface ModLogInput {
  guild: Guild;
  action: ModAction;
  moderator: User;
  target?: User;
  reason?: string;
  extra?: { name: string; value: string; inline?: boolean }[];
}

const COLORS: Record<ModAction, number> = {
  warn: Colors.warn,
  timeout: Colors.warn,
  untimeout: Colors.info,
  kick: Colors.danger,
  ban: Colors.danger,
  unban: Colors.success,
  purge: Colors.muted,
  automod: Colors.warn,
};

const ICONS: Record<ModAction, string> = {
  warn: '⚠️',
  timeout: '🔇',
  untimeout: '🔊',
  kick: '👢',
  ban: '🔨',
  unban: '🕊️',
  purge: '🧹',
  automod: '🤖',
};

export async function postModLog(i: ModLogInput): Promise<void> {
  const channelId = getChannel('modLog');
  if (!channelId) return;

  try {
    const channel = await i.guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isSendable()) return;

    const embed = new EmbedBuilder()
      .setColor(COLORS[i.action])
      .setAuthor({
        name: `${ICONS[i.action]} ${i.action.toUpperCase()}`,
        iconURL: i.target?.displayAvatarURL(),
      })
      .setDescription(
        i.target
          ? `**Target:** ${i.target.toString()} (\`${i.target.tag}\` · ${i.target.id})`
          : `_(no target — e.g. purge)_`,
      )
      .addFields(
        { name: 'Moderator', value: `${i.moderator.toString()} (\`${i.moderator.tag}\`)`, inline: true },
        { name: 'Reason', value: i.reason ?? '_none provided_', inline: true },
      )
      .setTimestamp(new Date());

    if (i.extra?.length) embed.addFields(i.extra);

    await (channel as TextChannel).send({ embeds: [embed] });
  } catch (err) {
    logger.error({ err, action: i.action }, 'postModLog failed');
  }
}
