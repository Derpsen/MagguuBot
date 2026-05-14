// Strip likely-sensitive fields out of webhook payloads before they go into
// the activity log. Upstream services occasionally include API keys, internal
// hostnames, or session tokens in their payloads — particularly Seerr issues
// and GitHub events that quote raw user input. The activity log is visible in
// the dashboard and persisted for 30d, so it's the wrong place to keep them.

const REDACTED = '[redacted]';
const MAX_DEPTH = 12;
const MAX_NODES = 5_000;

const SENSITIVE_KEY = /(?:^|[._-])(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|client[_-]?secret|secret|password|passwd|authorization|auth|bearer|cookie|session|private[_-]?key|webhook[_-]?secret|x[_-]?api[_-]?key|x[_-]?magguu[_-]?token)$/i;

interface Counter {
  n: number;
}

export function sanitizePayload(input: unknown): unknown {
  const counter: Counter = { n: 0 };
  return walk(input, 0, counter);
}

function walk(value: unknown, depth: number, counter: Counter): unknown {
  counter.n += 1;
  if (counter.n > MAX_NODES) return REDACTED;
  if (depth > MAX_DEPTH) return REDACTED;
  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') return value;

  if (Array.isArray(value)) {
    return value.map((v) => walk(v, depth + 1, counter));
  }

  if (t === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = walk(raw, depth + 1, counter);
    }
    return out;
  }

  return REDACTED;
}
