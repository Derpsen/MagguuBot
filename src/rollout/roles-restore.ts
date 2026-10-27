/**
 * Restore planning: bring roles (name, colour, hoist, mentionable, permissions, position), @everyone and channel
 * overwrites back to a backup file. Pure; shares effects, simulation and hard gates with apply.
 *
 * Scope on purpose: managed roles are never touched, channels/roles that no longer exist are re-created only for
 * ROLES (channels are listed, not re-created), memberships are restored only for roles this restore re-creates.
 * Position restore is best effort (Discord resolves collisions).
 */
import { ARCHIVE_CATEGORY_NAME } from '../discord/server-layout.js';
import { applyEffect, checkInvariants, guardedUsers, type Effect, type InvariantContext, type Step } from './roles-effects.js';
import { cloneSnapshot, type OverwriteRec, type RolesSnapshot } from './roles-model.js';
import type { Skip } from './roles-plan.js';

export interface RestorePlan {
  steps: Step[];
  skipped: Skip[];
  violations: string[];
  counters: { rollenAktualisiert: number; rollenNeu: number; mitgliederZurück: number; overwrites: number; positionen: number };
  /** Role names that are recreated (listing only). */
  recreated: string[];
}

const PHASE = { create: 0, member: 1, role: 2, overwrite: 3, position: 4 } as const;

const sameOverwrite = (a: OverwriteRec | undefined, b: OverwriteRec | undefined): boolean =>
  BigInt(a?.allow ?? '0') === BigInt(b?.allow ?? '0') && BigInt(a?.deny ?? '0') === BigInt(b?.deny ?? '0');

export function planRestore(
  backup: RolesSnapshot,
  live: RolesSnapshot,
  postingChannelIds: ReadonlySet<string>,
  opts: { staffRoleNames?: readonly string[]; protectedUserIds?: readonly string[] } = {},
): RestorePlan {
  const steps: Step[] = [];
  const skipped: Skip[] = [];
  const violations: string[] = [];
  const counters = { rollenAktualisiert: 0, rollenNeu: 0, mitgliederZurück: 0, overwrites: 0, positionen: 0 };
  const recreated: string[] = [];
  const staffNames = opts.staffRoleNames ?? ['Admin', 'Moderator'];

  if (backup.guildId !== live.guildId) violations.push('Backup gehört zu einer anderen Guild');
  if (!live.members) violations.push('Mitgliederliste nicht lesbar: Zugriffsprüfung unmöglich');
  if (live.missingKnownChannels) violations.push(`${live.missingKnownChannels} Kanal-ID(s) aus der Bot-Datenbank fehlen in der Kanalliste: Bild unvollständig`);

  // old id → id usable in effects (live id, or `new:<oldId>` for roles created by this restore)
  const idMap = new Map<string, string>();
  const liveById = new Map(live.roles.map((r) => [r.id, r]));
  const overBot = (r: { position: number }): boolean => r.position >= live.botHighestRolePosition;

  // @everyone
  const be = backup.roles.find((r) => r.id === backup.guildId);
  const le = liveById.get(live.guildId);
  idMap.set(backup.guildId, live.guildId);
  if (be && le && BigInt(be.permissions) !== BigInt(le.permissions)) {
    steps.push({ effect: { t: 'roleUpdate', id: le.id, changes: { permissions: be.permissions } }, label: '@everyone: Rechte zurück', phase: PHASE.role });
    counters.rollenAktualisiert++;
  }

  const positionItems: Array<{ id: string; position: number }> = [];
  for (const b of [...backup.roles].sort((a, c) => a.position - c.position)) {
    if (b.id === backup.guildId) continue;
    if (b.managed) { idMap.set(b.id, b.id); continue; }
    const l = liveById.get(b.id);
    if (l) {
      idMap.set(b.id, l.id);
      if (l.managed) { skipped.push({ category: 'managed', label: l.name, reason: 'ist jetzt managed, bleibt unberührt' }); continue; }
      const changes: Effect & { t: 'roleUpdate' } = { t: 'roleUpdate', id: l.id, changes: {} };
      if (l.name !== b.name) changes.changes.name = b.name;
      if (BigInt(l.permissions) !== BigInt(b.permissions)) changes.changes.permissions = b.permissions;
      if (l.color !== b.color) changes.changes.color = b.color;
      if (l.hoist !== b.hoist) changes.changes.hoist = b.hoist;
      if (l.mentionable !== b.mentionable) changes.changes.mentionable = b.mentionable;
      if (Object.keys(changes.changes).length) {
        if (overBot(l)) { skipped.push({ category: 'über-bot-rolle', label: l.name, reason: `Position ${l.position} ≥ Bot-Rolle ${live.botHighestRolePosition}` }); continue; }
        steps.push({ effect: changes, label: `Rolle ${l.name}: ${Object.keys(changes.changes).join(', ')} zurück`, phase: PHASE.role });
        counters.rollenAktualisiert++;
      }
      if (l.position !== b.position && b.position < live.botHighestRolePosition && !overBot(l)) positionItems.push({ id: l.id, position: b.position });
      continue;
    }
    // Missing live: reuse a same-named role if there is one, else re-create.
    const same = live.roles.find((r) => r.name === b.name && !r.managed);
    if (same) { idMap.set(b.id, same.id); skipped.push({ category: 'name-belegt', label: b.name, reason: 'gleichnamige Rolle existiert, wird für Zuordnung genutzt' }); }
    else {
      const pending = `new:${b.id}`;
      idMap.set(b.id, pending);
      recreated.push(b.name);
      steps.push({ effect: { t: 'roleCreate', id: pending, role: { name: b.name, permissions: b.permissions, color: b.color, hoist: b.hoist, mentionable: b.mentionable, position: Math.min(b.position, Math.max(0, live.botHighestRolePosition - 1)) } }, label: `Rolle ${b.name} neu anlegen`, phase: PHASE.create });
      counters.rollenNeu++;
      if (b.position < live.botHighestRolePosition) positionItems.push({ id: pending, position: b.position });
    }
    // Memberships for re-created / re-mapped roles, only for members that are still on the server.
    if (backup.members && live.members) {
      const target = idMap.get(b.id) as string;
      for (const [uid, roles] of Object.entries(backup.members)) {
        if (roles.includes(b.id) && live.members[uid] && !(live.members[uid] ?? []).includes(target)) {
          steps.push({ effect: { t: 'memberAddRole', userId: uid, roleId: target }, label: `Mitglied bekommt ${b.name} zurück`, phase: PHASE.member });
          counters.mitgliederZurück++;
        }
      }
    }
  }
  if (!backup.members) skipped.push({ category: 'mitglieder-unbekannt', label: 'Mitgliedschaften', reason: 'Backup enthält keine Mitgliederliste' });

  // Overwrites: exact copy of the backup for channels that still exist.
  const liveChannels = new Map(live.channels.map((c) => [c.id, c]));
  for (const bc of backup.channels) {
    const lc = liveChannels.get(bc.id);
    if (!lc) { skipped.push({ category: 'nicht-gefunden', label: `#${bc.name}`, reason: 'Kanal existiert nicht mehr (wird nicht neu angelegt)' }); continue; }
    if (lc.name === ARCHIVE_CATEGORY_NAME) continue;
    const wanted = new Map<string, OverwriteRec>();
    for (const o of bc.overwrites) {
      const target = o.type === 0 ? idMap.get(o.id) : o.id;
      if (!target) { skipped.push({ category: 'nicht-gefunden', label: `#${bc.name}`, reason: 'Overwrite-Ziel (Rolle) nicht mehr abbildbar' }); continue; }
      wanted.set(`${o.type}:${target}`, { ...o, id: target });
    }
    for (const o of wanted.values()) {
      const cur = lc.overwrites.find((x) => x.id === o.id && x.type === o.type);
      if (!sameOverwrite(cur, o)) {
        steps.push({ effect: { t: 'overwrite', channelId: lc.id, target: o.id, type: o.type, allow: o.allow, deny: o.deny }, label: `#${lc.name}: Overwrite zurück`, phase: PHASE.overwrite });
        counters.overwrites++;
      }
    }
    for (const o of lc.overwrites) {
      if (!wanted.has(`${o.type}:${o.id}`) && (o.allow !== '0' || o.deny !== '0')) {
        steps.push({ effect: { t: 'overwrite', channelId: lc.id, target: o.id, type: o.type, allow: '0', deny: '0' }, label: `#${lc.name}: später hinzugekommenen Overwrite entfernen`, phase: PHASE.overwrite });
        counters.overwrites++;
      }
    }
  }
  if (positionItems.length) {
    steps.push({ effect: { t: 'rolePositions', items: positionItems }, label: `Rollen-Reihenfolge (${positionItems.length}, best effort)`, phase: PHASE.position });
    counters.positionen = positionItems.length;
  }

  // Same hard gates on the simulated result (restore must not lock out the bot or staff either).
  const after = cloneSnapshot(live);
  for (const s of [...steps].sort((a, c) => a.phase - c.phase)) applyEffect(after, s.effect);
  const ctx: InvariantContext = { guardedUserIds: guardedUsers(live, staffNames, opts.protectedUserIds ?? []), postingChannelIds: postingChannelIds };
  violations.push(...checkInvariants(live, after, ctx));
  return { steps, skipped, violations, counters, recreated };
}

export function formatRestorePlan(plan: RestorePlan, mode: 'dry-run' | 'execute', backupInfo: { createdAt: string; roles: number; channels: number }): string {
  const L: string[] = [];
  const c = plan.counters;
  L.push(`MagguuBot Rollen-Restore · Modus: ${mode} · Backup vom ${backupInfo.createdAt} (${backupInfo.roles} Rollen, ${backupInfo.channels} Kanäle)`);
  L.push(`Plan: ${plan.steps.length} Schritte · Rollen aktualisieren ${c.rollenAktualisiert} · Rollen neu ${c.rollenNeu} · Mitgliedschaften zurück ${c.mitgliederZurück} · Overwrites ${c.overwrites} · Positionen ${c.positionen}`);
  for (const s of [...plan.steps].filter((x) => x.effect.t === 'roleCreate' || x.effect.t === 'roleUpdate').sort((a, b) => a.phase - b.phase)) L.push(`  + ${s.label}`);
  const ow = plan.steps.filter((s) => s.effect.t === 'overwrite');
  if (ow.length) {
    L.push(`Overwrites (${ow.length}):`);
    for (const s of ow.slice(0, 40)) L.push(`  + ${s.label}`);
    if (ow.length > 40) L.push(`  … ${ow.length - 40} weitere`);
  }
  if (plan.skipped.length) {
    L.push('Nicht ausgeführt:');
    for (const s of plan.skipped) L.push(`  · [${s.category}] ${s.label}: ${s.reason}`);
  }
  if (plan.violations.length) {
    L.push('ABBRUCH-GRÜNDE (harte Gitter):');
    for (const v of plan.violations) L.push(`  ✖ ${v}`);
  }
  if (!plan.steps.length) L.push('Nichts zu tun: Live-Stand entspricht dem Backup.');
  return `${L.join('\n')}\n`;
}
