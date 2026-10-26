import {
  EmbedBuilder,
  type ActionRowBuilder,
  type ButtonBuilder,
  type Guild,
  type GuildMember,
} from 'discord.js';
import { BRAND_COLOR, WEBSITE_LOGO_URL } from './colors.js';
import { buildRoleButtons, CARD_FOOTER_TEXT } from './cards.js';
import { getChannel } from '../discord/channel-store.js';
import type { ChannelKey } from '../discord/channel-catalog.js';
import { ARCHIVE_CATEGORY_NAME, CHANNEL } from '../discord/server-layout.js';

/**
 * `<#id>` only when the channel still exists outside the archive (configured key first,
 * then by layout name); otherwise the bold name, never a dead mention (`#unbekannt`).
 */
export function liveChannelMention(guild: Guild, key: ChannelKey | null, name: string): string {
  const live = (id: string | undefined): string | undefined => {
    const channel = id ? guild.channels.cache.get(id) : undefined;
    if (!channel) return undefined;
    const parentName = 'parent' in channel ? channel.parent?.name : undefined;
    return parentName === ARCHIVE_CATEGORY_NAME ? undefined : channel.id;
  };
  const id = live(key ? getChannel(key) : undefined)
    ?? live(guild.channels.cache.find((channel) => channel.name === name)?.id);
  return id ? `<#${id}>` : `**#${name}**`;
}

/** Same single role-button set as the pinned roles card in the welcome channel (the join DM carries it). */
export function buildWelcomeOnboardingButtons(): ActionRowBuilder<ButtonBuilder>[] {
  return buildRoleButtons();
}

export function buildWelcomeDmEmbed(member: GuildMember, isReturning: boolean): EmbedBuilder {
  const guild = member.guild;
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: guild.name, iconURL: guild.iconURL({ extension: 'png', size: 128 }) ?? undefined })
    .setTitle(isReturning ? `Willkommen zurück auf ${guild.name}` : `Willkommen auf ${guild.name}`)
    .setDescription(
      [
        isReturning
          ? `Schön, dass du zurück bist, ${member.user.displayName}.`
          : `Hallo ${member.user.displayName}, schön, dass du da bist.`,
        '',
        'Die Buttons unten schalten Ping-Rollen an oder aus. Die gleichen Buttons findest du im Server.',
        '',
        `• Regeln: ${liveChannelMention(guild, 'welcome', CHANNEL.welcome)}`,
        `• Quatschen: ${liveChannelMention(guild, null, CHANNEL.chat)}`,
        '• Plex-Zugang: einen Admin fragen',
      ].join('\n'),
    )
    .setFooter({ text: `${CARD_FOOTER_TEXT} · diese DM kommt nur einmal`, iconURL: WEBSITE_LOGO_URL })
    .setTimestamp(new Date());
}
