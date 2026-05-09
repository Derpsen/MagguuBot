import { and, eq } from 'drizzle-orm';
import type { GuildMember, Message } from 'discord.js';
import { db } from '../db/client.js';
import { afk } from '../db/schema.js';
import { logger } from '../utils/logger.js';

const AFK_PREFIX = '[AFK] ';

export interface AfkRow {
  guildId: string;
  userId: string;
  reason: string;
  setAt: Date;
  originalNick: string | null;
}

export function getAfk(guildId: string, userId: string): AfkRow | undefined {
  return db
    .select()
    .from(afk)
    .where(and(eq(afk.guildId, guildId), eq(afk.userId, userId)))
    .get() as AfkRow | undefined;
}

export async function setAfk(member: GuildMember, reason: string): Promise<void> {
  const cleanedReason = reason.slice(0, 200) || 'AFK';
  const originalNick = member.nickname ?? null;

  db.insert(afk)
    .values({
      guildId: member.guild.id,
      userId: member.id,
      reason: cleanedReason,
      setAt: new Date(),
      originalNick,
    })
    .onConflictDoUpdate({
      target: [afk.guildId, afk.userId],
      set: { reason: cleanedReason, setAt: new Date(), originalNick },
    })
    .run();

  try {
    const baseName = member.displayName;
    if (!baseName.startsWith(AFK_PREFIX)) {
      const newNick = `${AFK_PREFIX}${baseName}`.slice(0, 32);
      await member.setNickname(newNick, 'user set AFK');
    }
  } catch (err) {
    logger.debug({ err, userId: member.id }, 'AFK nickname change failed (missing perms?)');
  }
}

export async function clearAfk(member: GuildMember): Promise<AfkRow | undefined> {
  const existing = getAfk(member.guild.id, member.id);
  if (!existing) return undefined;
  db.delete(afk)
    .where(and(eq(afk.guildId, member.guild.id), eq(afk.userId, member.id)))
    .run();

  try {
    if (member.displayName.startsWith(AFK_PREFIX)) {
      const restored = existing.originalNick;
      await member.setNickname(restored, 'user returned from AFK');
    }
  } catch (err) {
    logger.debug({ err, userId: member.id }, 'AFK nickname restore failed');
  }
  return existing;
}

export async function handleAfkMessage(message: Message): Promise<void> {
  if (!message.guild || !message.member || message.author.bot) return;

  const own = getAfk(message.guild.id, message.author.id);
  if (own) {
    const cleared = await clearAfk(message.member);
    if (cleared) {
      try {
        const sent = await message.reply({
          content: `Welcome back ${message.author.toString()} — AFK entfernt.`,
          allowedMentions: { repliedUser: false },
        });
        setTimeout(() => {
          sent.delete().catch(() => {});
        }, 8000);
      } catch {
        /* ignore */
      }
    }
  }

  const mentioned = message.mentions.users;
  if (mentioned.size === 0) return;
  const lines: string[] = [];
  for (const user of mentioned.values()) {
    if (user.id === message.author.id) continue;
    const row = getAfk(message.guild.id, user.id);
    if (row) {
      lines.push(
        `💤 **${user.username}** ist AFK seit <t:${Math.floor(row.setAt.getTime() / 1000)}:R> — ${row.reason}`,
      );
    }
    if (lines.length >= 3) break;
  }
  if (lines.length > 0) {
    try {
      const sent = await message.reply({
        content: lines.join('\n'),
        allowedMentions: { repliedUser: false },
      });
      setTimeout(() => {
        sent.delete().catch(() => {});
      }, 12000);
    } catch {
      /* ignore */
    }
  }
}
