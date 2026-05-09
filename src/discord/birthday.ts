import { EmbedBuilder, type GuildMember, type TextChannel } from 'discord.js';
import { and, eq, ne } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { birthdays } from '../db/schema.js';
import { Colors } from '../embeds/colors.js';
import { getSetting } from '../settings.js';
import { logger } from '../utils/logger.js';
import { getClient } from './client.js';

export async function tickBirthdays(): Promise<void> {
  const channelId = getSetting('birthdayChannelId');
  if (!channelId) return;

  const now = new Date();
  const today = { day: now.getDate(), month: now.getMonth() + 1, year: now.getFullYear() };

  const due = db
    .select()
    .from(birthdays)
    .where(and(eq(birthdays.day, today.day), eq(birthdays.month, today.month)))
    .all();
  if (due.length === 0) {
    void resetBirthdayRoles(today.year, today.day, today.month).catch((err) =>
      logger.warn({ err }, 'birthday role reset failed'),
    );
    return;
  }

  const toCelebrate = due.filter((b) => b.lastCelebratedYear !== today.year);
  if (toCelebrate.length === 0) {
    void resetBirthdayRoles(today.year, today.day, today.month).catch((err) =>
      logger.warn({ err }, 'birthday role reset failed'),
    );
    return;
  }

  const client = getClient();
  const guild = await client.guilds.fetch(config.DISCORD_GUILD_ID).catch(() => null);
  if (!guild) return;
  const channel = (await guild.channels.fetch(channelId).catch(() => null)) as TextChannel | null;
  if (!channel?.isSendable()) return;

  const roleId = getSetting('birthdayRoleId');
  for (const b of toCelebrate) {
    try {
      const member = await guild.members.fetch(b.userId).catch(() => null);
      if (!member) continue;
      const age = b.year ? today.year - b.year : null;
      const embed = new EmbedBuilder()
        .setColor(0xff73fa)
        .setTitle('🎂 Happy Birthday!')
        .setDescription(
          age
            ? `${member.toString()} wird heute **${age}** Jahre alt! 🎉`
            : `${member.toString()} hat heute Geburtstag! 🎉`,
        )
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setTimestamp(new Date());
      await channel.send({ content: `🎉 ${member.toString()}`, embeds: [embed] });

      if (roleId) {
        await member.roles.add(roleId, 'birthday role').catch((err) => {
          logger.warn({ err, userId: member.id }, 'birthday role add failed');
        });
      }

      db.update(birthdays)
        .set({ lastCelebratedYear: today.year })
        .where(and(eq(birthdays.guildId, b.guildId), eq(birthdays.userId, b.userId)))
        .run();
    } catch (err) {
      logger.error({ err, userId: b.userId }, 'birthday celebration failed');
    }
  }

  void resetBirthdayRoles(today.year, today.day, today.month).catch((err) =>
    logger.warn({ err }, 'birthday role reset failed'),
  );
}

async function resetBirthdayRoles(year: number, day: number, month: number): Promise<void> {
  const roleId = getSetting('birthdayRoleId');
  if (!roleId) return;
  const client = getClient();
  const guild = await client.guilds.fetch(config.DISCORD_GUILD_ID).catch(() => null);
  if (!guild) return;
  const role = guild.roles.cache.get(roleId);
  if (!role) return;

  for (const member of role.members.values()) {
    const row = db
      .select()
      .from(birthdays)
      .where(and(eq(birthdays.guildId, guild.id), eq(birthdays.userId, member.id)))
      .get();
    const isStillBirthday =
      row && row.day === day && row.month === month && row.lastCelebratedYear === year;
    if (!isStillBirthday) {
      await member.roles.remove(role, 'birthday role expired').catch(() => {});
    }
  }
}

export function setBirthday(
  guildId: string,
  userId: string,
  day: number,
  month: number,
  year?: number,
): void {
  db.insert(birthdays)
    .values({
      guildId,
      userId,
      day,
      month,
      year: year ?? null,
    })
    .onConflictDoUpdate({
      target: [birthdays.guildId, birthdays.userId],
      set: { day, month, year: year ?? null },
    })
    .run();
}

export function getBirthday(guildId: string, userId: string): { day: number; month: number; year: number | null } | undefined {
  const row = db
    .select()
    .from(birthdays)
    .where(and(eq(birthdays.guildId, guildId), eq(birthdays.userId, userId)))
    .get();
  if (!row) return undefined;
  return { day: row.day, month: row.month, year: row.year };
}

export function getUpcomingBirthdays(guildId: string, count = 10): Array<{
  userId: string;
  day: number;
  month: number;
}> {
  const now = new Date();
  const all = db.select().from(birthdays).where(and(eq(birthdays.guildId, guildId), ne(birthdays.day, 0))).all();
  const withNext = all.map((b) => {
    const next = new Date(now.getFullYear(), b.month - 1, b.day);
    if (next < now) next.setFullYear(now.getFullYear() + 1);
    return { userId: b.userId, day: b.day, month: b.month, ts: next.getTime() };
  });
  withNext.sort((a, b) => a.ts - b.ts);
  return withNext.slice(0, count).map(({ userId, day, month }) => ({ userId, day, month }));
}
