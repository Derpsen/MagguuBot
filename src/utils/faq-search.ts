import type { FaqEntry } from './faq-matcher.js';

/**
 * Fuzzy token search over the website FAQ for `/faq suche:` and its autocomplete. Pure and in-memory:
 * titles (the questions) weigh most, then the category, then words from the answer as keywords.
 * Handles umlauts (ä → a, ß → ss), plurals, prefixes ("install" → "installation") and small typos.
 */

export const MAX_FAQ_CHOICES = 25;
export const FAQ_CHOICE_MAX = 100;

const CONTROL_AND_INVISIBLE = /[\u0000-\u001f\u007f\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

export function normalizeFaqText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ');
}

function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/** Search tokens: no stopword removal (a short query must still work), tokens of 1 char are dropped. */
export function searchTokens(text: string): string[] {
  const out = new Set<string>();
  for (const raw of normalizeFaqText(text).split(/[^\p{L}\p{N}.]+/u)) {
    const t = raw.replace(/^\.+|\.+$/g, '');
    if (t.length >= 2) out.add(stem(t));
  }
  return [...out];
}

/** Optimal-string-alignment distance, bounded: returns max+1 as soon as it is exceeded. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) rows.push([i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let best = max + 1;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
  }
  return rows[a.length]![b.length]!;
}

/** How well one query token matches a pool of field tokens: 1 exact, 0.8 prefix, 0.6 typo, 0 none. */
function tokenMatch(q: string, pool: readonly string[]): number {
  let best = 0;
  const typoMax = q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0;
  for (const t of pool) {
    if (t === q) return 1;
    if (q.length >= 3 && t.startsWith(q)) best = Math.max(best, 0.8);
    else if (q.length >= 5 && q.startsWith(t) && t.length >= 4) best = Math.max(best, 0.7);
    else if (typoMax > 0 && best < 0.6 && editDistance(q, t, typoMax) <= typoMax) best = 0.6;
  }
  return best;
}

interface Indexed {
  entry: FaqEntry;
  title: string[];
  titleText: string;
  category: string[];
  keywords: string[];
}

const indexCache = new WeakMap<readonly FaqEntry[], Indexed[]>();

function buildIndex(entries: readonly FaqEntry[]): Indexed[] {
  const hit = indexCache.get(entries);
  if (hit) return hit;
  const built = entries.map((entry) => ({
    entry,
    title: searchTokens(entry.question),
    titleText: normalizeFaqText(entry.question),
    category: searchTokens(entry.category),
    keywords: searchTokens(entry.answer.slice(0, 1200)),
  }));
  indexCache.set(entries, built);
  return built;
}

export interface FaqHit {
  entry: FaqEntry;
  score: number;
}

const W_TITLE = 3;
const W_CATEGORY = 1.2;
const W_KEYWORD = 0.6;

/**
 * Ranked hits. Empty query → the first `limit` entries in site order (category, id). Otherwise every
 * query token is matched against title / category / answer keywords; at least half of the tokens must
 * match (any field), full coverage and a phrase hit in the title rank higher.
 */
export function searchFaq(query: string, entries: readonly FaqEntry[], limit: number = MAX_FAQ_CHOICES): FaqHit[] {
  const cap = Math.max(0, Math.min(limit, MAX_FAQ_CHOICES));
  const tokens = searchTokens(query);
  const indexed = buildIndex(entries);
  if (tokens.length === 0) {
    return [...indexed]
      .sort((a, b) => a.entry.category.localeCompare(b.entry.category) || a.entry.id - b.entry.id)
      .slice(0, cap)
      .map((i) => ({ entry: i.entry, score: 0 }));
  }
  const phrase = normalizeFaqText(query).trim();
  const hits: FaqHit[] = [];
  for (const doc of indexed) {
    let score = 0;
    let matched = 0;
    for (const q of tokens) {
      const inTitle = tokenMatch(q, doc.title);
      const inCategory = tokenMatch(q, doc.category);
      const inKeywords = tokenMatch(q, doc.keywords);
      const s = Math.max(inTitle * W_TITLE, inCategory * W_CATEGORY, inKeywords * W_KEYWORD);
      if (s > 0) {
        matched += 1;
        score += s;
      }
    }
    if (matched === 0 || matched < Math.ceil(tokens.length / 2)) continue;
    score *= matched / tokens.length; // partial coverage is penalised
    if (phrase.length >= 3 && doc.titleText.includes(phrase)) score += 2;
    hits.push({ entry: doc.entry, score });
  }
  hits.sort((a, b) => b.score - a.score || a.entry.id - b.entry.id);
  return hits.slice(0, cap);
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Single-line, control-free text clipped to `max` characters (code points) with an ellipsis. The cut falls on a
 * grapheme boundary, so it never splits a surrogate pair, a flag, a keycap or a ZWJ emoji sequence.
 */
export function clipChoiceText(text: string, max: number = FAQ_CHOICE_MAX): string {
  const clean = text.replace(CONTROL_AND_INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  if (Array.from(clean).length <= max) return clean;
  let kept = '';
  let count = 0;
  for (const { segment } of GRAPHEMES.segment(clean)) {
    const size = Array.from(segment).length;
    if (count + size > max - 1) break;
    kept += segment;
    count += size;
  }
  return `${kept.trimEnd()}…`;
}

export interface FaqChoice {
  name: string;
  value: string;
}

/** Autocomplete choices: ≤25, name ≤100 chars (`category · question`), value = entry id as string. */
export function faqChoices(query: string, entries: readonly FaqEntry[]): FaqChoice[] {
  return searchFaq(query, entries, MAX_FAQ_CHOICES).map(({ entry }) => ({
    name: clipChoiceText(`${entry.category} · ${entry.question}`) || String(entry.id),
    value: String(entry.id),
  }));
}

/** Neutralises mentions in untrusted text (kept readable): @everyone/@here, user/role/channel mentions. */
export function neutralizeMentions(text: string): string {
  return text
    .replace(/@(everyone|here)/gi, '@\u200b$1')
    .replace(/<(@[!&]?|#)(\d+)>/g, '<\u200b$1$2>');
}
