export interface FaqEntry {
  id: number;
  category: string;
  question: string;
  answer: string;
}

export interface FaqMatch {
  entry: FaqEntry;
  score: number;
}

export interface MatchOptions {
  minScore: number;
  minSharedTokens: number;
  minMargin: number;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = { minScore: 0.6, minSharedTokens: 2, minMargin: 0.15 };

const STOPWORDS = new Set(
  (
    'a an the and or of to in on for with is are am be do does did i me my you your it its this that there ' +
    'can could should would will how what why where which who when does have has get got any some just ' +
    'not no yes so if then than at by from as was were about into still also ' +
    'der die das ein eine einen und oder zu im in am auf für mit ist sind bin ich mich mein du dein es ' +
    'wie was warum wieso wo welche welcher welches wer wann kann könnte muss soll habe hat hab gibt ' +
    'nicht kein keine ja so wenn dann noch auch man mal bitte hallo hi hey ' +
    // The product name is in almost every question and carries no signal.
    'magguuui magguu'
  ).split(/\s+/),
);

const QUESTION_START =
  /^(how|what|why|where|which|who|when|can|could|do|does|did|is|are|should|will|wie|was|warum|wieso|weshalb|wo|welche[rsn]?|wer|wann|kann|könnt|muss|soll|gibt|geht|hat|habt|ist|sind)\b/i;

export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 8 || t.length > 400) return false;
  if (/^[!/.$]/.test(t)) return false;
  return t.includes('?') || QUESTION_START.test(t);
}

function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

export function tokenize(text: string): string[] {
  const out = new Set<string>();
  const cleaned = text
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s.]/gu, ' ');
  for (const raw of cleaned.split(/\s+/)) {
    const token = raw.replace(/^\.+|\.+$/g, '');
    if (token.length < 2 || STOPWORDS.has(token)) continue;
    out.add(stem(token));
  }
  return [...out];
}

/**
 * Conservative scoring: the share of the FAQ question's content tokens present in the message.
 * A match needs enough shared tokens, a high score, and a clear lead over the runner-up;
 * anything ambiguous returns null so the bot stays silent.
 */
export function matchFaq(
  message: string,
  entries: readonly FaqEntry[],
  options: MatchOptions = DEFAULT_MATCH_OPTIONS,
): FaqMatch | null {
  const msg = new Set(tokenize(message));
  if (msg.size === 0) return null;
  const scored: FaqMatch[] = [];
  for (const entry of entries) {
    const q = tokenize(entry.question);
    if (q.length === 0) continue;
    const shared = q.filter((t) => msg.has(t)).length;
    if (shared < Math.min(options.minSharedTokens, q.length)) continue;
    // One-word FAQ questions ("Is MagguuUI free?") only match equally short messages.
    if (q.length === 1 && msg.size > 2) continue;
    // Penalize long messages that merely mention the words among many others.
    const coverage = shared / q.length;
    const precision = shared / msg.size;
    if (precision < 0.34) continue;
    scored.push({ entry, score: 0.75 * coverage + 0.25 * precision });
  }
  scored.sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best || best.score < options.minScore) return null;
  if (second && best.score - second.score < options.minMargin) return null;
  return best;
}

export function faqAnswerToDiscord(answer: string, max = 3800): string {
  const text = answer
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const para = cut.lastIndexOf('\n');
  return `${(para > max * 0.6 ? cut.slice(0, para) : cut).trimEnd()}…`;
}

export class CooldownGate {
  private readonly seen = new Map<string, number>();

  constructor(private readonly maxEntries = 5_000) {}

  /** True when key is free (and claims it until now + ttlMs). */
  tryClaim(key: string, ttlMs: number, now = Date.now()): boolean {
    const until = this.seen.get(key);
    if (until !== undefined && until > now) return false;
    if (this.seen.size >= this.maxEntries) {
      for (const [k, v] of this.seen) if (v <= now) this.seen.delete(k);
      if (this.seen.size >= this.maxEntries) this.seen.clear();
    }
    this.seen.set(key, now + ttlMs);
    return true;
  }

  isBlocked(key: string, now = Date.now()): boolean {
    const until = this.seen.get(key);
    return until !== undefined && until > now;
  }
}
