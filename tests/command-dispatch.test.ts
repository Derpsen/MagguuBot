import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, mock } from 'node:test';
import { MessageFlags, PermissionFlagsBits, PermissionsBitField } from 'discord.js';

// Gate wiring of the real client entry point (`handleInteraction`) and of `dispatchChatInputCommand`, incl. the DM
// fail-closed path and the deny audit log. Fake interactions only, no gateway, no network.
const dir = mkdtempSync(join(tmpdir(), 'magguu-dispatch-'));
process.env.DISCORD_TOKEN ??= 'test-token-not-used';
process.env.DISCORD_CLIENT_ID ??= '1498095100000000001';
process.env.DISCORD_GUILD_ID ??= '1400000000000000099';
process.env.WEBHOOK_SECRET ??= 'test-secret-0123456789abcdef';
process.env.DATABASE_PATH = join(dir, 'bot.db');

const { handleInteraction } = await import('../src/discord/client.ts');
const { dispatchChatInputCommand } = await import('../src/discord/command-dispatch.ts');
const { commandDenyReason, lacksCommandPermission } = await import('../src/discord/command-gate.ts');
const { commands } = await import('../src/discord/commands/index.ts');
const { logger } = await import('../src/utils/logger.ts');

const P = PermissionFlagsBits;
const DENY_TEXT = 'Du hast keine Berechtigung für diesen Command.';

interface Reply {
  content?: string;
  flags?: unknown;
}

function fakeInteraction(commandName: string, memberPermissions: PermissionsBitField | null) {
  const replies: Reply[] = [];
  const interaction = {
    commandName,
    memberPermissions,
    // Identifiers and option values that must never reach the log:
    user: { id: '100000000000000777', tag: 'secret-user#0001' },
    guildId: '1400000000000000099',
    channelId: '1400000000000000555',
    options: { getString: () => 'very private option value' },
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    deferred: false,
    replied: false,
    reply: async (r: Reply) => {
      replies.push(r);
    },
  };
  return { interaction, replies };
}

function fakeRegistry(requiredPermissions: string | null | undefined) {
  const executed: string[] = [];
  const cmd = {
    data: { toJSON: () => ({ default_member_permissions: requiredPermissions }) },
    execute: async (i: { commandName: string }) => {
      executed.push(i.commandName);
    },
  };
  return { registry: new Map([['probe', cmd]]), executed };
}

describe('commandDenyReason (reason categories)', () => {
  it('allowed = null, and always consistent with lacksCommandPermission', () => {
    const ban = String(P.BanMembers);
    assert.equal(commandDenyReason(null, null), null);
    assert.equal(commandDenyReason('', undefined), null);
    assert.equal(commandDenyReason(ban, new PermissionsBitField(P.BanMembers)), null);
    assert.equal(commandDenyReason(ban, new PermissionsBitField(P.Administrator)), null);
    assert.equal(commandDenyReason(ban, new PermissionsBitField(P.KickMembers)), 'missing-permission');
    assert.equal(commandDenyReason(ban, null), 'no-member-context');
    assert.equal(commandDenyReason(ban, undefined), 'no-member-context');
    assert.equal(commandDenyReason('nope', new PermissionsBitField(P.Administrator)), 'invalid-permission-spec');
    for (const required of [null, ban, 'nope']) {
      for (const perms of [null, new PermissionsBitField(P.BanMembers), new PermissionsBitField(0n)]) {
        assert.equal(lacksCommandPermission(required, perms), commandDenyReason(required, perms) !== null);
      }
    }
  });
});

describe('dispatchChatInputCommand', () => {
  it('unknown command: ephemeral notice, nothing executed, no deny log', async () => {
    const { registry, executed } = fakeRegistry(null);
    const warns: unknown[] = [];
    const { interaction, replies } = fakeInteraction('missing', null);
    const result = await dispatchChatInputCommand(interaction as never, registry as never, { warn: (...a) => warns.push(a) });
    assert.equal(result, 'unknown');
    assert.equal(replies[0]?.content, 'Unbekannter Befehl.');
    assert.equal(replies[0]?.flags, MessageFlags.Ephemeral);
    assert.deepEqual(executed, []);
    assert.deepEqual(warns, []);
  });

  it('no required permission: executes without any gate log', async () => {
    const { registry, executed } = fakeRegistry(undefined);
    const warns: unknown[] = [];
    const { interaction, replies } = fakeInteraction('probe', null);
    assert.equal(await dispatchChatInputCommand(interaction as never, registry as never, { warn: (...a) => warns.push(a) }), 'executed');
    assert.deepEqual(executed, ['probe']);
    assert.deepEqual(replies, []);
    assert.deepEqual(warns, []);
  });

  it('permission held (incl. Administrator): executes', async () => {
    for (const perms of [new PermissionsBitField(P.BanMembers), new PermissionsBitField(P.Administrator)]) {
      const { registry, executed } = fakeRegistry(String(P.BanMembers));
      const { interaction } = fakeInteraction('probe', perms);
      assert.equal(await dispatchChatInputCommand(interaction as never, registry as never, { warn: () => {} }), 'executed');
      assert.deepEqual(executed, ['probe']);
    }
  });

  const DENIALS: Array<[string, string | null, PermissionsBitField | null, string]> = [
    ['missing permission', String(P.BanMembers), new PermissionsBitField(P.KickMembers), 'missing-permission'],
    ['DM / no member permissions (fail closed)', String(P.BanMembers), null, 'no-member-context'],
    ['unparsable default_member_permissions (fail closed)', 'garbage', new PermissionsBitField(P.Administrator), 'invalid-permission-spec'],
  ];
  for (const [label, required, perms, reason] of DENIALS) {
    it(`denied: ${label} - ephemeral reply, not executed, warn log with command + reason only`, async () => {
      const { registry, executed } = fakeRegistry(required);
      const warns: Array<{ obj: Record<string, unknown>; msg: string }> = [];
      const { interaction, replies } = fakeInteraction('probe', perms);
      const result = await dispatchChatInputCommand(interaction as never, registry as never, {
        warn: (obj, msg) => warns.push({ obj, msg }),
      });
      assert.equal(result, 'denied');
      assert.deepEqual(executed, []);
      assert.deepEqual(replies, [{ content: DENY_TEXT, flags: MessageFlags.Ephemeral }]);
      assert.equal(warns.length, 1);
      assert.deepEqual(warns[0]?.obj, { command: 'probe', reason });
      const logged = JSON.stringify(warns[0]);
      for (const pii of ['100000000000000777', 'secret-user', '1400000000000000099', '1400000000000000555', 'private option']) {
        assert.ok(!logged.includes(pii), `log must not contain ${pii}`);
      }
    });
  }
});

describe('client entry point (handleInteraction) is wired through the gate', () => {
  function spyOnCommand(name: string) {
    const cmd = commands.get(name);
    assert.ok(cmd, `/${name} registered`);
    const spy = mock.method(cmd, 'execute', async () => {});
    return { cmd, spy };
  }

  it('DM (memberPermissions null) on a moderation command: denied, command not executed, warn logged', async () => {
    const { spy } = spyOnCommand('ban');
    const warn = mock.method(logger, 'warn', () => {});
    try {
      const { interaction, replies } = fakeInteraction('ban', null);
      await handleInteraction(interaction as never);
      assert.equal(spy.mock.callCount(), 0, 'ban must not run without member permissions');
      assert.deepEqual(replies, [{ content: DENY_TEXT, flags: MessageFlags.Ephemeral }]);
      const call = warn.mock.calls.find((c) => String(c.arguments[1]).includes('permission gate'));
      assert.ok(call, 'deny path logs');
      assert.deepEqual(call.arguments[0], { command: 'ban', reason: 'no-member-context' });
    } finally {
      spy.mock.restore();
      warn.mock.restore();
    }
  });

  it('guild member without the permission is denied, with the permission it executes (real command JSON)', async () => {
    const { spy } = spyOnCommand('ban');
    const warn = mock.method(logger, 'warn', () => {});
    try {
      const denied = fakeInteraction('ban', new PermissionsBitField(P.KickMembers));
      await handleInteraction(denied.interaction as never);
      assert.equal(spy.mock.callCount(), 0);
      assert.equal(denied.replies[0]?.content, DENY_TEXT);

      const allowed = fakeInteraction('ban', new PermissionsBitField(P.BanMembers));
      await handleInteraction(allowed.interaction as never);
      assert.equal(spy.mock.callCount(), 1);
      assert.equal(allowed.replies.length, 0);
    } finally {
      spy.mock.restore();
      warn.mock.restore();
    }
  });

  it('every command that declares default_member_permissions is blocked for a DM and for an empty permission set', async () => {
    const guarded = [...commands.entries()].filter(([, c]) => c.data.toJSON().default_member_permissions);
    assert.ok(guarded.length >= 25, `only ${guarded.length} guarded commands`);
    const warn = mock.method(logger, 'warn', () => {});
    const spies = guarded.map(([, c]) => mock.method(c, 'execute', async () => {}));
    try {
      for (const [name] of guarded) {
        for (const perms of [null, new PermissionsBitField(0n)]) {
          const { interaction, replies } = fakeInteraction(name, perms);
          await handleInteraction(interaction as never);
          assert.equal(replies[0]?.content, DENY_TEXT, `/${name}`);
        }
      }
      for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
    } finally {
      for (const spy of spies) spy.mock.restore();
      warn.mock.restore();
    }
  });
});
