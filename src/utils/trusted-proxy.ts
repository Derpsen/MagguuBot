/**
 * Trusted-proxy client-IP resolution (pure, unit tested; ported from
 * MagguuUI-Website 0f1c7ef server/utils/trustedProxy.ts).
 *
 * `cf-connecting-ip` / `x-forwarded-for` / `x-real-ip` are believed only when
 * the TCP peer is listed in TRUSTED_PROXIES. The container sits on br0 and is
 * reachable directly from the LAN, so a plain on/off switch would let any
 * direct client pick its own webhook rate-limit key.
 *
 * TRUSTED_PROXIES: comma/space separated IPs or CIDRs (e.g. the cloudflared
 * address `192.168.178.19`). Keywords: `private` (loopback + RFC1918 + IPv6
 * ULA/link-local), `none`. Unset or empty = none (socket IP only).
 */

const PRIVATE_RANGES = [
  '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16',
  '::1/128', 'fc00::/7', 'fe80::/10',
];

export interface Cidr { v6: boolean; bits: bigint; prefix: number }

function stripMapped(ip: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return m?.[1] ?? ip;
}

function parseIp(raw: string): { v6: boolean; bits: bigint } | null {
  const ip = stripMapped(raw.trim().replace(/^\[|\]$/g, '').split('%')[0] ?? '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return { v6: false, bits: parts.reduce((acc, n) => (acc << 8n) | BigInt(n), 0n) };
  }
  if (!ip.includes(':') || !/^[0-9a-f:]+$/i.test(ip)) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(Math.max(0, missing)).fill('0'), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return { v6: true, bits: groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n) };
}

function parseCidr(entry: string): Cidr | null {
  const [addr = '', len, extra] = entry.split('/');
  if (extra !== undefined) return null;
  const ip = parseIp(addr);
  if (!ip) return null;
  const max = ip.v6 ? 128 : 32;
  const prefix = len === undefined ? max : Number(len);
  if (len === '' || !Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  return { ...ip, prefix };
}

export interface TrustedProxyList { cidrs: Cidr[]; invalid: string[] }

export function parseTrustedProxies(value: string | undefined): TrustedProxyList {
  const cidrs: Cidr[] = [];
  const invalid: string[] = [];
  for (const token of (value ?? '').split(/[\s,]+/).filter(Boolean)) {
    const lower = token.toLowerCase();
    if (lower === 'none') continue;
    if (lower === 'private') {
      for (const range of PRIVATE_RANGES) {
        const cidr = parseCidr(range);
        if (cidr) cidrs.push(cidr);
      }
      continue;
    }
    const cidr = parseCidr(token);
    if (cidr) cidrs.push(cidr);
    else invalid.push(token);
  }
  return { cidrs, invalid };
}

export function isTrustedProxy(ip: string | undefined | null, trusted: readonly Cidr[]): boolean {
  if (!ip) return false;
  const parsed = parseIp(ip);
  if (!parsed) return false;
  return trusted.some((c) => {
    if (c.v6 !== parsed.v6) return false;
    const shift = BigInt((c.v6 ? 128 : 32) - c.prefix);
    return (parsed.bits >> shift) === (c.bits >> shift);
  });
}

function normaliseIp(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  return parseIp(value) ? stripMapped(value) : null;
}

/**
 * Client IP for rate limiting/audit. Headers count only when the socket peer is
 * a trusted proxy and they hold a syntactically valid IP. For X-Forwarded-For
 * the chain is walked right to left, skipping trusted hops, so a client-supplied
 * left-most entry cannot choose the key.
 */
export function resolveClientIp(
  socketIp: string | undefined | null,
  header: (name: string) => string | undefined,
  trusted: readonly Cidr[],
): string | null {
  const socket = socketIp ?? null;
  if (!socket || !isTrustedProxy(socket, trusted)) return socket;

  const cf = normaliseIp(header('cf-connecting-ip'));
  if (cf) return cf;

  const chain = (header('x-forwarded-for') ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  for (let i = chain.length - 1; i >= 0; i--) {
    const hop = normaliseIp(chain[i]);
    if (!hop) break;
    if (!isTrustedProxy(hop, trusted)) return hop;
  }

  const real = normaliseIp(header('x-real-ip'));
  if (real) return real;
  return socket;
}
