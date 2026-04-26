import { AttachmentBuilder, EmbedBuilder, type GuildMember, type TextChannel } from 'discord.js';
import { renderWelcomeCard } from '../cards/welcome-card.js';
import { Colors } from '../../embeds/colors.js';
import { getSetting } from '../../settings.js';
import { logger } from '../../utils/logger.js';
import { getChannel } from '../channel-store.js';
import type { BotEvent } from './types.js';

async function applyAutoRole(member: GuildMember): Promise<void> {
  if (member.user.bot) return;

  const explicitId = getSetting('autoRoleId');
  if (explicitId) {
    const role = member.guild.roles.cache.get(explicitId);
    if (role) {
      await member.roles.add(role, 'auto-role on join');
      logger.info({ userId: member.id, roleId: explicitId, mode: 'explicit' }, 'auto-role applied');
      return;
    }
    logger.warn({ roleId: explicitId }, 'configured auto-role not found, falling back');
  }

  const newcomer = member.guild.roles.cache.find((r) => r.name === 'Newcomer');
  if (newcomer) {
    await member.roles.add(newcomer, 'auto-role (Newcomer fallback)');
    logger.info({ userId: member.id, mode: 'newcomer-fallback' }, 'auto-role applied');
  }
}

export const guildMemberAddEvent: BotEvent<'guildMemberAdd'> = {
  name: 'guildMemberAdd',
  async execute(member) {
    try {
      await applyAutoRole(member);
    } catch (err) {
      logger.error({ err, userId: member.id }, 'auto-role failed');
    }

    try {
      const welcomeChannelId = getChannel('welcome');
      if (welcomeChannelId) {
        const channel = await member.guild.channels.fetch(welcomeChannelId).catch(() => null);
        if (channel && channel.isSendable()) {
          let cardAttachment: AttachmentBuilder | null = null;
          try {
            const buffer = await renderWelcomeCard({
              username: member.user.globalName ?? member.user.username,
              avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 256 }),
              memberCount: member.guild.memberCount,
              serverName: member.guild.name,
            });
            cardAttachment = new AttachmentBuilder(buffer, { name: 'welcome.png' });
          } catch (err) {
            logger.warn({ err, userId: member.id }, 'welcome card render failed, falling back to embed only');
          }

          await (channel as TextChannel).send({
            content: `👋 ${member.toString()}`,
            embeds: cardAttachment ? [] : [buildWelcomeEmbed(member.user.username, member.guild.memberCount)],
            files: cardAttachment ? [cardAttachment] : undefined,
          });
        }
      }

      await sendWelcomeDM(member);

      const auditChannelId = getChannel('auditLog');
      if (auditChannelId) {
        const channel = await member.guild.channels.fetch(auditChannelId).catch(() => null);
        if (channel && channel.isSendable()) {
          await (channel as TextChannel).send({
            embeds: [
              new EmbedBuilder()
                .setColor(Colors.success)
                .setAuthor({ name: 'Member joined', iconURL: member.user.displayAvatarURL() })
                .setDescription(`${member.toString()} — **${member.user.tag}** (\`${member.id}\`)`)
                .addFields(
                  { name: 'Account created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                  { name: 'Member #', value: `${member.guild.memberCount}`, inline: true },
                )
                .setTimestamp(new Date()),
            ],
          });
        }
      }
    } catch (err) {
      logger.error({ err, userId: member.id }, 'guildMemberAdd handler failed');
    }
  },
};

const DEFAULT_WELCOME_DM = [
  'Hey {{username}}, schön dass du da bist.',
  '',
  '**So kommst du rein:**',
  '• Checke die **#📜・regeln** — kurze Liste, freundlicher Server',
  '• Im **#🎭・rollen** Channel kannst du dir Ping-Rollen per Button holen',
  '• Klicke auf die Interest-Buttons in **#🎭・rollen** um weitere Channels freizuschalten',
  '• Für Plex-Zugriff (Film/Serie requesten) → frag einen Admin nach der `Plex-User` Rolle',
  '',
  '_Diese DM kommt nur einmal. Fragen? Schreib direkt in den Chat._',
].join('\n');

function renderTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    return v === undefined ? `{{${k}}}` : String(v);
  });
}

async function sendWelcomeDM(member: GuildMember): Promise<void> {
  try {
    const tpl = getSetting('welcomeDmTemplate') || DEFAULT_WELCOME_DM;
    const description = renderTemplate(tpl, {
      username: member.user.username,
      mention: member.toString(),
      server: member.guild.name,
      memberCount: member.guild.memberCount,
    });

    const embed = new EmbedBuilder()
      .setColor(Colors.brand)
      .setTitle(`Willkommen auf ${member.guild.name}! 🎉`)
      .setDescription(description)
      .setFooter({ text: `MagguuBot  ·  automatische Begrüßung` })
      .setTimestamp(new Date());
    await member.send({ embeds: [embed] });
    logger.info({ userId: member.id }, 'welcome DM sent');
  } catch (err) {
    // User might have DMs disabled — expected, log-only
    logger.debug({ err, userId: member.id }, 'welcome DM blocked by user privacy');
  }
}

function buildWelcomeEmbed(username: string, memberCount: number): EmbedBuilder {
  const requestsId = getChannel('requests');
  const requestsRef = requestsId ? `<#${requestsId}>` : '**#anfragen**';

  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setTitle(`Willkommen, ${username}! 🎉`)
    .setDescription(
      [
        'Schön dass du da bist — du startest als **Newcomer**.',
        '',
        '**📜 Les die Regeln** → **#📜・regeln**',
        '**🎭 Hol dir Rollen** → **#🎭・rollen**',
        `**📝 Film / Serie requesten** → ${requestsRef} (wird mit Plex-User-Rolle freigeschaltet)`,
        '',
        '_Plex-Channels siehst du sobald ein Admin dir die `Plex-User` Rolle gibt._',
      ].join('\n'),
    )
    .setFooter({ text: `Member #${memberCount}  ·  MagguuBot` })
    .setTimestamp(new Date());
}
