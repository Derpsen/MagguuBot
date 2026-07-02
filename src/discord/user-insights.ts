import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  birthdays,
  giveaways,
  movieNightVotes,
  reputation,
  suggestions,
} from '../db/schema.js';
import { getUserXp } from './xp.js';
import { deriveAchievements, type Achievement } from '../utils/achievements.js';

export interface UserInsights {
  xp: number;
  level: number;
  messages: number;
  rep: number;
  suggestions: number;
  movieVotes: number;
  giveawayWins: number;
  birthday: { day: number; month: number; year: number | null } | null;
  achievements: Achievement[];
}

export function getUserInsights(guildId: string, userId: string, since?: Date): UserInsights {
  const xp = getUserXp(guildId, userId);
  const rep = db
    .select({ value: reputation.rep })
    .from(reputation)
    .where(and(eq(reputation.guildId, guildId), eq(reputation.userId, userId)))
    .get()?.value ?? 0;
  const suggestionWhere = since
    ? and(eq(suggestions.guildId, guildId), eq(suggestions.authorId, userId), gte(suggestions.createdAt, since))
    : and(eq(suggestions.guildId, guildId), eq(suggestions.authorId, userId));
  const suggestionCount = db
    .select({ count: sql<number>`count(*)` })
    .from(suggestions)
    .where(suggestionWhere)
    .get()?.count ?? 0;
  const voteWhere = since
    ? and(eq(movieNightVotes.userId, userId), gte(movieNightVotes.createdAt, since))
    : eq(movieNightVotes.userId, userId);
  const movieVotes = db
    .select({ count: sql<number>`count(*)` })
    .from(movieNightVotes)
    .where(voteWhere)
    .get()?.count ?? 0;
  const wins = db
    .select({ winners: giveaways.winners })
    .from(giveaways)
    .where(eq(giveaways.guildId, guildId))
    .all()
    .filter((row) => row.winners.includes(userId)).length;
  const birthday = db
    .select({ day: birthdays.day, month: birthdays.month, year: birthdays.year })
    .from(birthdays)
    .where(and(eq(birthdays.guildId, guildId), eq(birthdays.userId, userId)))
    .get() ?? null;
  const base = {
    xp: xp?.xp ?? 0,
    level: xp?.level ?? 0,
    messages: xp?.messagesCounted ?? 0,
    rep,
    suggestions: suggestionCount,
    movieVotes,
    giveawayWins: wins,
    birthday,
  };
  return {
    ...base,
    achievements: deriveAchievements({
      ...base,
      hasBirthday: Boolean(base.birthday),
    }),
  };
}
