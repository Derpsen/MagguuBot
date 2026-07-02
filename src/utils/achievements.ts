export interface Achievement {
  emoji: string;
  name: string;
  description: string;
}

export interface AchievementStats {
  level: number;
  messages: number;
  rep: number;
  suggestions: number;
  movieVotes: number;
  giveawayWins: number;
  hasBirthday: boolean;
}

export function deriveAchievements(stats: AchievementStats): Achievement[] {
  const achievements: Achievement[] = [];
  const add = (condition: boolean, emoji: string, name: string, description: string): void => {
    if (condition) achievements.push({ emoji, name, description });
  };
  add(stats.messages >= 1, '🌱', 'Erste Schritte', 'Erste gewertete Nachricht');
  add(stats.messages >= 100, '💬', 'Stammgast', '100 gewertete Nachrichten');
  add(stats.messages >= 1_000, '🗣️', 'Chatmaschine', '1.000 gewertete Nachrichten');
  add(stats.level >= 2, '📈', 'Aufsteiger', 'Level 2 erreicht');
  add(stats.level >= 10, '💎', 'VIP-Vibes', 'Level 10 erreicht');
  add(stats.rep >= 5, '🤝', 'Hilfreich', '5 Reputation gesammelt');
  add(stats.rep >= 25, '🫶', 'Community-Stütze', '25 Reputation gesammelt');
  add(stats.suggestions >= 1, '💡', 'Ideenlieferant', 'Einen Vorschlag eingereicht');
  add(stats.suggestions >= 10, '🧠', 'Ideenschmiede', '10 Vorschläge eingereicht');
  add(stats.movieVotes >= 1, '🎬', 'Filmkritiker', 'Bei einer Movie-Night abgestimmt');
  add(stats.giveawayWins >= 1, '🍀', 'Glückspilz', 'Ein Giveaway gewonnen');
  add(stats.hasBirthday, '🎂', 'Geburtstagskind', 'Geburtstag hinterlegt');
  return achievements;
}
