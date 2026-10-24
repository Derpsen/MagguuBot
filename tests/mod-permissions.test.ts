import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';

// Commands pull in config/DB; throwaway env, fake interactions/guilds only, no network.
const dir = mkdtempSync(join(tmpdir(), 'magguu-modperm-'));
process.env.DISCORD_TOKEN ??= 'test-token-not-used';
process.env.DISCORD_CLIENT_ID ??= '1498095100000000001';
process.env.DISCORD_GUILD_ID ??= '1400000000000000099';
process.env.WEBHOOK_SECRET ??= 'test-secret-0123456789abcdef';
process.env.DATABASE_PATH = join(dir, 'bot.db');

const { commands } = await import('../src/discord/commands/index.ts');
const { lacksCommandPermission } = await import('../src/discord/command-gate.ts');
const { db } = await import('../src/db/client.ts');
const { warnings } = await import('../src/db/schema.ts');
const { setSetting } = await import('../src/settings.ts');

const P = PermissionFlagsBits;
const OWNER = '100000000000000001';
const BOT = '100000000000000002';
const MOD = '100000000000000003';
const VICTIM = '100000000000000004';
const GONE = '100000000000000005';

// ---- inventory ---------------------------------------------------------------------------------------

/** Every command that acts with the bot's (Administrator) authority, and the permission Discord must enforce for it. */
const EXPECTED: Record<string, bigint> = {
  ban: P.BanMembers,
  unban: P.BanMembers,
  kick: P.KickMembers,
  timeout: P.ModerateMembers,
  warn: P.ModerateMembers,
  purge: P.ManageMessages,
  'purge-user': P.ManageMessages,
  slowmode: P.ManageChannels,
  lockdown: P.Administrator,
  announce: P.ManageMessages,
  'schedule-announce': P.ManageMessages,
  countdown: P.ManageMessages,
  snipe: P.ManageMessages,
  editsnipe: P.ManageMessages,
  sticky: P.ManageMessages,
  giveaway: P.ManageGuild,
  'suggestion-status': P.ManageGuild,
  wochenstatistik: P.ManageGuild,
  doctor: P.Administrator,
  'db-backup': P.Administrator,
  'db-restore': P.Administrator,
  'cleanup-server': P.Administrator,
  'setup-server': P.Administrator,
  'roles-panel': P.Administrator,
  'ticket-panel': P.Administrator,
  autoresponder: P.Administrator,
  jtc: P.Administrator,
  'downloads-live': P.Administrator,
};

describe('moderation command inventory', () => {
  it('every moderation-category command is covered and carries the expected default_member_permissions', () => {
    const moderation = [...commands.values()].filter((c) => c.category === 'moderation').map((c) => c.data.name);
    assert.ok(moderation.length >= 8, `found ${moderation.join(', ')}`);
    for (const name of moderation) assert.ok(name in EXPECTED, `moderation command /${name} missing from the permission table`);
  });

  for (const [name, flag] of Object.entries(EXPECTED)) {
    it(`/${name} requires ${flag.toString()} (never empty, never @everyone-usable)`, () => {
      const cmd = commands.get(name);
      if (!cmd) return assert.fail(`/${name} not registered`);
      const json = cmd.data.toJSON();
      assert.ok(json.default_member_permissions, `/${name} has no default_member_permissions`);
      assert.equal(BigInt(json.default_member_permissions), flag);
    });
  }
});

// ---- central gate -------------------------------------------------------------------------------------

describe('central command gate (lacksCommandPermission)', () => {
  it('open commands pass, held permissions pass, missing ones are denied', () => {
    assert.equal(lacksCommandPermission(null, null), false);
    assert.equal(lacksCommandPermission(undefined, null), false);
    const ban = String(P.BanMembers);
    assert.equal(lacksCommandPermission(ban, new PermissionsBitField(P.BanMembers)), false);
    assert.equal(lacksCommandPermission(ban, new PermissionsBitField(P.KickMembers)), true);
    assert.equal(lacksCommandPermission(ban, new PermissionsBitField(0n)), true);
  });

  it('Administrator satisfies any requirement (as Discord computes it)', () => {
    assert.equal(lacksCommandPermission(String(P.BanMembers), new PermissionsBitField(P.Administrator)), false);
  });

  it('DM / partial interaction (no member permissions) and unparsable values fail closed', () => {
    assert.equal(lacksCommandPermission(String(P.BanMembers), null), true);
    assert.equal(lacksCommandPermission(String(P.BanMembers), undefined), true);
    assert.equal(lacksCommandPermission('not-a-number', new PermissionsBitField(P.Administrator)), true);
  });

  it('a multi-bit requirement needs every bit', () => {
    const both = String(P.BanMembers | P.KickMembers);
    assert.equal(lacksCommandPermission(both, new PermissionsBitField(P.BanMembers)), true);
    assert.equal(lacksCommandPermission(both, new PermissionsBitField(P.BanMembers | P.KickMembers)), false);
  });

  it('no registered moderation command can be run without member permissions (DM)', () => {
    for (const name of Object.keys(EXPECTED)) {
      const required = commands.get(name)?.data.toJSON().default_member_permissions;
      assert.equal(lacksCommandPermission(required, null), true, name);
    }
  });
});

// ---- fakes ----------------------------------------------------------------------------------------------

interface FakeRole { position: number; comparePositionTo(o: FakeRole): number }
const role = (position: number): FakeRole => ({ position, comparePositionTo: (o) => position - o.position });

interface Calls { ban: unknown[][]; kick: unknown[][]; timeout: unknown[][]; replies: string[] }
function newCalls(): Calls { return { ban: [], kick: [], timeout: [], replies: [] }; }

function fakeMember(id: string, position: number, calls: Calls, flags: { bannable?: boolean; kickable?: boolean; moderatable?: boolean } = {}) {
  return {
    id,
    roles: { highest: role(position) },
    bannable: flags.bannable ?? true,
    kickable: flags.kickable ?? true,
    moderatable: flags.moderatable ?? true,
    kick: async (...a: unknown[]) => { calls.kick.push(a); },
    timeout: async (...a: unknown[]) => { calls.timeout.push(a); },
  };
}

interface Setup {
  invokerId?: string;
  target?: string;
  members: Record<string, ReturnType<typeof fakeMember> | undefined>;
  dm?: boolean;
  minutes?: number;
  invokerFetchFails?: boolean;
}

function fakeUser(id: string) {
  return { id, displayName: `user-${id.slice(-1)}`, bot: false, toString: () => `<@${id}>`, displayAvatarURL: () => 'https://cdn.discordapp.com/x.png' };
}

function build(setup: Setup, calls: Calls) {
  const invokerId = setup.invokerId ?? MOD;
  const targetId = setup.target ?? VICTIM;
  const guild = setup.dm ? null : {
    id: process.env.DISCORD_GUILD_ID,
    ownerId: OWNER,
    client: { user: { id: BOT } },
    members: {
      fetch: async (id: string) => {
        if (id === invokerId && setup.invokerFetchFails) throw new Error('network');
        const m = setup.members[id];
        if (!m) throw new Error('Unknown Member');
        return m;
      },
      ban: async (...a: unknown[]) => { calls.ban.push(a); },
    },
    channels: { fetch: async () => null },
  };
  const interaction = {
    user: fakeUser(invokerId),
    guild,
    client: { user: { id: BOT } },
    options: {
      getUser: () => fakeUser(targetId),
      getString: () => null,
      getInteger: (name: string) => (name === 'minutes' ? (setup.minutes ?? 10) : null),
    },
    deferReply: async () => {},
    reply: async (a: unknown) => { calls.replies.push(typeof a === 'string' ? a : String((a as { content?: string }).content)); },
    editReply: async (a: unknown) => { calls.replies.push(typeof a === 'string' ? a : String((a as { content?: string }).content)); },
  };
  return interaction as never;
}

const acted = (c: Calls): number => c.ban.length + c.kick.length + c.timeout.length;

// ---- /ban /kick /timeout ----------------------------------------------------------------------------------

for (const name of ['ban', 'kick', 'timeout'] as const) {
  describe(`/${name} hierarchy and target checks`, () => {
    const run = async (setup: Setup) => {
      const calls = newCalls();
      await commands.get(name)!.execute(build(setup, calls));
      return calls;
    };
    const members = (c: Calls, mod = 5, victim = 2, flags = {}) => ({
      [MOD]: fakeMember(MOD, mod, c),
      [VICTIM]: fakeMember(VICTIM, victim, c, flags),
      [BOT]: fakeMember(BOT, 50, c),
      [OWNER]: fakeMember(OWNER, 99, c),
    });

    it('DM context: refuses without touching anything', async () => {
      const c = await run({ dm: true, members: {} });
      assert.equal(acted(c), 0);
      assert.match(c.replies[0] ?? '', /nur auf einem Server/);
    });

    it('allows a higher-ranked moderator (exactly one API call)', async () => {
      const calls = newCalls();
      await commands.get(name)!.execute(build({ members: members(calls) }, calls));
      assert.equal(acted(calls), 1);
      assert.match(calls.replies.at(-1) ?? '', /gebannt|gekickt|getimeoutet/);
    });

    it('target with a higher role than the invoker is denied', async () => {
      const calls = newCalls();
      await commands.get(name)!.execute(build({ members: members(calls, 2, 5) }, calls));
      assert.equal(acted(calls), 0);
      assert.match(calls.replies[0] ?? '', /höchste Rolle muss über/);
    });

    it('target with the same role position as the invoker is denied', async () => {
      const calls = newCalls();
      await commands.get(name)!.execute(build({ members: members(calls, 4, 4) }, calls));
      assert.equal(acted(calls), 0);
      assert.match(calls.replies[0] ?? '', /höchste Rolle muss über/);
    });

    it('target above the bot (not bannable/kickable/moderatable) is denied with the bot-role message', async () => {
      const calls = newCalls();
      await commands.get(name)!.execute(
        build({ members: members(calls, 5, 2, { bannable: false, kickable: false, moderatable: false }) }, calls),
      );
      assert.equal(acted(calls), 0);
      assert.match(calls.replies[0] ?? '', /Bot-Rolle muss über der Ziel-Rolle/);
    });

    it('self target is denied', async () => {
      const calls = newCalls();
      await commands.get(name)!.execute(build({ target: MOD, members: members(calls) }, calls));
      assert.equal(acted(calls), 0);
      assert.match(calls.replies[0] ?? '', /nicht selbst/);
    });

    it('bot target is denied', async () => {
      const calls = newCalls();
      await commands.get(name)!.execute(build({ target: BOT, members: members(calls) }, calls));
      assert.equal(acted(calls), 0);
      assert.match(calls.replies[0] ?? '', /Bot selbst/);
    });

    it('guild owner target is denied even for the highest moderator role', async () => {
      const calls = newCalls();
      await commands.get(name)!.execute(build({ target: OWNER, members: members(calls, 98) }, calls));
      assert.equal(acted(calls), 0);
      assert.match(calls.replies[0] ?? '', /Server-Owner/);
    });

    it('invoker that cannot be resolved fails closed', async () => {
      const calls = newCalls();
      await commands.get(name)!.execute(build({ invokerFetchFails: true, members: members(calls) }, calls));
      assert.equal(acted(calls), 0);
      assert.match(calls.replies[0] ?? '', /Rollen konnten nicht geprüft/);
    });

    it('the guild owner may act on anyone but the owner/bot/self rules still hold', async () => {
      const calls = newCalls();
      const m = { ...members(calls, 1, 90), [OWNER]: fakeMember(OWNER, 99, calls) };
      await commands.get(name)!.execute(build({ invokerId: OWNER, members: m }, calls));
      assert.equal(acted(calls), 1);
      const calls2 = newCalls();
      await commands.get(name)!.execute(build({ invokerId: OWNER, target: OWNER, members: { [OWNER]: fakeMember(OWNER, 99, calls2) } }, calls2));
      assert.equal(acted(calls2), 0);
    });

    it('non-member target', async () => {
      const calls = newCalls();
      await commands.get(name)!.execute(build({ target: GONE, members: members(calls) }, calls));
      if (name === 'ban') {
        // Banning a user who already left by ID is intended; no hierarchy exists to compare.
        assert.equal(calls.ban.length, 1);
        assert.equal(calls.ban[0]?.[0], GONE);
      } else {
        assert.equal(acted(calls), 0);
        assert.equal(calls.replies[0], 'User ist nicht im Server.');
      }
    });
  });
}

describe('/ban details', () => {
  it('passes the reason window as seconds and never bans an owner/bot by id', async () => {
    const calls = newCalls();
    const members = { [MOD]: fakeMember(MOD, 5, calls), [VICTIM]: fakeMember(VICTIM, 2, calls) };
    await commands.get('ban')!.execute(build({ members }, calls));
    assert.deepEqual(calls.ban[0]?.[1], { reason: undefined, deleteMessageSeconds: 0 });
    const c2 = newCalls();
    await commands.get('ban')!.execute(build({ target: OWNER, members: {} }, c2));
    await commands.get('ban')!.execute(build({ target: BOT, members: {} }, c2));
    assert.equal(c2.ban.length, 0);
  });
});

// ---- /warn ----------------------------------------------------------------------------------------------

describe('/warn', () => {
  const warnCount = (): number => db.select().from(warnings).all().length;

  it('DM context records nothing', async () => {
    const before = warnCount();
    const calls = newCalls();
    await commands.get('warn')!.execute(build({ dm: true, members: {} }, calls));
    assert.equal(warnCount(), before);
    assert.match(calls.replies[0] ?? '', /nur auf einem Server/);
  });

  it('records the warning but skips auto-escalation against an equal/higher target, owner, bot and self', async () => {
    setSetting('warnEscalationEnabled', true);
    setSetting('warnEscalationTimeoutAt', 1);
    setSetting('warnEscalationKickAt', 2);
    const cases: Array<{ label: string; setup: (c: Calls) => Setup; reply: RegExp }> = [
      { label: 'higher target', setup: (c) => ({ members: { [MOD]: fakeMember(MOD, 2, c), [VICTIM]: fakeMember(VICTIM, 9, c) } }), reply: /übersprungen.*höchste Rolle/ },
      { label: 'equal target', setup: (c) => ({ members: { [MOD]: fakeMember(MOD, 4, c), [VICTIM]: fakeMember(VICTIM, 4, c) } }), reply: /übersprungen.*höchste Rolle/ },
      { label: 'owner', setup: (c) => ({ target: OWNER, members: { [MOD]: fakeMember(MOD, 98, c), [OWNER]: fakeMember(OWNER, 99, c) } }), reply: /übersprungen.*Server-Owner/ },
      { label: 'bot', setup: (c) => ({ target: BOT, members: { [MOD]: fakeMember(MOD, 5, c), [BOT]: fakeMember(BOT, 1, c) } }), reply: /übersprungen.*Bot selbst/ },
      { label: 'self', setup: (c) => ({ target: MOD, members: { [MOD]: fakeMember(MOD, 5, c) } }), reply: /übersprungen.*nicht selbst/ },
      { label: 'bot role below target (not moderatable)', setup: (c) => ({ members: { [MOD]: fakeMember(MOD, 5, c), [VICTIM]: fakeMember(VICTIM, 2, c, { moderatable: false, kickable: false }) } }), reply: /übersprungen.*Bot-Rolle/ },
    ];
    for (const k of cases) {
      const before = warnCount();
      const calls = newCalls();
      await commands.get('warn')!.execute(build(k.setup(calls), calls));
      assert.equal(warnCount(), before + 1, `${k.label}: warning recorded`);
      assert.equal(acted(calls), 0, `${k.label}: no kick/timeout`);
      assert.match(calls.replies.at(-1) ?? '', k.reply, k.label);
    }
  });

  it('escalates when the moderator outranks the target, and a non-member only gets the warning', async () => {
    setSetting('warnEscalationEnabled', true);
    setSetting('warnEscalationTimeoutAt', 1);
    setSetting('warnEscalationKickAt', 0);
    const calls = newCalls();
    await commands.get('warn')!.execute(build({ members: { [MOD]: fakeMember(MOD, 5, calls), [VICTIM]: fakeMember(VICTIM, 2, calls) } }, calls));
    assert.equal(calls.timeout.length, 1);
    const none = newCalls();
    await commands.get('warn')!.execute(build({ target: GONE, members: { [MOD]: fakeMember(MOD, 5, none) } }, none));
    assert.equal(acted(none), 0);
    assert.match(none.replies.at(-1) ?? '', /verwarnt/);
    setSetting('warnEscalationEnabled', false);
  });
});

// ---- /purge /slowmode /purge-user channel authority -------------------------------------------------------

function perms(...flags: bigint[]): PermissionsBitField { return new PermissionsBitField(flags); }

function fakeChannel(opts: { id?: string; invokerPerms: PermissionsBitField | null; botPerms?: PermissionsBitField; deleted?: string[]; slow?: number[] }) {
  const msgs = new Collection<string, { id: string; author: { id: string } }>([
    ['1', { id: '1', author: { id: VICTIM } }],
    ['2', { id: '2', author: { id: MOD } }],
  ]);
  return {
    id: opts.id ?? '1400000000000000500',
    name: 'general',
    type: ChannelType.GuildText,
    toString: () => '<#1400000000000000500>',
    isDMBased: () => false,
    permissionsFor: (who: { id: string }) => (who.id === BOT ? (opts.botPerms ?? perms(P.Administrator)) : opts.invokerPerms),
    messages: { fetch: async () => msgs },
    bulkDelete: async (list: Array<{ id: string }>) => {
      for (const m of list) opts.deleted?.push(m.id);
      return new Collection(list.map((m) => [m.id, m]));
    },
    setRateLimitPerUser: async (s: number) => { opts.slow?.push(s); },
  };
}

function channelInteraction(channel: ReturnType<typeof fakeChannel> | null, calls: Calls, extra: { dm?: boolean; invokerFetchFails?: boolean; seconds?: number; count?: number } = {}) {
  const guild = extra.dm ? null : {
    id: process.env.DISCORD_GUILD_ID,
    ownerId: OWNER,
    channels: { cache: new Collection(channel ? [[channel.id, channel]] : []), fetch: async () => null },
    members: {
      fetch: async (id: string) => { if (extra.invokerFetchFails) throw new Error('x'); return { id }; },
      fetchMe: async () => ({ id: BOT }),
    },
  };
  return {
    user: fakeUser(MOD),
    guild,
    channel: extra.dm ? { isDMBased: () => true } : channel,
    options: {
      getBoolean: () => false,
      getInteger: (n: string) => (n === 'seconds' ? (extra.seconds ?? 5) : n === 'count' ? (extra.count ?? 10) : null),
      getUser: (n: string) => (n === 'target' ? fakeUser(VICTIM) : null),
      getString: () => null,
    },
    deferReply: async () => {},
    reply: async (a: unknown) => { calls.replies.push(typeof a === 'string' ? a : String((a as { content?: string }).content)); },
    editReply: async (a: unknown) => { calls.replies.push(typeof a === 'string' ? a : String((a as { content?: string }).content)); },
  } as never;
}

describe('/purge channel authority (gap fix: invoker needs the rights in this channel)', () => {
  const FULL = perms(P.ViewChannel, P.ManageMessages, P.ReadMessageHistory);

  it('deletes when the moderator holds the channel permissions', async () => {
    const deleted: string[] = [];
    const calls = newCalls();
    await commands.get('purge')!.execute(channelInteraction(fakeChannel({ invokerPerms: FULL, deleted }), calls));
    assert.deepEqual(deleted.sort(), ['1', '2']);
    assert.match(calls.replies.at(-1) ?? '', /2\*\* Nachrichten gelöscht/);
  });

  it('refuses when a channel overwrite strips ManageMessages from the moderator', async () => {
    const deleted: string[] = [];
    const calls = newCalls();
    await commands.get('purge')!.execute(channelInteraction(fakeChannel({ invokerPerms: perms(P.ViewChannel, P.ReadMessageHistory), deleted }), calls));
    assert.deepEqual(deleted, []);
    assert.match(calls.replies.at(-1) ?? '', /Dir fehlen in <#1400000000000000500> die Rechte: `Nachrichten verwalten`/);
  });

  it('refuses when the moderator cannot see the channel or the member cannot be resolved (fail closed)', async () => {
    const deleted: string[] = [];
    const calls = newCalls();
    await commands.get('purge')!.execute(channelInteraction(fakeChannel({ invokerPerms: null, deleted }), calls));
    await commands.get('purge')!.execute(channelInteraction(fakeChannel({ invokerPerms: FULL, deleted }), calls, { invokerFetchFails: true }));
    assert.deepEqual(deleted, []);
    assert.equal(calls.replies.length, 2);
  });

  it('DM context is refused', async () => {
    const calls = newCalls();
    await commands.get('purge')!.execute(channelInteraction(null, calls, { dm: true }));
    assert.match(calls.replies[0] ?? '', /Nur in Server-Textkanälen/);
  });
});

describe('/slowmode channel authority (gap fix)', () => {
  it('sets slowmode only when the moderator may manage this channel', async () => {
    const slow: number[] = [];
    const ok = newCalls();
    await commands.get('slowmode')!.execute(channelInteraction(fakeChannel({ invokerPerms: perms(P.ViewChannel, P.ManageChannels), slow }), ok, { seconds: 30 }));
    assert.deepEqual(slow, [30]);
    const denied = newCalls();
    await commands.get('slowmode')!.execute(channelInteraction(fakeChannel({ invokerPerms: perms(P.ViewChannel), slow }), denied, { seconds: 60 }));
    await commands.get('slowmode')!.execute(channelInteraction(fakeChannel({ invokerPerms: null, slow }), denied, { seconds: 60 }));
    assert.deepEqual(slow, [30]);
    assert.match(denied.replies[0] ?? '', /Rechte: `Kanäle verwalten`/);
  });

  it('DM context is refused', async () => {
    const calls = newCalls();
    await commands.get('slowmode')!.execute(channelInteraction(null, calls, { dm: true }));
    assert.match(calls.replies[0] ?? '', /nur auf einem Server/);
  });
});

describe('/purge-user respects both the bot and the moderator channel rights', () => {
  it('skips channels where the moderator lacks rights; DM refused', async () => {
    const deleted: string[] = [];
    const calls = newCalls();
    const ch = fakeChannel({ invokerPerms: perms(P.ViewChannel), deleted });
    await commands.get('purge-user')!.execute(channelInteraction(ch, calls));
    assert.deepEqual(deleted, []);
    assert.match(calls.replies.at(-1) ?? '', /dir fehlen dort Rechte/);
    const ok = fakeChannel({ invokerPerms: perms(P.ViewChannel, P.ManageMessages, P.ReadMessageHistory), deleted });
    await commands.get('purge-user')!.execute(channelInteraction(ok, newCalls()));
    assert.deepEqual(deleted, ['1']);
    const dm = newCalls();
    await commands.get('purge-user')!.execute(channelInteraction(null, dm, { dm: true }));
    assert.match(dm.replies[0] ?? '', /Nur in Servern/);
  });

  it('fails closed when the moderator cannot be resolved', async () => {
    const deleted: string[] = [];
    const calls = newCalls();
    await commands.get('purge-user')!.execute(channelInteraction(fakeChannel({ invokerPerms: perms(P.Administrator), deleted }), calls, { invokerFetchFails: true }));
    assert.deepEqual(deleted, []);
    assert.match(calls.replies[0] ?? '', /Rechte konnten nicht geprüft/);
  });
});
