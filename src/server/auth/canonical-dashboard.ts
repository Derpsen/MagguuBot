/**
 * OAuth cookies use the `__Host-` prefix and therefore only exist on the
 * configured public HTTPS host. Keep all browser-facing dashboard navigation
 * on that host, even when somebody starts from a Docker/Unraid LAN URL.
 */
export function isCanonicalDashboardHost(
  dashboardBaseUrl: string,
  requestHost: string | undefined,
  requestUrl?: string,
): boolean {
  const expectedHost = new URL(dashboardBaseUrl).host.toLowerCase();
  const actualHost = normalizeHost(requestHost ?? hostFromUrl(requestUrl));
  return actualHost === expectedHost;
}

export interface DashboardRequestLocation {
  requestHost: string | undefined;
  requestUrl: string;
  forwardedHost?: string;
  forwardedProto?: string;
}

/**
 * Accept either a directly served HTTPS request or the exact public
 * host/protocol reported by a TLS-terminating reverse proxy. These headers are
 * used only for canonical navigation, never for authentication or client IPs.
 */
export function isCanonicalDashboardRequest(
  dashboardBaseUrl: string,
  location: DashboardRequestLocation,
): boolean {
  const forwardedHost = firstForwardedValue(location.forwardedHost);
  const hostMatches = [
    location.requestHost,
    forwardedHost,
    hostFromUrl(location.requestUrl),
  ].some((host) => isCanonicalDashboardHost(dashboardBaseUrl, host));
  if (!hostMatches) return false;

  const protocol = normalizeProtocol(
    firstForwardedValue(location.forwardedProto) ?? protocolFromUrl(location.requestUrl),
  );
  return protocol === 'https:';
}

/** Build a public dashboard URL while retaining only the request path/query. */
export function canonicalDashboardUrl(dashboardBaseUrl: string, requestUrl: string): string {
  const base = new URL(dashboardBaseUrl);
  const request = new URL(requestUrl, base.origin);
  return `${base.origin}${request.pathname}${request.search}`;
}

export function canonicalDashboardPath(dashboardBaseUrl: string, path: string): string {
  const base = new URL(dashboardBaseUrl);
  const target = new URL(path, `${base.origin}/`);
  return `${base.origin}${target.pathname}${target.search}`;
}

function hostFromUrl(requestUrl: string | undefined): string | undefined {
  if (!requestUrl) return undefined;
  try {
    return new URL(requestUrl).host;
  } catch {
    return undefined;
  }
}

function protocolFromUrl(requestUrl: string): string | undefined {
  try {
    return new URL(requestUrl).protocol;
  } catch {
    return undefined;
  }
}

function firstForwardedValue(value: string | undefined): string | undefined {
  const first = value?.split(',')[0]?.trim();
  return first || undefined;
}

function normalizeProtocol(protocol: string | undefined): string {
  if (!protocol) return '';
  const normalized = protocol.trim().toLowerCase().replace(/:$/, '');
  return normalized ? `${normalized}:` : '';
}

function normalizeHost(host: string | undefined): string {
  if (!host) return '';
  try {
    // URL parsing normalises case and default HTTPS ports (`:443`).
    return new URL(`https://${host.trim()}`).host.toLowerCase();
  } catch {
    return host.trim().toLowerCase();
  }
}
