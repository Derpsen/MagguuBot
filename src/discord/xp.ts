import type { GuildMember } from 'discord.js';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { userXp } from '../db/schema.js';
import { logger } from '../utils/logger.js';

const XP_PER_MESSAGE = 15;
const COOLDOWN_MS = 60_000;

export function levelFromXp(xp: number): number {
  return Math.floor(0.1 * Math.sqrt(xp));
}

export function xpForLevel(level: number): number {
  return Math.ceil(Math.pow(level / 0.1, 2));
}

export interface XpRankRule {
  atLevel: number;
  roleName: string;
  removeRoles?: string[];
}

export const RANK_RULES: XpRankRule[] = [
  { atLevel: 2, roleName: 'Regular', removeRoles: ['Newcomer'] },
  { atLevel: 10, roleName: 'VIP', removeRoles: ['Newcomer', 'Regular'] },
];

interface XpRow {
  guildId: string;
  userId: string;
  xp: number;
  level: number;
  messagesCounted: number;
  lastGrantedAt: Date;
}

export interface XpGrantResult {
  granted: boolean;
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
}

export async function grantXp(member: GuildMember): Promise<XpGrantResult> {
  const now = new Date();
  const key = and(eq(userXp.guildId, member.guild.id), eq(userXp.userId, member.id));
  const existing = db.select().from(userXp).where(key).get() as XpRow | undefined;

  if (existing && now.getTime() - existing.lastGrantedAt.getTime() < COOLDOWN_MS) {
    return { granted: false, leveledUp: false, oldLevel: existing.level, newLevel: existing.level };
  }

  const oldXp = existing?.xp ?? 0;
  const newXp = oldXp + XP_PER_MESSAGE;
  const oldLevel = existing?.level ?? 0;
  const newLevel = levelFromXp(newXp);
  const messagesCounted = (existing?.messagesCounted ?? 0) + 1;

  if (existing) {
    db.update(userXp)
      .set({ xp: newXp, level: newLevel, messagesCounted, lastGrantedAt: now })
      .where(key)
      .run();
  } else {
    db.insert(userXp)
      .values({
        guildId: member.guild.id,
        userId: member.id,
        xp: newXp,
        level: newLevel,
        messagesCounted: 1,
        lastGrantedAt: now,
      })
      .run();
  }

  if (newLevel > oldLevel) {
    await applyRankRoles(member, newLevel);
  }

  return { granted: true, leveledUp: newLevel > oldLevel, oldLevel, newLevel };
}

async function applyRankRoles(member: GuildMember, level: number): Promise<void> {
  const matching = RANK_RULES.filter((r) => level >= r.atLevel);
  const rule = matching[matching.length - 1];
  if (!rule) return;

  try {
    const grantRole = member.guild.roles.cache.find((r) => r.name === rule.roleName);
    if (grantRole && !member.roles.cache.has(grantRole.id)) {
      await member.roles.add(grantRole, `level-up to ${rule.roleName}`);
    }
    for (const removeName of rule.removeRoles ?? []) {
      const removeRole = member.guild.roles.cache.find((r) => r.name === removeName);
      if (removeRole && member.roles.cache.has(removeRole.id)) {
        await member.roles.remove(removeRole, `promoted beyond ${removeName}`);
      }
    }
  } catch (err) {
    logger.warn({ err, level, userId: member.id }, 'rank role apply failed');
  }
}

export function getUserXp(guildId: string, userId: string): XpRow | undefined {
  return db
    .select()
    .from(userXp)
    .where(and(eq(userXp.guildId, guildId), eq(userXp.userId, userId)))
    .get() as XpRow | undefined;
}

export function getLeaderboard(guildId: string, limit = 10): XpRow[] {
  return db
    .select()
    .from(userXp)
    .where(eq(userXp.guildId, guildId))
    .orderBy(desc(userXp.xp))
    .limit(limit)
    .all() as XpRow[];
}
