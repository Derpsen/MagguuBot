import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { botSettings } from '../db/schema.js';
import { buildAddonReleaseAnnouncementEmbed } from '../embeds/addon-release.js';
import { postEmbed } from '../server/discord-poster.js';
import { decideRelease } from '../utils/addon-release-decision.js';
import { logger } from '../utils/logger.js';
import { getChannel } from './channel-store.js';

const SETTINGS_KEY = 'addonReleaseAnnouncedTags';
const MAX_TAGS = 50;

const releaseSchema = z.object({
  tag_name: z.string().min(1),
  name: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  html_url: z.string().url(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
});
export type PolledRelease = z.infer<typeof releaseSchema>;

const norm = (tag: string): string => tag.trim().toLowerCase();

export function loadAnnouncedTags(): string[] {
  const row = db
    .select()
    .from(botSettings)
    .where(and(eq(botSettings.guildId, config.DISCORD_GUILD_ID), eq(botSettings.key, SETTINGS_KEY)))
    .get();
  if (!row?.value) return [];
  try {
    const parsed = z.array(z.string()).safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function saveAnnouncedTags(tags: string[]): void {
  const value = JSON.stringify(tags.slice(-MAX_TAGS));
  db.insert(botSettings)
    .values({ guildId: config.DISCORD_GUILD_ID, key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: [botSettings.guildId, botSettings.key], set: { value, updatedAt: new Date() } })
    .run();
}

/** Shared with the GitHub release webhook so poll + webhook never announce one tag twice. */
export function wasAddonReleaseAnnounced(tag: string): boolean {
  return loadAnnouncedTags().map(norm).includes(norm(tag));
}

export function markAddonReleaseAnnounced(tag: string): void {
  const tags = loadAnnouncedTags();
  if (!tags.map(norm).includes(norm(tag))) saveAnnouncedTags([...tags, tag]);
}

async function fetchLatestRelease(repo: string, token: string): Promise<PolledRelease | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'MagguuBot',
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub releases/latest ${res.status}`);
  return releaseSchema.parse(await res.json());
}

export async function runAddonReleasePollTick(): Promise<void> {
  const token = config.MAGGUUUI_READ_TOKEN;
  if (!token) return;
  const repo = config.MAGGUUUI_RELEASE_REPO;
  const release = await fetchLatestRelease(repo, token);
  if (!release) return;

  const decision = decideRelease(release, loadAnnouncedTags());
  if (decision === 'seed') {
    markAddonReleaseAnnounced(release.tag_name);
    logger.info({ repo, tag: release.tag_name }, 'addon release poller seeded, not announcing existing release');
    return;
  }
  if (decision === 'skip') return;

  const channelId = getChannel('addonUpdates') ?? getChannel('github');
  const message = await postEmbed({
    channelId,
    source: 'addon-release',
    eventType: 'release.poll',
    payload: { repo, tag: release.tag_name, url: release.html_url },
    embed: buildAddonReleaseAnnouncementEmbed({
      tag: release.tag_name,
      name: release.name,
      body: release.body,
      url: release.html_url,
    }),
    pingRoles: ['ping-github'],
  });
  if (message || !channelId) markAddonReleaseAnnounced(release.tag_name);
  logger.info({ repo, tag: release.tag_name, posted: Boolean(message) }, 'addon release announced');
}
