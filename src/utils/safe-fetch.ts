import { lookup } from 'node:dns/promises';

function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return true;
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
  // IPv4-mapped IPv6
  if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7));
  return false;
}

async function assertSafeUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`SSRF: blocked protocol ${parsed.protocol}`);
  }
  const hostname = parsed.hostname;
  // Bare IPv4/IPv6 literal — validate directly without DNS.
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) {
    if (isPrivateIp(hostname)) {
      throw new Error(`SSRF: ${hostname} is a private IP`);
    }
    return;
  }
  const addresses = await lookup(hostname, { all: true }).catch((err: unknown) => {
    throw new Error(`DNS lookup failed for ${hostname}: ${err instanceof Error ? err.message : String(err)}`);
  });
  if (!addresses || addresses.length === 0) {
    throw new Error(`DNS: no addresses for ${hostname}`);
  }
  const blocked = addresses.find((a) => isPrivateIp(a.address));
  if (blocked) {
    throw new Error(`SSRF: ${hostname} resolves to private IP ${blocked.address}`);
  }
}

// Pre-resolve the hostname and reject if any returned IP is private. There is
// a small TOCTOU window between this lookup and undici's own resolve inside
// fetch() — a hostile DNS server doing per-resolve answers could in theory
// flip to a private IP for the second lookup. The threat model here is admin-
// pasted RSS URLs on a homelab LAN, not active DNS-rebinding attackers, so
// this layer is sufficient. `redirect: 'manual'` rejects 3xx so a rogue
// upstream can't bounce us toward an internal host on a follow-up request
// without going through this guard again.
export async function safeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  await assertSafeUrl(url);
  return fetch(url, { ...init, redirect: 'manual' });
}

export { isPrivateIp };
