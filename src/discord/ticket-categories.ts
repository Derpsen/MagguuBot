import { and, asc, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { ticketCategories, type TicketCategory } from '../db/schema.js';

export interface ResolvedTicketCategory {
  key: string;
  label: string;
  emoji: string;
  description: string;
  pingRoles: string[];
}

const DEFAULT_CATEGORIES: ResolvedTicketCategory[] = [
  {
    key: 'support',
    label: 'Allgemeiner Support',
    emoji: '❓',
    description: 'Fragen zum Server, allgemeine Hilfe',
    pingRoles: [],
  },
  {
    key: 'plex',
    label: 'Plex / Streaming-Problem',
    emoji: '🎬',
    description: 'Buffering, Audio, Untertitel, Login',
    pingRoles: ['Admin'],
  },
  {
    key: 'request',
    label: 'Film / Serie nicht in Library',
    emoji: '📥',
    description: 'Request, der nicht durchgeht oder dauert',
    pingRoles: ['Admin'],
  },
  {
    key: 'report',
    label: 'User melden',
    emoji: '🚨',
    description: 'Spam, Beleidigung, Regelverstoß',
    pingRoles: ['Admin', 'Moderator'],
  },
  {
    key: 'bug',
    label: 'Bot-Bug / Feature-Wunsch',
    emoji: '🐛',
    description: 'Etwas funktioniert nicht oder Vorschlag',
    pingRoles: [],
  },
  {
    key: 'other',
    label: 'Sonstiges',
    emoji: '💬',
    description: 'Alles was sonst nicht passt',
    pingRoles: [],
  },
];

export function listTicketCategories(): ResolvedTicketCategory[] {
  const rows = db
    .select()
    .from(ticketCategories)
    .where(and(eq(ticketCategories.guildId, config.DISCORD_GUILD_ID), eq(ticketCategories.enabled, true)))
    .orderBy(asc(ticketCategories.sortOrder))
    .all();
  if (rows.length === 0) return DEFAULT_CATEGORIES;
  return rows.map(rowToResolved);
}

export function getTicketCategory(key: string): ResolvedTicketCategory | undefined {
  return listTicketCategories().find((c) => c.key === key);
}

function rowToResolved(row: TicketCategory): ResolvedTicketCategory {
  return {
    key: row.key,
    label: row.label,
    emoji: row.emoji ?? '📩',
    description: row.description ?? '',
    pingRoles: row.pingRoles ? row.pingRoles.split(',').map((s) => s.trim()).filter(Boolean) : [],
  };
}
