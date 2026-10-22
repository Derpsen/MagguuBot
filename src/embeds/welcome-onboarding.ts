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

interface BuildArgs {
  member: GuildMember;
  isReturning: boolean;
  accountAgeDays: number;
}

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

export function buildWelcomeChannelEmbed(args: BuildArgs): EmbedBuilder {
  const { member, isReturning, accountAgeDays } = args;
  const guild = member.guild;
  const memberCount = guild.memberCount;
  const welcome = liveChannelMention(guild, 'welcome', CHANNEL.welcome);
  const requests = liveChannelMention(guild, 'requests', CHANNEL.requests);

  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(isReturning ? '👋 Willkommen zurück' : '👋 Willkommen')
    .setDescription(
      [
        isReturning
          ? `Schön, dass du wieder da bist, ${member.toString()}.`
          : `Schön, dass du da bist, ${member.toString()}.`,
        '',
        '**So geht es los**',
        `1. Regeln in ${welcome} lesen`,
        '2. Unten Ping-Rollen wählen (jederzeit änderbar)',
        `3. Plex-Zugang? Admin fragen, dann Wünsche in ${requests}`,
      ].join('\n'),
    )
    .addFields(
      { name: 'Account', value: formatAge(accountAgeDays), inline: true },
      { name: 'Beigetreten', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
      { name: 'Mitglied', value: `#${memberCount}`, inline: true },
    )
    .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
    .setFooter({ text: CARD_FOOTER_TEXT, iconURL: WEBSITE_LOGO_URL })
    .setTimestamp(new Date());
}

/** Same single role-button set as the welcome channel card. */
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

function formatAge(days: number): string {
  if (days < 1) return '⚠️ heute';
  if (days < 7) return `⚠️ ${Math.floor(days)} Tage`;
  if (days < 30) return `${Math.floor(days)} Tage`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} ${months === 1 ? 'Monat' : 'Monate'}`;
  }
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? 'Jahr' : 'Jahre'}`;
}
