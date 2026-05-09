import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type GuildMember,
} from 'discord.js';
import { Colors } from './colors.js';
import { getChannel } from '../discord/channel-store.js';

interface BuildArgs {
  member: GuildMember;
  isReturning: boolean;
  accountAgeDays: number;
}

export function buildWelcomeChannelEmbed(args: BuildArgs): EmbedBuilder {
  const { member, isReturning, accountAgeDays } = args;
  const guild = member.guild;
  const memberCount = guild.memberCount;

  const rulesId = getChannel('faq');
  const requestsId = getChannel('requests');

  const heroLine = isReturning
    ? `**Welcome back, ${member.toString()}!** Schön dass du wieder hier bist.`
    : `**Welcome, ${member.toString()}!** Schön dass du da bist.`;

  const e = new EmbedBuilder()
    .setColor(isReturning ? Colors.brand : 0x5865f2)
    .setTitle(`🎉 Member #${memberCount}`)
    .setDescription(
      [
        heroLine,
        '',
        `Du bist jetzt Teil von **${guild.name}** — einem privaten Plex- & Community-Server.`,
        '',
        '**🚀 In 3 Schritten startklar:**',
        '`1.` Klick unten auf **deine Interessen** — schaltet dir die richtigen Channels frei',
        '`2.` Hol dir Ping-Rollen im **🎭・rollen** Channel (Film/Serie/4K/WoW…)',
        requestsId
          ? `\`3.\` Frag einen Admin nach der **Plex-User Rolle** für Zugriff auf <#${requestsId}>`
          : '`3.` Frag einen Admin nach der **Plex-User Rolle** für Plex-Zugriff',
      ].join('\n'),
    )
    .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
    .setTimestamp(new Date())
    .setFooter({ text: `${guild.name}  ·  Member #${memberCount}` });

  const fields: { name: string; value: string; inline: boolean }[] = [
    {
      name: '👤 Account-Alter',
      value: formatAge(accountAgeDays),
      inline: true,
    },
    {
      name: '📅 Joined',
      value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
      inline: true,
    },
    {
      name: '🧑‍🤝‍🧑 Members',
      value: `**${memberCount}**`,
      inline: true,
    },
  ];
  if (rulesId) {
    fields.push({
      name: '📜 Erste Schritte',
      value: `Lies die FAQ in <#${rulesId}> und stell dich kurz vor.`,
      inline: false,
    });
  }
  e.addFields(fields);

  return e;
}

export function buildWelcomeOnboardingButtons(): ActionRowBuilder<ButtonBuilder>[] {
  const interestRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('role:toggle:Plex-Fan')
      .setEmoji('🎬')
      .setLabel('Plex-Fan')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('role:toggle:WoW-Fan')
      .setEmoji('🎮')
      .setLabel('WoW-Fan')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('role:toggle:MagguuUI')
      .setEmoji('🎨')
      .setLabel('MagguuUI')
      .setStyle(ButtonStyle.Primary),
  );

  const pingRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('role:toggle:ping-movies')
      .setEmoji('🎬')
      .setLabel('Film-Pings')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('role:toggle:ping-series')
      .setEmoji('📺')
      .setLabel('Serien-Pings')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('role:toggle:ping-announcements')
      .setEmoji('📢')
      .setLabel('Announcements')
      .setStyle(ButtonStyle.Secondary),
  );

  return [interestRow, pingRow];
}

export function buildWelcomeDmEmbed(member: GuildMember, isReturning: boolean): EmbedBuilder {
  const guild = member.guild;
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({
      name: guild.name,
      iconURL: guild.iconURL({ extension: 'png', size: 128 }) ?? undefined,
    })
    .setTitle(isReturning ? `Welcome back auf ${guild.name}! 👋` : `Willkommen auf ${guild.name}! 🎉`)
    .setDescription(
      [
        isReturning
          ? `Schön dass du zurück bist, ${member.user.displayName}.`
          : `Hey ${member.user.displayName}, schön dass du da bist.`,
        '',
        '**🎯 Direkt von hier aus starten:**',
        'Klick die Buttons unten — die schalten Channels für dich frei. Toggle jederzeit, du kannst nichts kaputt machen.',
        '',
        '**🎬 Plex-Fan** → MEDIA + DOWNLOADS Channels sichtbar',
        '**🎮 WoW-Fan** → blue-tracker, WoW-News',
        '**🎨 MagguuUI** → addon-updates, FAQ',
        '',
        '_Nicht alles auf einmal? Du kannst sie auch im Server unter **🎭・rollen** holen._',
      ].join('\n'),
    )
    .addFields(
      {
        name: '📌 Erste Schritte',
        value: '• Lies die Regeln in **#📜・regeln**\n• Sag Hi in **#💬・chat**\n• Schreib `/help` für alle Commands',
        inline: false,
      },
      {
        name: '🔌 Plex-Zugriff',
        value: 'Brauchst du Plex-Streaming? Frag einen Admin nach der **Plex-User** Rolle.',
        inline: false,
      },
    )
    .setFooter({ text: `${guild.name}  ·  diese DM kommt nur einmal` })
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
