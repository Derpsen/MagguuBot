import { sqliteHandle } from '../db/client.js';
import { saveChannel } from '../discord/channel-store.js';
import { setSetting } from '../settings.js';
import {
  describeAction,
  isNewRef,
  type Action,
  type DeletionPlan,
  type GuildSnapshot,
  type OverwriteSpec,
  type Ref,
} from './plan.js';

/** Anything that can send a Discord REST v10 request (own fetch client or discord.js `client.rest`). */
export interface RestLike {
  request<T>(method: string, path: string, body?: unknown, okStatuses?: number[]): Promise<T | null>;
}

export interface StepResult {
  action: string;
  status: 'ok' | 'skipped' | 'error' | 'manual';
  detail?: string;
}

/** Fields of a channel that a PATCH may set and Discord echoes back. */
export interface ChannelState {
  name?: string;
  parent_id?: string | null;
  topic?: string | null;
}

/**
 * Which requested channel fields Discord did not store (names in German for the report).
 * Overwrites are not compared: Discord reorders them and drops empty entries.
 */
export function channelPatchMismatch(sent: Record<string, unknown>, stored: ChannelState | null): string[] {
  if (!stored) return ['Antwort'];
  const out: string[] = [];
  if (typeof sent.name === 'string' && stored.name !== sent.name) out.push('Name');
  if (typeof sent.parent_id === 'string' && (stored.parent_id ?? null) !== sent.parent_id) out.push('Kategorie');
  if ('topic' in sent && ((stored.topic ?? '') !== ((sent.topic as string | null) ?? ''))) out.push('Thema');
  return out;
}

function snowflake(seq: number): string {
  return (((BigInt(Date.now()) - 1420070400000n) << 22n) + BigInt(seq)).toString();
}

/**
 * Execute planned actions in order. Newly created objects are resolved for
 * later steps. Errors are collected per step; the run continues.
 * Returns the step results and the final plan-name → id map.
 */
export async function executeActions(
  rest: RestLike,
  snap: GuildSnapshot,
  actions: Action[],
  manual: string[],
  verifyDelayMs = 1500,
): Promise<{ results: StepResult[]; ids: Map<Ref, string> }> {
  const guildId = snap.guildId;
  const ids = new Map<Ref, string>();
  const results: StepResult[] = [];
  const resolve = (ref: Ref): string => {
    if (!isNewRef(ref)) return ref;
    const id = ids.get(ref);
    if (!id) throw new Error(`Abhängigkeit fehlt: ${ref}`);
    return id;
  };
  const toApi = (list: OverwriteSpec[]): Array<{ id: string; type: number; allow: string; deny: string }> =>
    list.map((o) => ({ id: resolve(o.target), type: o.type, allow: o.allow, deny: o.deny }));
  let communityOk = snap.features.includes('COMMUNITY');
  let seq = 0;

  for (const a of actions) {
    const label = describeAction(a);
    try {
      switch (a.kind) {
        case 'createRole': {
          const role = await rest.request<{ id: string }>('POST', `/guilds/${guildId}/roles`, {
            name: a.plan.name, color: a.plan.color, hoist: a.plan.hoist ?? false,
            mentionable: a.plan.mentionable ?? false, permissions: a.plan.permissions,
          });
          if (role) ids.set(a.ref, role.id);
          break;
        }
        case 'updateRole':
          if (a.blocked) {
            results.push({ action: label, status: 'manual', detail: a.blocked });
            continue;
          }
          await rest.request('PATCH', `/guilds/${guildId}/roles/${a.id}`, a.changes);
          break;
        case 'createCategory':
        case 'createChannel': {
          const body = a.kind === 'createCategory'
            ? { name: a.name, type: 4, permission_overwrites: toApi(a.overwrites) }
            : { name: a.name, type: a.type, parent_id: resolve(a.parent), topic: a.topic, permission_overwrites: toApi(a.overwrites) };
          const ch = await rest.request<{ id: string }>('POST', `/guilds/${guildId}/channels`, body);
          if (ch) ids.set(a.ref, ch.id);
          break;
        }
        case 'updateChannel': {
          const body: Record<string, unknown> = {};
          if (a.changes.name) body.name = a.changes.name;
          if (a.changes.parent) body.parent_id = resolve(a.changes.parent);
          if (a.changes.topic !== undefined) body.topic = a.changes.topic;
          if (a.changes.overwrites) body.permission_overwrites = toApi(a.changes.overwrites);
          // Discord limits name/topic edits to 2 per channel per 10 min; verify what it really stored.
          let stored = await rest.request<ChannelState>('PATCH', `/channels/${a.id}`, body);
          let missing = channelPatchMismatch(body, stored);
          if (missing.length) {
            await new Promise((r) => setTimeout(r, verifyDelayMs));
            stored = await rest.request<ChannelState>('GET', `/channels/${a.id}`);
            missing = channelPatchMismatch(body, stored);
          }
          if (missing.length) {
            results.push({
              action: label,
              status: 'error',
              detail: `Discord hat ${missing.join(', ')} nicht übernommen (Limit: 2 Namens-/Themenänderungen pro Kanal in 10 min). In ~10 min erneut --apply.`,
            });
            continue;
          }
          break;
        }
        case 'archiveChannel':
          await rest.request('PATCH', `/channels/${a.id}`, { parent_id: resolve(a.archive), permission_overwrites: toApi(a.overwrites) });
          break;
        case 'hideCategory':
          await rest.request('PATCH', `/channels/${a.id}`, { permission_overwrites: toApi(a.overwrites) });
          break;
        case 'reorder':
          await rest.request('PATCH', `/guilds/${guildId}/channels`, a.items.map((i) => ({ id: resolve(i.ref), position: i.position })));
          break;
        case 'migrateMembers': {
          const roleId = resolve(a.toRole);
          for (const userId of a.userIds) await rest.request('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
          break;
        }
        case 'setChannelKey':
          saveChannel(a.key, resolve(a.target));
          break;
        case 'setAutoRole':
          setSetting('autoRoleId', resolve(a.target));
          break;
        case 'enableCommunity': {
          const features = [...new Set([...snap.features, 'COMMUNITY'])];
          await rest.request('PATCH', `/guilds/${guildId}`, {
            features,
            rules_channel_id: resolve(a.rules),
            // Never overwrite a public-updates channel the owner picked.
            ...(snap.publicUpdatesChannelId ? {} : { public_updates_channel_id: resolve(a.updates) }),
            verification_level: a.verificationLevel,
            explicit_content_filter: a.explicitContentFilter,
          });
          communityOk = true;
          break;
        }
        case 'putOnboarding': {
          if (!communityOk) {
            results.push({ action: label, status: 'skipped', detail: 'Community nicht aktiv' });
            continue;
          }
          const body = {
            mode: 0,
            default_channel_ids: a.spec.defaultChannels.map(resolve),
            prompts: a.spec.prompts.map((p) => ({
              id: snowflake(++seq),
              type: 0,
              title: p.title,
              single_select: p.singleSelect,
              required: p.required,
              in_onboarding: true,
              options: p.options.map((o) => ({
                id: snowflake(++seq),
                title: o.title,
                description: o.description,
                emoji_name: o.emoji,
                channel_ids: o.channels.map(resolve),
                role_ids: o.roles.map(resolve),
              })),
            })),
          };
          try {
            await rest.request('PUT', `/guilds/${guildId}/onboarding`, { ...body, enabled: true });
          } catch (err) {
            // Discord enforces minimum default-channel rules; store the prompts disabled and let Marco finish in the client.
            await rest.request('PUT', `/guilds/${guildId}/onboarding`, { ...body, enabled: false });
            manual.push(`Onboarding gespeichert, aber deaktiviert (Discord: ${(err as Error).message.slice(0, 200)}). Im Client unter Servereinstellungen → Onboarding prüfen und aktivieren.`);
            results.push({ action: label, status: 'manual', detail: 'gespeichert, deaktiviert' });
            continue;
          }
          break;
        }
        case 'putWelcomeScreen':
          if (!communityOk) {
            results.push({ action: label, status: 'skipped', detail: 'Community nicht aktiv' });
            continue;
          }
          await rest.request('PATCH', `/guilds/${guildId}/welcome-screen`, {
            enabled: true,
            description: a.spec.description,
            welcome_channels: a.spec.channels.map((c) => ({ channel_id: resolve(c.channel), description: c.description, emoji_name: c.emoji })),
          });
          break;
      }
      results.push({ action: label, status: 'ok' });
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      results.push({ action: label, status: 'error', detail: message });
      if (a.kind === 'enableCommunity') {
        manual.push(`Community konnte nicht aktiviert werden (${message}). Im Client: Servereinstellungen → Community aktivieren (Regeln: 👋・willkommen, Updates: 🩺・status), danach --apply erneut.`);
      }
    }
  }
  return { results, ids };
}

export async function executeDeletion(rest: RestLike, guildId: string, plan: DeletionPlan): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const cleanupWelcome = sqliteHandle.prepare('DELETE FROM welcome_messages WHERE guild_id = ? AND channel_id = ?');
  for (const ch of plan.channels) {
    try {
      await rest.request('DELETE', `/channels/${ch.id}`, undefined, [404]);
      cleanupWelcome.run(guildId, ch.id);
      results.push({ action: `Kanal löschen: ${ch.name}`, status: 'ok' });
    } catch (err) {
      results.push({ action: `Kanal löschen: ${ch.name}`, status: 'error', detail: (err as Error).message.slice(0, 300) });
    }
  }
  for (const cat of plan.categories) {
    try {
      await rest.request('DELETE', `/channels/${cat.id}`, undefined, [404]);
      results.push({ action: `Kategorie löschen: ${cat.name}`, status: 'ok' });
    } catch (err) {
      results.push({ action: `Kategorie löschen: ${cat.name}`, status: 'error', detail: (err as Error).message.slice(0, 300) });
    }
  }
  for (const role of plan.roles) {
    try {
      await rest.request('DELETE', `/guilds/${guildId}/roles/${role.id}`, undefined, [404]);
      results.push({ action: `Rolle löschen: ${role.name}`, status: 'ok' });
    } catch (err) {
      results.push({ action: `Rolle löschen: ${role.name}`, status: 'error', detail: (err as Error).message.slice(0, 300) });
    }
  }
  return results;
}
