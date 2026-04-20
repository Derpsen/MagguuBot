import type { Message } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { autoresponders, type Autoresponder } from '../db/schema.js';
import { logger } from '../utils/logger.js';

interface CachedRule {
  rule: Autoresponder;
  regex: RegExp;
}

let cache: CachedRule[] | null = null;
let cacheGuild: string | null = null;
let cacheAt = 0;
const CACHE_TTL = 30_000;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(rule: Autoresponder): RegExp | null {
  try {
    if (rule.matchType === 'regex') return new RegExp(rule.pattern, 'i');
    if (rule.matchType === 'word') return new RegExp(`\\b${escapeRegex(rule.pattern)}\\b`, 'i');
    return new RegExp(escapeRegex(rule.pattern), 'i');
  } catch {
    return null;
  }
}

function loadRules(guildId: string): CachedRule[] {
  const now = Date.now();
  if (cacheGuild === guildId && cache && now - cacheAt < CACHE_TTL) return cache;

  const rows = db
    .select()
    .from(autoresponders)
    .where(eq(autoresponders.guildId, guildId))
    .all()
    .filter((r) => r.enabled);

  const compiled: CachedRule[] = [];
  for (const row of rows) {
    const re = compile(row);
    if (re) compiled.push({ rule: row, regex: re });
  }

  cache = compiled;
  cacheGuild = guildId;
  cacheAt = now;
  return compiled;
}

export function invalidateAutoresponderCache(): void {
  cache = null;
  cacheAt = 0;
}

export async function runAutoresponder(message: Message): Promise<boolean> {
  if (!message.inGuild()) return false;
  if (message.author.bot) return false;
  if (!message.content) return false;

  const rules = loadRules(message.guildId);
  for (const { rule, regex } of rules) {
    if (!regex.test(message.content)) continue;
    try {
      await message.reply({
        content: rule.response,
        allowedMentions: { parse: [], repliedUser: false },
      });
      return true;
    } catch (err) {
      logger.warn({ err, ruleId: rule.id }, 'autoresponder reply failed');
    }
  }
  return false;
}
