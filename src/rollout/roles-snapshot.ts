/**
 * Read-only live snapshot for the role tooling (REST v10 GETs only).
 *
 * 2026-11-16 note: `GET /guilds/{id}/channels` stops listing channels the bot cannot VIEW. This tool runs in its own
 * process without a gateway session (a second session would duplicate every event), so it cannot use the gateway
 * cache. Instead it compares the list with the channel ids the bot's database points at (`knownChannelIds`) and
 * reports `missingKnownChannels`; apply/restore refuse to run on an incomplete picture. The bot's own overwrites
 * (VIEW_CHANNEL allow for the bot) are what keeps channels in the list: that is exactly what apply verifies.
 */
import type { RestLike } from './execute.js';
import type { ChannelRec, RoleRec, RolesSnapshot } from './roles-model.js';

interface RawRole {
  id: string; name: string; position: number; color: number; hoist: boolean; mentionable: boolean; permissions: string | number;
  managed: boolean; flags?: number; unicode_emoji?: string | null;
  tags?: { bot_id?: string; integration_id?: string; premium_subscriber?: null } | null;
}
interface RawChannel {
  id: string; name: string; type: number; parent_id?: string | null; position: number;
  permission_overwrites?: Array<{ id: string; type: number | string; allow: string | number; deny: string | number }>;
}

export async function takeRolesSnapshot(rest: RestLike, guildId: string, knownChannelIds: readonly string[] = []): Promise<RolesSnapshot> {
  const notes: string[] = [];
  const me = (await rest.request<{ id: string }>('GET', '/users/@me')) as { id: string };
  const guild = (await rest.request<{ owner_id?: string }>('GET', `/guilds/${guildId}`)) as { owner_id?: string };
  const rawRoles = (await rest.request<RawRole[]>('GET', `/guilds/${guildId}/roles`)) ?? [];
  const rawChannels = (await rest.request<RawChannel[]>('GET', `/guilds/${guildId}/channels`)) ?? [];

  const roles: RoleRec[] = rawRoles.map((r) => ({
    id: r.id, name: r.name, position: r.position, color: r.color, hoist: r.hoist, mentionable: r.mentionable,
    permissions: String(r.permissions), managed: r.managed, flags: r.flags ?? 0, unicodeEmoji: r.unicode_emoji ?? null,
    tags: r.tags ? { ...(r.tags.bot_id ? { botId: r.tags.bot_id } : {}), ...(r.tags.integration_id ? { integrationId: r.tags.integration_id } : {}), ...('premium_subscriber' in r.tags ? { premiumSubscriber: true } : {}) } : null,
  }));
  const channels: ChannelRec[] = rawChannels.map((c) => ({
    id: c.id, name: c.name, type: c.type, parentId: c.parent_id ?? null, position: c.position,
    overwrites: (c.permission_overwrites ?? []).map((o) => ({ id: o.id, type: Number(o.type) as 0 | 1, allow: String(o.allow), deny: String(o.deny) })),
  }));

  let members: Record<string, string[]> | null = {};
  try {
    let after = '0';
    for (;;) {
      const page = (await rest.request<Array<{ user: { id: string }; roles: string[] }>>('GET', `/guilds/${guildId}/members?limit=1000&after=${after}`)) ?? [];
      for (const m of page) members[m.user.id] = [...m.roles];
      if (page.length < 1000) break;
      after = page[page.length - 1]?.user.id ?? after;
    }
  } catch (err) {
    members = null;
    notes.push(`Mitgliederliste nicht lesbar (HTTP ${(err as { status?: number }).status ?? '?'}): Zähler/Zusammenlegung/Löschen sind deaktiviert`);
  }

  const botRoles = members?.[me.id] ?? [];
  const botHighestRolePosition = Math.max(0, ...roles.filter((r) => botRoles.includes(r.id)).map((r) => r.position));
  const present = new Set(channels.map((c) => c.id));
  const missing = new Set(knownChannelIds.filter((id) => !present.has(id)));
  if (missing.size) {
    notes.push(`${missing.size} Kanal-ID(s) aus der Bot-Datenbank fehlen in der HTTP-Kanalliste (gelöscht oder ohne VIEW_CHANNEL für den Bot; Discord-Änderung 2026-11-16)`);
  }
  return {
    guildId, ownerId: guild.owner_id ?? null, botUserId: me.id, botHighestRolePosition, roles, channels, members, notes,
    missingKnownChannels: missing.size,
  };
}
