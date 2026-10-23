import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GuardMember } from '../src/discord/moderation-guard.js';
import { pickEscalation, runEscalation, type EscalationAction } from '../src/discord/warn-escalation.js';

interface FakeRole { position: number; comparePositionTo(other: FakeRole): number }
const role = (position: number): FakeRole => ({ position, comparePositionTo: (o) => position - o.position });
const member = (id: string, position: number, flags: Partial<GuardMember> = {}): GuardMember<FakeRole> => ({
  id, roles: { highest: role(position) }, bannable: true, kickable: true, moderatable: true, ...flags,
});

const guard = (invoker: GuardMember<FakeRole> | null, target: GuardMember<FakeRole>, invokerId = invoker?.id ?? 'mod') => ({
  guildOwnerId: 'owner', botUserId: 'bot', invokerId, invoker, targetId: target.id, target,
});

function recorder() {
  const calls: EscalationAction[] = [];
  return { calls, execute: async (a: EscalationAction) => { calls.push(a); } };
}

describe('pickEscalation', () => {
  const config = { enabled: true, timeoutAt: 3, kickAt: 5 };
  it('returns nothing when disabled or below thresholds', () => {
    assert.equal(pickEscalation(9, { ...config, enabled: false }), null);
    assert.equal(pickEscalation(2, config), null);
  });
  it('picks timeout, then kick (kick wins)', () => {
    assert.deepEqual(pickEscalation(3, config), { action: 'timeout', threshold: 3 });
    assert.deepEqual(pickEscalation(5, config), { action: 'kick', threshold: 5 });
  });
  it('treats 0 as off per step', () => {
    assert.deepEqual(pickEscalation(9, { ...config, kickAt: 0 }), { action: 'timeout', threshold: 3 });
    assert.equal(pickEscalation(9, { enabled: true, timeoutAt: 0, kickAt: 0 }), null);
  });
});

describe('runEscalation (warn auto-timeout/kick through the moderation guard)', () => {
  const timeout = { action: 'timeout' as const, threshold: 3 };

  it('times out when the moderator outranks the target', async () => {
    const r = recorder();
    assert.equal(await runEscalation(timeout, 3, guard(member('mod', 5), member('t', 2)), r.execute), 'Auto-timeout 1h (3 ≥ 3)');
    assert.deepEqual(r.calls, ['timeout']);
  });

  it('skips the timeout for an equal/higher target and says why (audit bypass)', async () => {
    const r = recorder();
    const line = await runEscalation(timeout, 3, guard(member('mod', 2), member('t', 9)), r.execute);
    assert.equal(line, '⏭️ Auto-Timeout übersprungen (3 ≥ 3): Deine höchste Rolle muss über der höchsten Rolle des Ziels stehen.');
    assert.deepEqual(r.calls, []);
  });

  it('skips for owner, bot, self and unresolvable moderator', async () => {
    const r = recorder();
    assert.match(await runEscalation(timeout, 3, guard(member('mod', 5), member('owner', 1)), r.execute), /übersprungen.*Server-Owner/);
    assert.match(await runEscalation(timeout, 3, guard(member('mod', 5), member('bot', 1)), r.execute), /übersprungen.*Bot selbst/);
    assert.match(await runEscalation(timeout, 3, guard(member('mod', 5), member('mod', 5)), r.execute), /übersprungen.*nicht selbst/);
    assert.match(await runEscalation(timeout, 3, guard(null, member('t', 1), 'mod'), r.execute), /übersprungen.*Rollen konnten nicht geprüft/);
    assert.deepEqual(r.calls, []);
  });

  it('lets the guild owner escalate and keeps the bot-side check', async () => {
    const r = recorder();
    assert.equal(await runEscalation(timeout, 4, guard(member('owner', 0), member('t', 9)), r.execute), 'Auto-timeout 1h (4 ≥ 3)');
    assert.match(await runEscalation(timeout, 4, guard(member('mod', 5), member('t', 1, { moderatable: false })), r.execute), /übersprungen.*Bot-Rolle/);
    assert.deepEqual(r.calls, ['timeout']);
  });

  it('uses the kick rules for the kick step', async () => {
    const r = recorder();
    const kick = { action: 'kick' as const, threshold: 5 };
    assert.equal(await runEscalation(kick, 5, guard(member('mod', 5), member('t', 1)), r.execute), 'Auto-kick (5 ≥ 5)');
    assert.match(await runEscalation(kick, 5, guard(member('mod', 1), member('t', 5)), r.execute), /^⏭️ Auto-Kick übersprungen \(5 ≥ 5\)/);
    assert.deepEqual(r.calls, ['kick']);
  });

  it('reports a Discord API failure without throwing', async () => {
    let logged: unknown;
    const line = await runEscalation(timeout, 3, guard(member('mod', 5), member('t', 1)), async () => { throw new Error('50013'); }, (e) => { logged = e; });
    assert.equal(line, 'Eskalation fehlgeschlagen — fehlende Permissions (3 ≥ 3)');
    assert.ok(logged instanceof Error);
  });
});
