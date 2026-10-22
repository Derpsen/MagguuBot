import type { Guild } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { welcomeMessages } from '../db/schema.js';
import { commandIndex, resolveChannelRefs, type CardContext, type CommandInfo } from '../embeds/cards.js';
import { auditMessages, type AuditFinding, type AuditMessage } from '../utils/card-audit.js';
import { ARCHIVE_CATEGORY_NAME } from './server-layout.js';
import { listTicketCategories } from './ticket-categories.js';

interface RawOption { type: number; name: string; options?: RawOption[] }

const CATEGORY = 4;

/** Ids of all channels that are valid mention targets: not a category, not inside 🗄️ ARCHIV. */
export function activeChannelIds(guild: Guild): Set<string> {
  const archive = guild.channels.cache.find((c) => c.type === CATEGORY && c.name === ARCHIVE_CATEGORY_NAME)?.id ?? null;
  return new Set(
    [...guild.channels.cache.values()]
      .filter((c) => c.type !== CATEGORY && (!archive || c.parentId !== archive))
      .map((c) => c.id),
  );
}

function rawOptions(options: ReadonlyArray<{ type: number; name: string; options?: ReadonlyArray<unknown> }>): RawOption[] {
  return options.map((o) => ({
    type: o.type,
    name: o.name,
    options: o.options ? rawOptions(o.options as ReadonlyArray<{ type: number; name: string }>) : undefined,
  }));
}

/** Registered guild commands; falls back to the local definitions when none are registered. */
export async function guildCommandIndex(guild: Guild): Promise<Map<string, CommandInfo>> {
  const registered = await guild.commands.fetch().catch(() => null);
  if (registered && registered.size) {
    return commandIndex([...registered.values()].map((c) => ({
      name: c.name,
      options: rawOptions(c.options as unknown as ReadonlyArray<{ type: number; name: string }>),
    })));
  }
  // Dynamic import: commands/index.ts imports this module's consumers.
  const { commands } = await import('./commands/index.js');
  return commandIndex([...commands.values()].map((c) => c.data.toJSON() as { name: string; options?: RawOption[] }));
}

export async function cardContextForGuild(guild: Guild, layoutIds: Record<string, string | undefined>): Promise<CardContext> {
  return {
    channels: resolveChannelRefs(layoutIds, activeChannelIds(guild)),
    commands: await guildCommandIndex(guild),
    ticketCategories: listTicketCategories(),
  };
}

/**
 * Doctor check: bot-authored pins in active text channels plus tracked card messages,
 * audited for dead `<#id>` mentions and unknown slash commands. Read-only.
 */
export async function auditGuildCards(guild: Guild): Promise<{ scanned: number; findings: AuditFinding[]; messages: AuditMessage[] }> {
  const active = activeChannelIds(guild);
  const botId = guild.client.user?.id;
  const messages: AuditMessage[] = [];
  for (const channel of guild.channels.cache.values()) {
    if (!active.has(channel.id) || !channel.isTextBased() || !('messages' in channel)) continue;
    const pins = await channel.messages.fetchPins().catch(() => null);
    for (const pin of pins?.items ?? []) {
      const msg = pin.message;
      if (msg.author.id !== botId) continue;
      messages.push({ channelId: channel.id, channelName: channel.name, messageId: msg.id, pinned: true, content: msg.content, embeds: msg.embeds.map((e) => e.toJSON()) });
    }
  }
  const tracked = db.select().from(welcomeMessages).where(eq(welcomeMessages.guildId, guild.id)).all();
  for (const row of tracked) {
    if (messages.some((m) => m.messageId === row.messageId)) continue;
    const channel = guild.channels.cache.get(row.channelId);
    if (!channel?.isTextBased() || !('messages' in channel)) continue;
    const msg = await channel.messages.fetch(row.messageId).catch(() => null);
    if (!msg || msg.author.id !== botId) continue;
    messages.push({ channelId: channel.id, channelName: channel.name, messageId: msg.id, content: msg.content, embeds: msg.embeds.map((e) => e.toJSON()) });
  }
  return { scanned: messages.length, findings: auditMessages(messages, active, await guildCommandIndex(guild)), messages };
}
