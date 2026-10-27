/** XP rank rules as pure data: no database or env config import (shared by xp.ts and the roles tooling). */
export interface XpRankRule {
  atLevel: number;
  roleName: string;
  removeRoles?: string[];
}

export const RANK_RULES: XpRankRule[] = [
  { atLevel: 2, roleName: 'Regular', removeRoles: ['Newcomer'] },
];
