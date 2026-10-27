/**
 * Read-only inventory of roles and channel visibility. Output = counters, role names and channel names only:
 * never a user id or user name (members are only counted).
 */
import { CATEGORY_TYPE, DANGEROUS_PERMS, P, botRoleIds, memberCounts, overwriteTargetsUsed, permNames, permissionsForRoles, channelPermissions, BOT_POST_REQUIRED, type PermName, type RolesSnapshot } from './roles-model.js';
import type { RoleRefs } from './roles-refs.js';

export interface RoleInventoryRow {
  name: string;
  position: number;
  managed: boolean;
  /** null = member list unreadable. */
  members: number | null;
  dangerous: PermName[];
  overwrites: number;
  /** Subset of: managed, bot-rolle, leer, ungenutzt, doppelt, bot-referenz. */
  flags: string[];
  references: string[];
}

export interface VisibilityRow {
  category: string;
  channels: number;
  everyone: string[];
  member: string[];
  mod: string[];
  admin: string[];
  bot: string[];
  botMissing: string[];
}

export interface RolesInventory {
  roles: RoleInventoryRow[];
  everyone: { dangerous: PermName[]; invite: boolean; mentionEveryone: boolean };
  duplicates: string[];
  visibility: VisibilityRow[];
  counters: { roles: number; managed: number; empty: number; unused: number; duplicates: number; referenced: number; dangerousRoles: number; channelsVisibleToEveryone: number; memberListReadable: boolean };
  notes: string[];
}

const norm = (s: string): string => s.trim().toLowerCase();

export function buildInventory(
  snap: RolesSnapshot,
  refs: RoleRefs,
  opts: { staffRoleNames?: readonly string[]; memberRoleNames?: readonly string[] } = {},
): RolesInventory {
  const staffNames = opts.staffRoleNames ?? ['Admin', 'Moderator'];
  const counts = memberCounts(snap);
  const botRoles = new Set(botRoleIds(snap));
  const byName = new Map<string, number>();
  for (const r of snap.roles) byName.set(norm(r.name), (byName.get(norm(r.name)) ?? 0) + 1);
  const duplicates = [...new Set(snap.roles.filter((r) => (byName.get(norm(r.name)) ?? 0) > 1).map((r) => r.name))];

  const roles: RoleInventoryRow[] = [...snap.roles]
    .filter((r) => r.id !== snap.guildId)
    .sort((a, b) => b.position - a.position)
    .map((r) => {
      const members = counts ? (counts.get(r.id) ?? 0) : null;
      const overwrites = overwriteTargetsUsed(snap, r.id);
      const references = [...(refs.ids.get(r.id) ?? []), ...(refs.names.get(r.name) ?? []).map((s) => `Name: ${s}`)];
      const flags: string[] = [];
      if (r.managed) flags.push('managed');
      if (botRoles.has(r.id)) flags.push('bot-rolle');
      if (members === 0) flags.push('leer');
      if (members === 0 && overwrites === 0 && references.length === 0 && !r.managed) flags.push('ungenutzt');
      if ((byName.get(norm(r.name)) ?? 0) > 1) flags.push('doppelt');
      if (references.length) flags.push('bot-referenz');
      return { name: r.name, position: r.position, managed: r.managed, members, dangerous: permNames(BigInt(r.permissions), DANGEROUS_PERMS), overwrites, flags, references };
    });

  const everyoneRole = snap.roles.find((r) => r.id === snap.guildId);
  const everyoneBits = BigInt(everyoneRole?.permissions ?? '0');

  // Visibility matrix: what a normal member, a mod, an admin and the bot can see, per category.
  const idByName = (n: string): string | undefined => snap.roles.find((r) => r.name === n && !r.managed)?.id;
  const memberRoleIds = (opts.memberRoleNames
    ? opts.memberRoleNames.map(idByName)
    : snap.roles.filter((r) => !r.managed && r.id !== snap.guildId && !staffNames.includes(r.name)).map((r) => r.id)
  ).filter((x): x is string => Boolean(x));
  const modId = idByName(staffNames[1] ?? 'Moderator');
  const adminId = idByName(staffNames[0] ?? 'Admin');
  const categories = snap.channels.filter((c) => c.type === CATEGORY_TYPE).sort((a, b) => a.position - b.position);
  const groups: Array<{ name: string; channels: typeof snap.channels }> = [
    ...categories.map((cat) => ({ name: cat.name, channels: snap.channels.filter((c) => c.parentId === cat.id && c.type !== CATEGORY_TYPE).sort((a, b) => a.position - b.position) })),
    { name: '(ohne Kategorie)', channels: snap.channels.filter((c) => !c.parentId && c.type !== CATEGORY_TYPE) },
  ].filter((g) => g.channels.length > 0);
  const visibility: VisibilityRow[] = groups.map((g) => {
    const row: VisibilityRow = { category: g.name, channels: g.channels.length, everyone: [], member: [], mod: [], admin: [], bot: [], botMissing: [] };
    for (const ch of g.channels) {
      const sees = (roleIds: string[]): boolean => (permissionsForRoles(snap, ch, roleIds) & P.VIEW_CHANNEL) !== 0n;
      if (sees([])) row.everyone.push(ch.name);
      if (sees(memberRoleIds)) row.member.push(ch.name);
      if (modId && sees([modId])) row.mod.push(ch.name);
      if (adminId && sees([adminId])) row.admin.push(ch.name);
      const botBits = channelPermissions(snap, ch, snap.botUserId);
      if ((botBits & P.VIEW_CHANNEL) !== 0n) row.bot.push(ch.name);
      if (ch.type !== 2 && (botBits & BOT_POST_REQUIRED) !== BOT_POST_REQUIRED) row.botMissing.push(ch.name);
    }
    return row;
  });

  const counters = {
    roles: roles.length,
    managed: roles.filter((r) => r.managed).length,
    empty: roles.filter((r) => r.flags.includes('leer')).length,
    unused: roles.filter((r) => r.flags.includes('ungenutzt')).length,
    duplicates: duplicates.length,
    referenced: roles.filter((r) => r.flags.includes('bot-referenz')).length,
    dangerousRoles: roles.filter((r) => !r.managed && r.dangerous.length > 0).length,
    channelsVisibleToEveryone: visibility.reduce((n, v) => n + v.everyone.length, 0),
    memberListReadable: counts !== null,
  };
  return {
    roles,
    everyone: { dangerous: permNames(everyoneBits, DANGEROUS_PERMS), invite: (everyoneBits & P.CREATE_INSTANT_INVITE) !== 0n, mentionEveryone: (everyoneBits & P.MENTION_EVERYONE) !== 0n },
    duplicates,
    visibility,
    counters,
    notes: snap.notes,
  };
}

export function formatInventory(inv: RolesInventory): string {
  const L: string[] = [];
  const c = inv.counters;
  L.push('MagguuBot Rollen-Inventur (nur lesen)');
  L.push(`Rollen: ${c.roles} (managed ${c.managed}) · leer ${c.empty} · ungenutzt ${c.unused} · doppelte Namen ${c.duplicates} · mit Bot-Referenz ${c.referenced} · mit gefährlichen Rechten ${c.dangerousRoles}${c.memberListReadable ? '' : ' · Mitgliederliste NICHT lesbar'}`);
  L.push(`@everyone: gefährliche Rechte: ${inv.everyone.dangerous.length ? inv.everyone.dangerous.join(', ') : 'keine'} · Einladungen erlaubt: ${inv.everyone.invite ? 'ja (Vorschlag: entziehen)' : 'nein'}`);
  L.push('Rollen (oben = höchste Position):');
  for (const r of inv.roles) {
    const parts = [`${r.members === null ? '?' : r.members} Mitgl.`];
    if (r.flags.length) parts.push(r.flags.join(', '));
    if (r.dangerous.length) parts.push(`⚠ ${r.dangerous.join('+')}`);
    if (r.overwrites) parts.push(`${r.overwrites} Kanal-Overwrite(s)`);
    if (r.references.length) parts.push(`Bot: ${r.references.slice(0, 3).join('; ')}${r.references.length > 3 ? ' …' : ''}`);
    L.push(`  - ${r.name} [${r.position}] ${parts.join(' · ')}`);
  }
  if (inv.duplicates.length) L.push(`Doppelte Namen: ${inv.duplicates.join(', ')}`);
  L.push('Sichtbarkeit je Kategorie (Kanäle sichtbar für: @everyone / Mitglied / Mod / Admin / Bot):');
  for (const v of inv.visibility) {
    L.push(`  - ${v.category} (${v.channels}): ${v.everyone.length} / ${v.member.length} / ${v.mod.length} / ${v.admin.length} / ${v.bot.length}`);
    if (v.everyone.length) L.push(`      @everyone sieht: ${v.everyone.join(', ')}`);
    if (v.botMissing.length) L.push(`      ⚠ Bot ohne Post-Rechte (View/Send/Embed/History): ${v.botMissing.join(', ')}`);
  }
  for (const n of inv.notes) L.push(`Hinweis: ${n}`);
  return `${L.join('\n')}\n`;
}
