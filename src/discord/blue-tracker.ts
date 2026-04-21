import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { botSettings } from '../db/schema.js';
import { buildBlueTrackerEmbed } from '../embeds/blue-tracker.js';
import { postEmbed } from '../server/discord-poster.js';
import { fetchRss, type RssItem } from '../services/rss.js';
import { logger } from '../utils/logger.js';
import { getChannel } from './channel-store.js';

const SETTINGS_KEY = 'blueTrackerSeenGuids';
const MAX_SEEN = 200;
const MAX_POST_PER_RUN = 5;

const NON_RETAIL_KEYWORDS = [
  'classic',
  'season of discovery',
  ' sod ',
  'wrath of the lich king',
  'wotlk',
  'cataclysm',
  'tbc',
  'burning crusade',
  'mop remix',
  'mists remix',
  'hardcore',
  'pandaria remix',
];

export function isRelevantBluePost(item: RssItem): boolean {
  const haystacks: string[] = [];
  if (item.categories) haystacks.push(...item.categories);
  if (item.title) haystacks.push(item.title);
  if (item.description) haystacks.push(item.description.slice(0, 500));

  for (const raw of haystacks) {
    const lower = raw.toLowerCase();
    for (const bad of NON_RETAIL_KEYWORDS) {
      if (lower.includes(bad)) return false;
    }
  }
  return true;
}

export async function runBlueTrackerTick(): Promise<void> {
  const url = config.WOW_BLUE_TRACKER_URL;
  if (!url) return;

  const channelId = getChannel('blueTracker');
  if (!channelId) {
    logger.debug('blue-tracker channel not configured, skipping');
    return;
  }

  const all = await fetchRss(url);
  if (all.length === 0) return;
  const items = all.filter(isRelevantBluePost);

  const seen = loadSeen();

  if (seen.size === 0) {
    saveSeen(new Set(all.map((i) => i.guid).slice(0, MAX_SEEN)));
    logger.info(
      { total: all.length, retailOnly: items.length },
      'blue-tracker bootstrapped, not posting historical items',
    );
    return;
  }

  const fresh = items.filter((i) => !seen.has(i.guid)).reverse().slice(0, MAX_POST_PER_RUN);

  for (const item of fresh) {
    await postOne(item, channelId);
    seen.add(item.guid);
  }

  saveSeen(trimSeen(seen));
}

async function postOne(item: RssItem, channelId: string): Promise<void> {
  try {
    await postEmbed({
      channelId,
      embed: buildBlueTrackerEmbed(item),
      source: 'blue-tracker',
      eventType: 'new',
      payload: { guid: item.guid, title: item.title, link: item.link, author: item.author },
    });
  } catch (err) {
    logger.warn({ err, guid: item.guid }, 'blue-tracker post failed');
  }
}

function loadSeen(): Set<string> {
  const row = db
    .select()
    .from(botSettings)
    .where(and(eq(botSettings.guildId, config.DISCORD_GUILD_ID), eq(botSettings.key, SETTINGS_KEY)))
    .get();
  if (!row?.value) return new Set();
  try {
    const arr = JSON.parse(row.value) as unknown;
    if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === 'string'));
    return new Set();
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>): void {
  db.insert(botSettings)
    .values({
      guildId: config.DISCORD_GUILD_ID,
      key: SETTINGS_KEY,
      value: JSON.stringify(Array.from(seen)),
    })
    .onConflictDoUpdate({
      target: [botSettings.guildId, botSettings.key],
      set: { value: JSON.stringify(Array.from(seen)), updatedAt: new Date() },
    })
    .run();
}

function trimSeen(seen: Set<string>): Set<string> {
  if (seen.size <= MAX_SEEN) return seen;
  return new Set(Array.from(seen).slice(-MAX_SEEN));
}
