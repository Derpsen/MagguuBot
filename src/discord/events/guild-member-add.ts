import {
  AttachmentBuilder,
  EmbedBuilder,
  type GuildMember,
} from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { renderWelcomeCard } from '../cards/welcome-card.js';
import { Colors } from '../../embeds/colors.js';
import {
  buildWelcomeChannelEmbed,
  buildWelcomeDmEmbed,
  buildWelcomeOnboardingButtons,
} from '../../embeds/welcome-onboarding.js';
import { db } from '../../db/client.js';
import { memberHistory } from '../../db/schema.js';
import { getSetting } from '../../settings.js';
import { logger } from '../../utils/logger.js';
import { checkAntiRaid, checkUsernameFilter } from '../anti-raid.js';
import { applyAutoRole } from '../auto-role.js';
import { getChannel } from '../channel-store.js';
import type { BotEvent } from './types.js';

const SUSPICIOUS_ACCOUNT_AGE_DAYS = 7;

interface JoinHistoryResult {
  isReturning: boolean;
  joinCount: number;
}

function trackMemberJoin(member: GuildMember): JoinHistoryResult {
  const key = and(eq(memberHistory.guildId, member.guild.id), eq(memberHistory.userId, member.id));
  const existing = db.select().from(memberHistory).where(key).get();
  const now = new Date();

  if (existing) {
    db.update(memberHistory)
      .set({ lastJoinedAt: now, joinCount: existing.joinCount + 1 })
      .where(key)
      .run();
    return { isReturning: true, joinCount: existing.joinCount + 1 };
  }

  db.insert(memberHistory)
    .values({
      guildId: member.guild.id,
      userId: member.id,
      firstJoinedAt: now,
      lastJoinedAt: now,
      joinCount: 1,
    })
    .run();
  return { isReturning: false, joinCount: 1 };
}

export const guildMemberAddEvent: BotEvent<'guildMemberAdd'> = {
  name: 'guildMemberAdd',
  async execute(member) {
    if (member.user.bot) return;

    try {
      const kicked = await checkUsernameFilter(member);
      if (kicked) return;
    } catch (err) {
      logger.error({ err, userId: member.id }, 'username filter failed');
    }

    try {
      await checkAntiRaid(member);
    } catch (err) {
      logger.error({ err, userId: member.id }, 'anti-raid check failed');
    }

    const accountAgeMs = Date.now() - member.user.createdTimestamp;
    const accountAgeDays = accountAgeMs / 86_400_000;

    try {
      await applyAutoRole(member);
    } catch (err) {
      logger.error({ err, userId: member.id }, 'auto-role failed');
    }

    let history: JoinHistoryResult = { isReturning: false, joinCount: 1 };
    try {
      history = trackMemberJoin(member);
    } catch (err) {
      logger.error(
        { err, userId: member.id, guildId: member.guild.id },
        'member join history failed; continuing join workflow',
      );
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
              accountAgeDays,
              isReturning: history.isReturning,
              serverBoostLevel: member.guild.premiumTier ?? 0,
            });
            cardAttachment = new AttachmentBuilder(buffer, { name: 'welcome.png' });
          } catch (err) {
            logger.warn(
              { err, userId: member.id },
              'welcome card render failed, falling back to embed only',
            );
          }

          const embed = buildWelcomeChannelEmbed({
            member,
            isReturning: history.isReturning,
            accountAgeDays,
          });
          await channel.send({
            content: history.isReturning
              ? `↩️ ${member.toString()} ist zurück.`
              : `🎉 ${member.toString()} hat den Server betreten!`,
            embeds: [embed],
            components: buildWelcomeOnboardingButtons(),
            files: cardAttachment ? [cardAttachment] : undefined,
            allowedMentions: { users: [member.id] },
          });
        }
      }

      await sendWelcomeDM(member, history.isReturning);

      const auditChannelId = getChannel('auditLog');
      if (auditChannelId) {
        const channel = await member.guild.channels.fetch(auditChannelId).catch(() => null);
        if (channel && channel.isSendable()) {
          const auditEmbed = new EmbedBuilder()
            .setColor(history.isReturning ? Colors.brand : Colors.success)
            .setAuthor({
              name: history.isReturning ? 'Member rejoined' : 'Member joined',
              iconURL: member.user.displayAvatarURL(),
            })
            .setDescription(
              `${member.toString()} — **${member.user.displayName}** (\`${member.id}\`)`,
            )
            .addFields(
              {
                name: 'Account created',
                value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
                inline: true,
              },
              { name: 'Member #', value: `${member.guild.memberCount}`, inline: true },
              { name: 'Join count', value: `${history.joinCount}`, inline: true },
            )
            .setTimestamp(new Date());
          await channel.send({ embeds: [auditEmbed] });
        }
      }

      if (accountAgeDays < SUSPICIOUS_ACCOUNT_AGE_DAYS) {
        const modLogId = getChannel('modLog');
        if (modLogId) {
          const channel = await member.guild.channels.fetch(modLogId).catch(() => null);
          if (channel && channel.isSendable()) {
            await channel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(Colors.warn)
                  .setAuthor({
                    name: 'Junger Account joined',
                    iconURL: member.user.displayAvatarURL(),
                  })
                  .setDescription(
                    `${member.toString()} — Account ist erst **${Math.floor(accountAgeDays)} Tag${
                      Math.floor(accountAgeDays) === 1 ? '' : 'e'
                    }** alt. Genauer beobachten oder ggf. verifizieren.`,
                  )
                  .addFields(
                    {
                      name: 'Created',
                      value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`,
                      inline: true,
                    },
                    { name: 'User-ID', value: `\`${member.id}\``, inline: true },
                  )
                  .setTimestamp(new Date()),
              ],
            });
          }
        }
      }
    } catch (err) {
      logger.error({ err, userId: member.id }, 'guildMemberAdd handler failed');
    }
  },
};

async function sendWelcomeDM(member: GuildMember, isReturning: boolean): Promise<void> {
  try {
    const customTpl = getSetting('welcomeDmTemplate');
    if (customTpl) {
      const description = customTpl
        .replace(/\{\{\s*username\s*\}\}/g, member.user.username)
        .replace(/\{\{\s*mention\s*\}\}/g, member.toString())
        .replace(/\{\{\s*server\s*\}\}/g, member.guild.name)
        .replace(/\{\{\s*memberCount\s*\}\}/g, String(member.guild.memberCount));
      const embed = new EmbedBuilder()
        .setColor(Colors.brand)
        .setTitle(`Willkommen auf ${member.guild.name}! 🎉`)
        .setDescription(description)
        .setFooter({ text: 'MagguuBot · automatische Begrüßung' })
        .setTimestamp(new Date());
      await member.send({ embeds: [embed] });
      logger.info({ userId: member.id }, 'welcome DM sent (custom template)');
      return;
    }

    const embed = buildWelcomeDmEmbed(member, isReturning);
    const components = buildWelcomeOnboardingButtons();
    await member.send({ embeds: [embed], components });
    logger.info({ userId: member.id, isReturning }, 'welcome DM sent (default + buttons)');
  } catch (err) {
    logger.debug({ err, userId: member.id }, 'welcome DM blocked by user privacy');
  }
}
