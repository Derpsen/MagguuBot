import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkModerationTarget, type GuardMember, type ModerationAction } from '../src/discord/moderation-guard.js';

interface FakeRole { position: number; comparePositionTo(other: FakeRole): number }

function role(position: number): FakeRole {
  return { position, comparePositionTo: (other) => position - other.position };
}

function member(id: string, position: number, bot: Partial<Pick<GuardMember, 'bannable' | 'kickable' | 'moderatable'>> = {}): GuardMember<FakeRole> {
  return { id, roles: { highest: role(position) }, bannable: true, kickable: true, moderatable: true, ...bot };
}

const OWNER = 'owner';
const BOT = 'bot';

function check(action: ModerationAction, invoker: GuardMember<FakeRole> | null, invokerId: string, target: GuardMember<FakeRole> | null, targetId: string) {
  return checkModerationTarget({ action, guildOwnerId: OWNER, botUserId: BOT, invokerId, invoker, targetId, target });
}

describe('moderation guard', () => {
  it('allows a higher-ranked moderator for every action', () => {
    for (const action of ['ban', 'kick', 'timeout'] as const) {
      assert.equal(check(action, member('mod', 5), 'mod', member('t', 2), 't'), null, action);
    }
  });

  it('rejects the invoker as target', () => {
    assert.match(check('kick', member('mod', 5), 'mod', member('mod', 5), 'mod') ?? '', /nicht selbst kicken/);
  });

  it('rejects the bot as target', () => {
    assert.match(check('ban', member('mod', 5), 'mod', member(BOT, 1), BOT) ?? '', /Bot selbst/);
  });

  it('rejects the guild owner as target, even for higher roles', () => {
    assert.match(check('timeout', member('mod', 9), 'mod', member(OWNER, 1), OWNER) ?? '', /Server-Owner kann nicht getimeoutet/);
  });

  it('allows ban by id when the target is not a member', () => {
    assert.equal(check('ban', member('mod', 5), 'mod', null, 'gone'), null);
  });

  it('rejects kick/timeout when the target is not a member', () => {
    assert.equal(check('kick', member('mod', 5), 'mod', null, 'gone'), 'User ist nicht im Server.');
    assert.equal(check('timeout', member('mod', 5), 'mod', null, 'gone'), 'User ist nicht im Server.');
  });

  it('fails closed when the invoker member cannot be resolved', () => {
    assert.match(check('ban', null, 'mod', member('t', 1), 't') ?? '', /Rollen konnten nicht geprüft/);
  });

  it('rejects equal and lower invoker roles (audit repro: position 2 vs 9)', () => {
    assert.match(check('ban', member('mod', 2), 'mod', member('t', 9), 't') ?? '', /höchste Rolle muss über/);
    assert.match(check('kick', member('mod', 4), 'mod', member('t', 4), 't') ?? '', /höchste Rolle muss über/);
  });

  it('lets the guild owner act regardless of role position (invoker may be unresolved)', () => {
    assert.equal(check('kick', member(OWNER, 0), OWNER, member('t', 9), 't'), null);
    assert.equal(check('kick', null, OWNER, member('t', 9), 't'), null);
  });

  it('checks the bot side per action', () => {
    assert.match(check('ban', member('mod', 5), 'mod', member('t', 1, { bannable: false }), 't') ?? '', /Konnte nicht bannen/);
    assert.match(check('kick', member('mod', 5), 'mod', member('t', 1, { kickable: false }), 't') ?? '', /Konnte nicht kicken/);
    assert.match(check('timeout', member('mod', 5), 'mod', member('t', 1, { moderatable: false }), 't') ?? '', /Konnte nicht timeouten/);
    // Only the flag for the requested action matters.
    assert.equal(check('ban', member('mod', 5), 'mod', member('t', 1, { kickable: false, moderatable: false }), 't'), null);
  });
});
