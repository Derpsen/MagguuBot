/**
 * Channel topics = layout purpose text (STRUCTURE in server-layout.ts) plus, for channels
 * with `liveCounter`, ` · <counter>` maintained by src/discord/channel-topics.ts.
 * Pure helpers shared by the updater, rollout planner and acceptance.
 */

export const TOPIC_SEP = ' · ';
const MAX_TOPIC = 1024;

export function composeTopic(purpose: string, counter: string | null): string {
  const text = counter ? `${purpose}${TOPIC_SEP}${counter}` : purpose;
  return text.length > MAX_TOPIC ? text.slice(0, MAX_TOPIC) : text;
}

/** Live topic is correct: exact purpose, or (live-counter channel) purpose + ` · ` + counter. */
export function topicMatches(live: string | null | undefined, purpose: string, liveCounter = false): boolean {
  const t = live ?? '';
  if (t === purpose) return true;
  return liveCounter && t.startsWith(purpose + TOPIC_SEP) && t.length > purpose.length + TOPIC_SEP.length;
}

export type TopicCounter =
  | { kind: 'requests'; pending: number }
  | { kind: 'approvals'; pending: number }
  | { kind: 'health'; errors: number; warnings: number }
  | { kind: 'downloads'; queued: number };

/** German counter text (no emoji variation selectors). */
export function counterText(c: TopicCounter): string {
  switch (c.kind) {
    case 'requests':
      return `${c.pending} offen`;
    case 'approvals':
    case 'downloads':
      return `${c.kind === 'approvals' ? c.pending : c.queued} in der Queue`;
    case 'health':
      if (c.errors > 0) return `🔴 ${c.errors} Fehler`;
      if (c.warnings > 0) return `🟡 ${c.warnings} ${c.warnings === 1 ? 'Warnung' : 'Warnungen'}`;
      return '🟢 alles ok';
  }
}

/** Discord allows 2 name/topic edits per channel per 10 min; stay well below. */
export const MIN_TOPIC_EDIT_INTERVAL_MS = 6 * 60_000;

/** Decide whether to PATCH now: only on a real text change and outside the per-channel cooldown. */
export function shouldEditTopic(current: string | null | undefined, next: string, lastEditAt: number | undefined, now: number): boolean {
  if ((current ?? '') === next) return false;
  return lastEditAt === undefined || now - lastEditAt >= MIN_TOPIC_EDIT_INTERVAL_MS;
}
