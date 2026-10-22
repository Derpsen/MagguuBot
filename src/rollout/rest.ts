/**
 * Minimal Discord REST v10 client (rate-limit aware) and guild snapshot,
 * shared by the rollout and cards CLIs. The token is only ever placed in the
 * Authorization header; errors carry method, path, status and body only.
 */
import { sqliteHandle } from '../db/client.js';
import { isChannelKey, type ChannelKey } from '../discord/channel-store.js';
import type { RestLike } from './execute.js';
import type { GuildSnapshot, SnapChannel, SnapRole } from './plan.js';

const API = 'https://discord.com/api/v10';
const MIN_GAP_MS = 300;
/** 429s with a longer retry_after fail the step instead of blocking the CLI. */
const MAX_INLINE_RETRY_S = 30;

// ─── Minimal REST v10 client with rate-limit handling ─────────────────────
export class DiscordRest implements RestLike {
  private last = 0;
  calls = 0;
  constructor(private readonly token: string, private readonly reason = 'MagguuBot rollout (lean layout)') {}

  async request<T>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<T | null> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const wait = this.last + MIN_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      this.calls++;
      const res = await fetch(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bot ${this.token}`,
          'content-type': 'application/json',
          'user-agent': 'DiscordBot (https://github.com/Derpsen/MagguuBot, rollout)',
          ...(method === 'GET' ? {} : { 'x-audit-log-reason': encodeURIComponent(this.reason) }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as { retry_after?: number; global?: boolean };
        const retryAfter = data.retry_after ?? Number(res.headers.get('retry-after') ?? '1');
        // Long waits (e.g. channel name/topic: 2 edits per 10 min) are reported, not slept through.
        if (retryAfter > MAX_INLINE_RETRY_S) {
          throw new DiscordError(method, path, 429, `Rate-Limit, erneut versuchen in ${Math.ceil(retryAfter)} s`);
        }
        await sleep(Math.ceil(retryAfter * 1000) + 100);
        continue;
      }
      if (res.status >= 500) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (res.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(res.headers.get('x-ratelimit-reset-after') ?? '0');
        if (reset > 0) await sleep(Math.ceil(reset * 1000));
      }
      if (okStatuses.includes(res.status)) return null;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new DiscordError(method, path, res.status, text.slice(0, 500));
      }
      if (res.status === 204) return null;
      return (await res.json()) as T;
    }
    throw new DiscordError(method, path, 429, 'rate limit retries exhausted');
  }
}

export class DiscordError extends Error {
  constructor(readonly method: string, readonly path: string, readonly status: number, readonly body: string) {
    super(`${method} ${path} → HTTP ${status} ${body}`);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Snapshot ────────────────────────────────────────────────────────────
interface RawGuild {
  id: string;
  features: string[];
  rules_channel_id: string | null;
  public_updates_channel_id: string | null;
  verification_level: number;
  explicit_content_filter: number;
}
interface RawMember {
  user: { id: string; bot?: boolean };
  roles: string[];
}

export async function takeSnapshot(rest: DiscordRest, guildId: string): Promise<{ snap: GuildSnapshot; notes: string[] }> {
  const notes: string[] = [];
  const me = (await rest.request<{ id: string }>('GET', '/users/@me')) as { id: string };
  const guild = (await rest.request<RawGuild>('GET', `/guilds/${guildId}`)) as RawGuild;
  const channels = ((await rest.request<SnapChannel[]>('GET', `/guilds/${guildId}/channels`)) ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    parent_id: c.parent_id ?? null,
    position: c.position,
    topic: c.topic ?? null,
    permission_overwrites: (c.permission_overwrites ?? []).map((o) => ({ id: o.id, type: Number(o.type) as 0 | 1, allow: String(o.allow), deny: String(o.deny) })),
  }));
  const roles = ((await rest.request<SnapRole[]>('GET', `/guilds/${guildId}/roles`)) ?? []).map((r) => ({
    id: r.id, name: r.name, color: r.color, position: r.position, permissions: String(r.permissions),
    managed: r.managed, hoist: r.hoist, mentionable: r.mentionable,
  }));

  let members: Record<string, string[]> | null = {};
  try {
    let after = '0';
    for (;;) {
      const page = (await rest.request<RawMember[]>('GET', `/guilds/${guildId}/members?limit=1000&after=${after}`)) ?? [];
      for (const m of page) members[m.user.id] = [...m.roles];
      if (page.length < 1000) break;
      after = page[page.length - 1]?.user.id ?? after;
    }
  } catch (err) {
    members = null;
    notes.push(`Mitgliederliste nicht lesbar: ${(err as Error).message}`);
  }
  const botRoleIds = members?.[me.id] ?? [];
  const botManaged = roles.find((r) => r.managed && botRoleIds.includes(r.id));
  const botHighestRolePosition = Math.max(0, ...roles.filter((r) => botRoleIds.includes(r.id)).map((r) => r.position), botManaged?.position ?? 0);

  let onboarding: GuildSnapshot['onboarding'] = null;
  try {
    const o = await rest.request<{ enabled: boolean; prompts: Array<{ title: string }>; default_channel_ids: string[] }>('GET', `/guilds/${guildId}/onboarding`);
    if (o) onboarding = { enabled: o.enabled, promptTitles: o.prompts.map((p) => p.title), defaultChannelIds: o.default_channel_ids };
  } catch (err) {
    notes.push(`Onboarding nicht lesbar: ${(err as Error).message}`);
  }
  let welcomeScreen: GuildSnapshot['welcomeScreen'] = null;
  const ws = await rest.request<{ description: string | null; welcome_channels: Array<{ channel_id: string }> }>(
    'GET', `/guilds/${guildId}/welcome-screen`, undefined, [404],
  ).catch((err: Error) => {
    notes.push(`Welcome Screen nicht lesbar: ${err.message}`);
    return null;
  });
  if (ws) welcomeScreen = { description: ws.description, channelIds: ws.welcome_channels.map((c) => c.channel_id) };

  const channelConfig: Partial<Record<ChannelKey, string>> = {};
  for (const row of sqliteHandle.prepare('SELECT key, channel_id FROM channel_config WHERE guild_id = ?').all(guildId) as Array<{ key: string; channel_id: string }>) {
    if (isChannelKey(row.key)) channelConfig[row.key] = row.channel_id;
  }
  const autoRow = sqliteHandle.prepare("SELECT value FROM bot_settings WHERE guild_id = ? AND key = 'autoRoleId'").get(guildId) as { value: string } | undefined;

  return {
    snap: {
      guildId,
      botUserId: me.id,
      botHighestRolePosition,
      features: guild.features,
      rulesChannelId: guild.rules_channel_id,
      publicUpdatesChannelId: guild.public_updates_channel_id,
      verificationLevel: guild.verification_level,
      explicitContentFilter: guild.explicit_content_filter,
      channels,
      roles,
      members,
      channelConfig,
      autoRoleSetting: autoRow?.value ?? null,
      onboarding,
      welcomeScreen,
    },
    notes,
  };
}
