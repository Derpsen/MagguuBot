import type { Context } from 'hono';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { parseTrustedProxies, resolveClientIp } from '../utils/trusted-proxy.js';

const trusted = parseTrustedProxies(config.TRUSTED_PROXIES);

if (trusted.invalid.length > 0) {
  logger.warn({ invalid: trusted.invalid }, 'TRUSTED_PROXIES: ignoring invalid entries');
}
if (config.TRUST_PROXY && trusted.cidrs.length === 0) {
  logger.warn(
    'TRUST_PROXY=true without TRUSTED_PROXIES: proxy headers stay untrusted; set TRUSTED_PROXIES to the reverse proxy IP/CIDR',
  );
}

function socketIp(c: Context): string | undefined {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress;
}

/** Client IP for rate-limit keys and audit rows; null when the socket address is unknown. */
export function clientIp(c: Context): string | null {
  return resolveClientIp(socketIp(c), (name) => c.req.header(name), trusted.cidrs);
}
