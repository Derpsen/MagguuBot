import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkRoleAssignmentFacts,
  type RoleAssignmentFacts,
} from '../src/discord/role-assignment.ts';
import {
  isAutoRoleReconcileCandidate,
} from '../src/discord/auto-role-reconcile.ts';
import {
  NEWCOMER_ROLE_SENTINEL,
  parseAutoRoleSetting,
  serializeAutoRoleSetting,
} from '../src/discord/auto-role-setting.ts';

const VALID_FACTS: RoleAssignmentFacts = {
  botMemberAvailable: true,
  canManageRoles: true,
  targetIsEveryone: false,
  targetIsManaged: false,
  botRoleAboveTarget: true,
  botHighestRoleName: 'MagguuBot',
  targetRoleName: 'Newcomer',
};

test('auto-role requires Manage Roles', () => {
  const result = checkRoleAssignmentFacts({ ...VALID_FACTS, canManageRoles: false });
  assert.equal(result.assignable, false);
  assert.equal(result.issueCode, 'manage-roles-missing');
});

test('auto-role target must be below the bot role', () => {
  const result = checkRoleAssignmentFacts({ ...VALID_FACTS, botRoleAboveTarget: false });
  assert.equal(result.assignable, false);
  assert.equal(result.issueCode, 'role-hierarchy');
  assert.match(result.issue ?? '', /MagguuBot.*Newcomer/);
});

test('Discord-managed roles cannot be assigned', () => {
  const result = checkRoleAssignmentFacts({ ...VALID_FACTS, targetIsManaged: true });
  assert.equal(result.assignable, false);
  assert.equal(result.issueCode, 'managed-role');
});

test('an ordinary role below a bot with Manage Roles is assignable', () => {
  assert.deepEqual(checkRoleAssignmentFacts(VALID_FACTS), {
    assignable: true,
    issueCode: null,
    issue: null,
  });
});

test('an explicit Newcomer choice overrides AUTO_ROLE_ID with a persisted sentinel', () => {
  assert.equal(serializeAutoRoleSetting(null), NEWCOMER_ROLE_SENTINEL);
  assert.equal(parseAutoRoleSetting(NEWCOMER_ROLE_SENTINEL), null);
  assert.equal(parseAutoRoleSetting('123456789012345678'), '123456789012345678');
});

test('auto-role reconciliation only targets recent roleless humans', () => {
  const now = Date.UTC(2026, 6, 13);
  const recentRoleless = {
    isBot: false,
    hasTargetRole: false,
    hasOnlyEveryoneRole: true,
    joinedTimestamp: now - 60_000,
  };

  assert.equal(isAutoRoleReconcileCandidate(recentRoleless, now), true);
  assert.equal(isAutoRoleReconcileCandidate({ ...recentRoleless, isBot: true }, now), false);
  assert.equal(isAutoRoleReconcileCandidate({ ...recentRoleless, hasTargetRole: true }, now), false);
  assert.equal(isAutoRoleReconcileCandidate({ ...recentRoleless, hasOnlyEveryoneRole: false }, now), false);
  assert.equal(
    isAutoRoleReconcileCandidate({ ...recentRoleless, joinedTimestamp: now - 31 * 24 * 60 * 60 * 1000 }, now),
    false,
  );
});
