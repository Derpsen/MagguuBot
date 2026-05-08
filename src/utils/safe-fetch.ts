import { lookup } from 'node:dns/promises';
import { Agent } from 'undici';

function isPrivateIp(ip: string): boolean {
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return true;
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
  // IPv4-mapped IPv6
  if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7));
  return false;
}

// Per-process safe dispatcher: every TCP connect runs through `connect.lookup`,
// so the IP that gets connected to is the same one we validate. Eliminates the
// double-resolve TOCTOU window of validating the hostname then handing it to
// fetch().
const safeDispatcher = new Agent({
  connect: {
    lookup(hostname, opts, cb): void {
      // bare-IP hostnames bypass DNS entirely; validate directly.
      if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) {
        if (isPrivateIp(hostname)) {
          cb(new Error(`SSRF: hostname is a private IP (${hostname})`), '', 0);
          return;
        }
        cb(null, hostname, /^[\d.]+$/.test(hostname) ? 4 : 6);
        return;
      }
      lookup(hostname, { all: true, family: opts?.family ?? 0 })
        .then((addresses) => {
          const safe = addresses.find((a) => !isPrivateIp(a.address));
          if (!safe) {
            cb(new Error(`SSRF: hostname ${hostname} resolves only to private IPs`), '', 0);
            return;
          }
          cb(null, safe.address, safe.family);
        })
        .catch((err) => cb(err, '', 0));
    },
  },
});

export async function safeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`SSRF: blocked protocol ${parsed.protocol}`);
  }
  // Reject 3xx so an upstream redirect can't escape the safe dispatcher
  // (each new connection still goes through it, but 'manual' makes that
  // explicit and lets us audit the redirect chain).
  return fetch(url, {
    ...init,
    redirect: 'manual',
    dispatcher: safeDispatcher,
  } as RequestInit & { dispatcher: typeof safeDispatcher });
}

export { isPrivateIp };
