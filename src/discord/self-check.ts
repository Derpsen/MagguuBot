/**
 * Read-only server self-check: routing, stored IDs, cards (dead mentions,
 * unknown commands, duplicates) and the community public-updates channel.
 * Shown by /doctor; run daily by the scheduler, which posts to 📋・logs only
 * when something fails.
 */
import { EmbedBuilder, type Guild, type TextChannel } from 'discord.js';
import { config } from '../config.js';
import { sqliteHandle } from '../db/client.js';
import { Colors, truncate } from '../embeds/colors.js';
import { findDuplicateCards } from '../rollout/cards-plan.js';
import { getAllSettings } from '../settings.js';
import { describeFinding } from '../utils/card-audit.js';
import { logger } from '../utils/logger.js';
import { checkRouting, describeRoutingProblem, type LiveChannelInfo } from '../utils/routing.js';
import { collectStoredRefs, describeStaleRef, findStaleRefs, type GuildIndex } from '../utils/stale-ids.js';
import { auditGuildCards } from './card-context.js';
import { getChannel } from './channel-store.js';
import { getClient } from './client.js';
import { ARCHIVE_CATEGORY_NAME, CHANNEL } from './server-layout.js';

export interface SelfCheckSection {
  label: string;
  ok: boolean;
  detail: string;
}

const CATEGORY = 4;
const MAX_LINES = 6;

function list(head: string, items: string[], more: string): string {
  const shown = items.slice(0, MAX_LINES).map((l) => `• ${l}`);
  if (items.length > MAX_LINES) shown.push(`… und ${items.length - MAX_LINES} weitere (${more})`);
  return [head, ...shown].join('\n');
}

export function guildIndex(guild: Guild): GuildIndex & { live: Map<string, LiveChannelInfo> } {
  const archiveId = guild.channels.cache.find((c) => c.type === CATEGORY && c.name === ARCHIVE_CATEGORY_NAME)?.id ?? null;
  const channels = new Map<string, { name: string; type: number; parentId: string | null }>();
  const live = new Map<string, LiveChannelInfo>();
  for (const c of guild.channels.cache.values()) {
    channels.set(c.id, { name: c.name, type: c.type, parentId: c.parentId });
    live.set(c.id, { id: c.id, name: c.name, parentId: c.parentId });
  }
  return {
    channels,
    live,
    archiveId,
    roleIds: new Set(guild.roles.cache.keys()),
    roleNames: new Set(guild.roles.cache.map((r) => r.name)),
  };
}

export async function runSelfCheck(guild: Guild): Promise<SelfCheckSection[]> {
  const sections: SelfCheckSection[] = [];
  const idx = guildIndex(guild);

  const routing = checkRouting(getChannel, idx.live, new Set(idx.archiveId ? [idx.archiveId] : []));
  const routeProblems = routing.filter((r) => r.problem);
  sections.push({
    label: 'Routing',
    ok: routeProblems.length === 0,
    detail: routeProblems.length
      ? list(`${routeProblems.length} von ${routing.length} Keys zeigen falsch:`, routeProblems.map(describeRoutingProblem), 'discord-acceptance.js --report')
      : `${routing.length} Keys zeigen auf ihren Layout-Kanal`,
  });

  const stale = findStaleRefs(collectStoredRefs(sqliteHandle, guild.id, getAllSettings() as unknown as Record<string, unknown>), idx);
  sections.push({
    label: 'Gespeicherte IDs',
    ok: stale.length === 0,
    detail: stale.length
      ? list(`${stale.length} gespeicherte ID(s) zeigen ins Leere:`, stale.map(describeStaleRef), 'discord-acceptance.js --report')
      : 'alle gespeicherten Kanal-, Kategorie- und Rollen-IDs existieren',
  });

  const cards = await auditGuildCards(guild).catch(() => null);
  if (!cards) {
    sections.push({ label: 'Karten/Pins', ok: false, detail: 'Pins konnten nicht gelesen werden' });
  } else {
    const botId = guild.client.user?.id ?? '';
    const dupes = findDuplicateCards(
      cards.messages.map((m) => ({ id: m.messageId, channelId: m.channelId, authorId: botId, embeds: m.embeds ?? [] })),
      botId,
    );
    const name = (id: string): string => `#${guild.channels.cache.get(id)?.name ?? id}`;
    const problems = [
      ...cards.findings.map(describeFinding),
      ...dupes.map((d) => `${name(d.channelId)}: „${d.title}“ ${d.messageIds.length}× angeheftet`),
    ];
    sections.push({
      label: 'Karten/Pins',
      ok: problems.length === 0,
      detail: problems.length
        ? list(`${problems.length} Problem(e) in ${cards.scanned} Bot-Karten:`, problems, 'discord-cards.js --check')
        : `${cards.scanned} Bot-Karten ohne tote Links, unbekannte Befehle oder Doppelte`,
    });
  }

  if (guild.features.includes('COMMUNITY')) {
    const id = guild.publicUpdatesChannelId;
    const ch = id ? idx.channels.get(id) : undefined;
    const archived = !!ch && !!idx.archiveId && ch.parentId === idx.archiveId;
    sections.push({
      label: 'Community-Updates-Kanal',
      ok: !!ch && !archived,
      detail: !id ? 'nicht gesetzt' : !ch ? `Kanal ${id} existiert nicht` : archived ? `#${ch.name} liegt im Archiv` : `#${ch.name}${ch.name === CHANNEL.announcements ? '' : ' (bewusst gesetzt, wird nie automatisch geändert)'}`,
    });
  }
  return sections;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const BOOT_DELAY_MS = 15 * 60 * 1000;
const bootedAt = Date.now();
let lastRunAt: number | null = null;

/** Hourly tick; runs once a day (first run 15 min after boot). Posts only on failure. */
export async function runDailySelfCheckTick(now = Date.now()): Promise<void> {
  if (lastRunAt === null ? now - bootedAt < BOOT_DELAY_MS : now - lastRunAt < DAY_MS) return;
  lastRunAt = now;
  const guild = getClient().guilds.cache.get(config.DISCORD_GUILD_ID);
  if (!guild) return;
  const sections = await runSelfCheck(guild);
  const failed = sections.filter((s) => !s.ok);
  if (failed.length === 0) {
    logger.info({ sections: sections.length }, 'daily self-check green');
    return;
  }
  const channelId = getChannel('modLog') ?? guild.channels.cache.find((c) => c.name === CHANNEL.logs)?.id;
  const channel = channelId ? ((await guild.channels.fetch(channelId).catch(() => null)) as TextChannel | null) : null;
  if (!channel?.isTextBased()) {
    logger.warn({ failed: failed.map((s) => s.label) }, 'daily self-check failed, logs channel missing');
    return;
  }
  const embed = new EmbedBuilder()
    .setColor(Colors.warn)
    .setTitle(`🩺 Täglicher Selbsttest · ${failed.length} Problem(e)`)
    .setDescription(truncate(failed.map((s) => `⚠️ **${s.label}:** ${s.detail}`).join('\n\n'), 4096))
    .setFooter({ text: 'MagguuBot · Selbsttest · /doctor für Details' })
    .setTimestamp(new Date(now));
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}
