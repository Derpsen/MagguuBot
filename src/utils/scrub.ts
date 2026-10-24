import pino from 'pino';

/**
 * Keeps credentials out of logs. Some services take the key in the request URL (Tautulli `?apikey=`),
 * and fetch/undici errors, `cause` chains and stacks may carry that URL. Everything goes through
 * `scrubString`: registered literal secrets, `key=value` query/params, URL userinfo and bearer values.
 */

const literals = new Set<string>();

/** Registers an exact secret value that must never appear in a log line (values < 6 chars are ignored). */
export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 6) literals.add(value);
}

export function clearRegisteredSecretsForTests(): void {
  literals.clear();
}

const PARAM = /(^|[?&;,\s"'(])((?:x-plex-token|api[_-]?key|apikey|access[_-]?token|token|password|passwd|secret|key)=)([^&\s"'<>)]*)/gi;
// Anchored on the `://` and looking BACK for the scheme: a leading `(\b[a-z][a-z0-9+.-]*:\/\/)` retried the whole
// scheme-charset run from every word boundary (`a.a.a.`/`-token-token` = quadratic, 200 kB ran into a timeout). A run can
// only be re-scanned once per `://` and `://` cannot be part of a run, so the total work stays linear.
const USERINFO = /(?<=\b[a-z][a-z0-9+.-]*)(:\/\/)[^\s/@"'<>]+@/gi;
const BEARER = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi;
// Bare credentials that show up in free text (error messages, response bodies), without any `key=` hint.
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})/g;
const JWT = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]*)?/g;
// `/webhooks/<id>/<token>` with or without the `/api[/vN]` prefix (relative paths, proxies, `discord.com/webhooks/...`).
const DISCORD_WEBHOOK = /(\/webhooks\/\d+\/)[A-Za-z0-9._-]+/gi;
// Discord bot token: base64(user id) `.` timestamp `.` hmac, e.g. `MTIz...abc.GhIjKl.xxxxxxxx...` (first char M/N/O for numeric ids).
const DISCORD_BOT_TOKEN = /\b[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,40}(?![A-Za-z0-9_-])/g;
// JSON bodies: `"password":"x"`, `"api_key": "x"` (string values only; escaped quotes handled).
const JSON_SECRET = /("(?:password|passwd|passphrase|secret|client[_-]?secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|x-api-key|x-plex-token|authorization)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;
// `password: xyz`, `secret = "xyz"`, `passwd is xyz` (a following already-redacted value stays redacted).
const FREETEXT_SECRET = /\b(password|passwd|passphrase|secret)\b(\s*[:=]\s*|\s+is\s+)("[^"]*"|'[^']*'|[^\s,;"'&]+)/gi;
// Header/field style free text: `token: xyz`, `api_key = xyz`, `X-Api-Key: xyz` (colon or equals only, so "token expired" stays readable);
// an optional `Bearer`/`Basic` scheme in front is part of the value.
const FREETEXT_KEY = /(?<![\w-])(x-api-key|x-plex-token|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|token)(?![\w-])(\s*[:=]\s*)((?:(?:bearer|basic)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;"'&]+))/gi;

/**
 * Upper bound of text one scrub call looks at (defence in depth against pathological inputs; real log lines are a few
 * kB). Longer input is cut BEFORE any pattern runs and ends with a marker, so nothing past the cut can leak.
 */
export const MAX_SCRUB_LENGTH = 262_144;

export function scrubString(input: string): string {
  let out = input;
  if (out.length > MAX_SCRUB_LENGTH) {
    let cut = MAX_SCRUB_LENGTH;
    const last = out.charCodeAt(cut - 1);
    if (last >= 0xd800 && last <= 0xdbff) cut -= 1; // never split a surrogate pair
    out = `${out.slice(0, cut)}…[truncated ${input.length - cut} chars]`;
  }
  for (const secret of literals) {
    if (out.includes(secret)) out = out.split(secret).join('[redacted]');
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret && out.includes(encoded)) out = out.split(encoded).join('[redacted]');
  }
  return out
    .replace(DISCORD_WEBHOOK, '$1[redacted]')
    .replace(DISCORD_BOT_TOKEN, '[redacted]')
    .replace(GITHUB_TOKEN, '[redacted]')
    .replace(JWT, '[redacted]')
    .replace(JSON_SECRET, '$1"[redacted]"')
    .replace(PARAM, '$1$2[redacted]')
    .replace(FREETEXT_SECRET, '$1$2[redacted]')
    .replace(FREETEXT_KEY, '$1$2[redacted]')
    .replace(USERINFO, '$1[redacted]@')
    .replace(BEARER, '$1 [redacted]');
}

const SENSITIVE_KEY = /^(authorization|proxy-authorization|x-plex-token|x-api-key|api[_-]?key|apikey|access[_-]?token|token|password|passwd|secret|cookie|set-cookie)$/i;
const MAX_DEPTH = 6;

/** Deep copy with every string scrubbed (objects, arrays, nested `cause`/`config`); cycles are cut. */
export function scrubValue(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[truncated]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) && typeof v === 'string' ? '[redacted]' : scrubValue(v, depth + 1, seen);
  }
  return out;
}

/** pino `err` serializer: standard error shape (message, stack, cause chain, extra props) with secrets scrubbed. */
export function errSerializer(err: unknown): unknown {
  const base = err instanceof Error ? pino.stdSerializers.err(err) : err;
  return scrubValue(base);
}
