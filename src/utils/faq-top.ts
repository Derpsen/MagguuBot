import { EmbedBuilder } from 'discord.js';
import { Colors, truncate } from '../embeds/colors.js';
import type { FaqEntry } from './faq-matcher.js';
import { neutralizeMentions } from './faq-search.js';
import { clipPlexText, escapePlexMarkdown } from './plex-card.js';
import { localScheduleParts } from './schedule.js';

/** Weekly FAQ top: pure part (usage aggregation, week window, embed). No Discord, no network, no DB. */

export const FAQ_TOP_FOOTER = 'MagguuBot · FAQ der Woche';
/** Below this many FAQ uses in the week nothing is posted ("only when there is data"). */
export const FAQ_TOP_MIN_USES = 3;
/** The top entry plus up to this many more. */
export const FAQ_TOP_MAX_LISTED = 5;
const MAX_QUESTION = 200;
const MAX_LIST_QUESTION = 90;

export type FaqUsageSourceKey = 'command' | 'autocomplete' | 'autoanswer';
export const FAQ_USAGE_SOURCES: readonly FaqUsageSourceKey[] = ['command', 'autocomplete', 'autoanswer'];

/** One aggregated counter row as stored: no user, channel or message data. */
export interface FaqUsageRow {
  faqId: number;
  source: string;
  count: number;
}

export interface FaqUsageEntry {
  faqId: number;
  uses: number;
  bySource: Record<FaqUsageSourceKey, number>;
}

export interface FaqUsageSummary {
  total: number;
  bySource: Record<FaqUsageSourceKey, number>;
  /** Most used first (ties: lower id first). */
  ranked: FaqUsageEntry[];
}

export interface FaqStatusBlock {
  windowDays: number;
  total: number;
  bySource: FaqUsageSummary['bySource'];
  top: { id: number; title: string | null; count: number }[];
}

function emptySources(): Record<FaqUsageSourceKey, number> {
  return { command: 0, autocomplete: 0, autoanswer: 0 };
}

function isSource(value: string): value is FaqUsageSourceKey {
  return (FAQ_USAGE_SOURCES as readonly string[]).includes(value);
}

/** Sums counter rows per FAQ entry; `known` (when given) drops entries that no longer exist. */
export function summarizeFaqUsage(rows: readonly FaqUsageRow[], known?: ReadonlySet<number>): FaqUsageSummary {
  const byId = new Map<number, FaqUsageEntry>();
  const bySource = emptySources();
  let total = 0;
  for (const row of rows) {
    if (!isSource(row.source) || !Number.isFinite(row.count) || row.count <= 0) continue;
    if (known && !known.has(row.faqId)) continue;
    let entry = byId.get(row.faqId);
    if (!entry) {
      entry = { faqId: row.faqId, uses: 0, bySource: emptySources() };
      byId.set(row.faqId, entry);
    }
    entry.uses += row.count;
    entry.bySource[row.source] += row.count;
    bySource[row.source] += row.count;
    total += row.count;
  }
  const ranked = [...byId.values()].sort((a, b) => b.uses - a.uses || a.faqId - b.faqId);
  return { total, bySource, ranked };
}

function shiftDay(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + delta)).toISOString().slice(0, 10);
}

/** The seven full local days before the slot's day (a Monday slot covers Monday to Sunday of the week before). */
export function faqTopWindow(scheduledAt: number, timeZone: string): { fromDay: string; toDay: string } {
  const slotDay = localScheduleParts(new Date(scheduledAt), timeZone).dateKey;
  return { fromDay: shiftDay(slotDay, -7), toDay: shiftDay(slotDay, -1) };
}

function germanDay(dayKey: string): string {
  const [y, m, d] = dayKey.split('-');
  return `${d}.${m}.${y}`;
}

function question(entry: FaqEntry, max: number): string {
  return escapePlexMarkdown(neutralizeMentions(clipPlexText(entry.question, max)));
}

export interface FaqTopInput {
  summary: FaqUsageSummary;
  entries: readonly FaqEntry[];
  fromDay: string;
  toDay: string;
  pageUrl: string;
}

/** Null when there is not enough data (nothing is posted then). */
export function buildFaqTopEmbed(input: FaqTopInput): EmbedBuilder | null {
  const byId = new Map(input.entries.map((e) => [e.id, e]));
  const { summary } = input;
  if (summary.total < FAQ_TOP_MIN_USES) return null;
  const listed = summary.ranked.filter((r) => byId.has(r.faqId)).slice(0, FAQ_TOP_MAX_LISTED);
  const top = listed[0];
  const topEntry = top ? byId.get(top.faqId) : undefined;
  if (!top || !topEntry) return null;

  const times = (n: number): string => (n === 1 ? '1×' : `${n}×`);
  const lines = [
    `Häufigste Frage vom ${germanDay(input.fromDay)} bis ${germanDay(input.toDay)}:`,
    '',
    `**${question(topEntry, MAX_QUESTION)}**`,
    `${times(top.uses)} abgerufen`,
  ];
  const embed = new EmbedBuilder()
    .setColor(Colors.info)
    .setTitle('📚 FAQ der Woche')
    .setURL(input.pageUrl)
    .setDescription(truncate(`${lines.join('\n')}\n\nAlle Fragen: ${input.pageUrl}`, 4096))
    .setFooter({ text: FAQ_TOP_FOOTER });

  const others = listed.slice(1);
  if (others.length > 0) {
    embed.addFields({
      name: 'Weitere beliebte Fragen',
      value: truncate(
        others
          .map((r, i) => {
            const e = byId.get(r.faqId);
            return `${i + 2}. ${e ? question(e, MAX_LIST_QUESTION) : '?'} · ${times(r.uses)}`;
          })
          .join('\n'),
        1024,
      ),
    });
  }
  const s = summary.bySource;
  const parts = [`${summary.total} Abrufe`];
  if (s.command > 0) parts.push(`/faq-Suche ${s.command}`);
  if (s.autocomplete > 0) parts.push(`/faq-Auswahl ${s.autocomplete}`);
  if (s.autoanswer > 0) parts.push(`Auto-Antwort ${s.autoanswer}`);
  embed.addFields({ name: 'Nutzung', value: truncate(parts.join(' · '), 1024) });
  return embed;
}
