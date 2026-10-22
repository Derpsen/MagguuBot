import {
  EmbedBuilder,
  type ActionRowBuilder,
  type ButtonBuilder,
  type GuildMember,
} from 'discord.js';
import { Colors } from './colors.js';
import { buildRolePickerButtons } from './welcome.js';
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
    ? `**Welcome back, ${member.toString()}!** Schön, dass du wieder hier bist.`
    : `**Willkommen, ${member.toString()}!** Schön, dass du da bist.`;

  const e = new EmbedBuilder()
    .setColor(Colors.brand)
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

/** Same single role-button set as the welcome channel panel. */
export function buildWelcomeOnboardingButtons(): ActionRowBuilder<ButtonBuilder>[] {
  return buildRolePickerButtons();
}

export function buildWelcomeDmEmbed(member: GuildMember, isReturning: boolean): EmbedBuilder {
  const guild = member.guild;
  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setAuthor({
      name: guild.name,
      iconURL: guild.iconURL({ extension: 'png', size: 128 }) ?? undefined,
    })
    .setTitle(isReturning ? `Welcome back auf ${guild.name}! 👋` : `Willkommen auf ${guild.name}! 🎉`)
    .setDescription(
      [
        isReturning
          ? `Schön, dass du zurück bist, ${member.user.displayName}.`
          : `Hallo ${member.user.displayName}, schön, dass du da bist.`,
        '',
        '**Ping-Rollen:** Die Buttons unten schalten Benachrichtigungen an oder aus. Du kannst das jederzeit ändern.',
        '',
        '_Die gleichen Buttons findest du im Server unter **👋・willkommen**._',
      ].join('\n'),
    )
    .addFields(
      {
        name: '📌 Erste Schritte',
        value: '• Lies die Regeln in **#👋・willkommen**\n• Melde dich kurz in **#💬・chat**\n• `/help` zeigt alle Commands',
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
