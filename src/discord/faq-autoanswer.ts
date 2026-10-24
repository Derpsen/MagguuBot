import { EmbedBuilder, type Message } from 'discord.js';
import { z } from 'zod';
import { config } from '../config.js';
import { Colors, truncate } from '../embeds/colors.js';
import {
  CooldownGate,
  DEFAULT_MATCH_OPTIONS,
  faqAnswerToDiscord,
  looksLikeQuestion,
  matchFaq,
  type FaqEntry,
} from '../utils/faq-matcher.js';
import { neutralizeMentions } from '../utils/faq-search.js';
import { logger } from '../utils/logger.js';
import { safeFetch } from '../utils/safe-fetch.js';

const CACHE_TTL_MS = 60 * 60_000;

const faqResponse = z.object({
  success: z.literal(true),
  data: z.record(
    z.string(),
    z.array(z.object({ id: z.number(), category: z.string(), question: z.string(), answer: z.string() })),
  ),
});

let cache: { entries: FaqEntry[]; at: number } | null = null;
const userGate = new CooldownGate();
const channelGate = new CooldownGate();
const repeatGate = new CooldownGate();

function helpChannels(): Set<string> {
  return new Set(faqAutoanswerChannelIds());
}

/** Configured help-channel IDs (env only, not stored in channel_config). */
export function faqAutoanswerChannelIds(): string[] {
  return config.FAQ_AUTOANSWER_CHANNEL_IDS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function faqAutoanswerEnabled(): boolean {
  return helpChannels().size > 0;
}

/** Refreshes the cache from the public website FAQ API (also feeds `/faq`, independent of auto-answer channels). */
export async function refreshWebsiteFaqCache(): Promise<void> {
  const res = await safeFetch(config.WEBSITE_FAQ_API_URL, {
    headers: { accept: 'application/json', 'user-agent': 'MagguuBot' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`website FAQ ${res.status}`);
  const parsed = faqResponse.parse(await res.json());
  const entries = Object.values(parsed.data).flat();
  cache = { entries, at: Date.now() };
  logger.info({ count: entries.length }, 'website FAQ cache refreshed');
}

/** Network-free snapshot for autocomplete: whatever the last refresh stored (possibly empty). */
export function getCachedFaqEntries(): readonly FaqEntry[] {
  return cache?.entries ?? [];
}

/** Test hook. */
export function setFaqCacheForTests(entries: FaqEntry[] | null): void {
  cache = entries ? { entries, at: Date.now() } : null;
}

/** Cached entries; refreshes first when missing or stale (may hit the network, so not for autocomplete). */
export async function loadFaqEntries(): Promise<readonly FaqEntry[]> {
  return getEntries();
}

async function getEntries(): Promise<FaqEntry[]> {
  if (!cache || Date.now() - cache.at > CACHE_TTL_MS) {
    try {
      await refreshWebsiteFaqCache();
    } catch (err) {
      logger.warn({ err }, 'website FAQ refresh failed; using stale cache');
    }
  }
  return cache?.entries ?? [];
}

export function buildFaqAnswerEmbed(
  entry: FaqEntry,
  pageUrl: string,
  footer = 'Automatische Antwort aus dem Website-FAQ',
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.info)
    .setAuthor({ name: 'MagguuUI FAQ', url: pageUrl })
    .setTitle(truncate(neutralizeMentions(entry.question), 256))
    .setURL(pageUrl)
    .setDescription(
      truncate(`${neutralizeMentions(faqAnswerToDiscord(entry.answer))}\n\nMehr im FAQ: ${pageUrl}`, 4096),
    )
    .setFooter({ text: footer });
}

/** Silent unless the message is a question in a help channel with a confident FAQ match. */
export async function runFaqAutoanswer(message: Message<true>): Promise<boolean> {
  if (!helpChannels().has(message.channelId)) return false;
  if (!looksLikeQuestion(message.content)) return false;
  const userKey = `${message.channelId}:${message.author.id}`;
  if (userGate.isBlocked(userKey) || channelGate.isBlocked(message.channelId)) return false;

  const match = matchFaq(message.content, await getEntries(), {
    ...DEFAULT_MATCH_OPTIONS,
    minScore: config.FAQ_AUTOANSWER_MIN_SCORE,
  });
  if (!match) return false;
  if (!repeatGate.tryClaim(`${message.channelId}:${match.entry.id}`, config.FAQ_AUTOANSWER_REPEAT_WINDOW_MINUTES * 60_000)) {
    return false;
  }
  userGate.tryClaim(userKey, config.FAQ_AUTOANSWER_USER_COOLDOWN_SECONDS * 1000);
  channelGate.tryClaim(message.channelId, config.FAQ_AUTOANSWER_CHANNEL_COOLDOWN_SECONDS * 1000);

  await message.reply({
    embeds: [buildFaqAnswerEmbed(match.entry, config.WEBSITE_FAQ_PAGE_URL)],
    allowedMentions: { repliedUser: false },
  });
  logger.info({ faqId: match.entry.id, score: match.score, channelId: message.channelId }, 'faq auto-answer sent');
  return true;
}
