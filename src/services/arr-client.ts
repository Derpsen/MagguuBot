import { logger } from '../utils/logger.js';
import { buildServiceUrl } from './service-url.js';

// Without a timeout, a hung Sonarr/Radarr keeps the slash-command interaction
// pending until Discord's 15-minute token expires. 10s is generous for *arr
// REST APIs on a homelab LAN.
const REQUEST_TIMEOUT_MS = 10_000;

export class ArrClient {
  constructor(
    private readonly name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = buildServiceUrl(this.baseUrl, path);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        logger.error({ service: this.name, method, path, status: res.status, text }, 'arr request failed');
        throw new Error(`${this.name} ${method} ${path} → ${res.status}`);
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
