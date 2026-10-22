import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Command modules pull in config + DB; give them a throwaway environment (no network, no token use).
const dir = mkdtempSync(join(tmpdir(), 'magguu-commands-'));
process.env.DISCORD_TOKEN ??= 'test-token-not-used';
process.env.DISCORD_CLIENT_ID ??= '1498095100000000001';
process.env.DISCORD_GUILD_ID ??= '1400000000000000099';
process.env.WEBHOOK_SECRET ??= 'test-secret-0123456789abcdef';
process.env.DATABASE_PATH = join(dir, 'bot.db');

const { commands } = await import('../src/discord/commands/index.ts');
const { REMOVED_SERVICES } = await import('../src/rollout/acceptance-plan.ts');

interface Opt { type: number; name: string; description: string; options?: Opt[]; choices?: Array<{ name: string; value: unknown }> }
const all = [...commands.values()].map((c) => ({ cmd: c, json: c.data.toJSON() as unknown as { name: string; description: string; default_member_permissions?: string | null; options?: Opt[] } }));

const NAME = /^[-_\p{Ll}\p{N}]{1,32}$/u;

function walk(options: Opt[] | undefined, path: string, visit: (o: Opt, path: string) => void): void {
  for (const o of options ?? []) {
    visit(o, `${path} ${o.name}`);
    walk(o.options, `${path} ${o.name}`, visit);
  }
}

test('every command builder produces a valid Discord payload', () => {
  assert.ok(all.length > 10, 'commands registered');
  const names = new Set<string>();
  for (const { json } of all) {
    assert.match(json.name, NAME, json.name);
    assert.ok(!names.has(json.name), `duplicate /${json.name}`);
    names.add(json.name);
    assert.ok(json.description.length >= 1 && json.description.length <= 100, `/${json.name} description`);
    assert.ok((json.options ?? []).length <= 25, `/${json.name} too many options`);
    assert.ok(JSON.stringify(json).length < 8000, `/${json.name} payload too large`);
    walk(json.options, `/${json.name}`, (o, path) => {
      assert.match(o.name, NAME, path);
      assert.ok(o.description.length >= 1 && o.description.length <= 100, `${path} description`);
      assert.ok((o.choices ?? []).length <= 25, `${path} choices`);
      assert.ok((o.options ?? []).length <= 25, `${path} options`);
    });
    // Required options must precede optional ones (Discord rejects otherwise).
    const check = (opts: Opt[] | undefined): void => {
      const flat = (opts ?? []).filter((o) => o.type !== 1 && o.type !== 2) as Array<Opt & { required?: boolean }>;
      let seenOptional = false;
      for (const o of flat) {
        if (!o.required) seenOptional = true;
        else assert.ok(!seenOptional, `/${json.name}: required ${o.name} after optional`);
      }
      for (const o of opts ?? []) if (o.type === 1 || o.type === 2) check(o.options);
    };
    check(json.options);
  }
});

const ADMINISTRATOR = 8n;
/** Server-changing commands: only Administrator may see them. */
const ADMIN_ONLY = ['setup-server', 'cleanup-server', 'db-backup', 'db-restore', 'doctor', 'downloads-live', 'lockdown', 'roles-panel', 'autoresponder', 'ticket-panel', 'jtc'];
/** Moderation/staff commands: hidden behind a permission. */
const STAFF = ['warn', 'timeout', 'kick', 'ban', 'unban', 'purge', 'purge-user', 'slowmode', 'announce', 'countdown', 'schedule-announce', 'sticky', 'suggestion-status', 'snipe', 'editsnipe', 'giveaway'];

test('admin and moderator commands are hidden by default_member_permissions', () => {
  const byName = new Map(all.map(({ json }) => [json.name, json]));
  for (const name of ADMIN_ONLY) {
    const json = byName.get(name);
    assert.ok(json, `/${name} missing`);
    assert.equal(BigInt(json.default_member_permissions ?? '0') & ADMINISTRATOR, ADMINISTRATOR, `/${name} must require Administrator`);
  }
  for (const name of STAFF) {
    const json = byName.get(name);
    assert.ok(json, `/${name} missing`);
    assert.ok(json.default_member_permissions && BigInt(json.default_member_permissions) > 0n, `/${name} must not be visible to everyone`);
  }
  for (const { json } of all) {
    if (/^admin\b|\(admin|mod-only/i.test(json.description)) assert.ok(json.default_member_permissions, `/${json.name} says admin but is public`);
  }
});

test('no command exists for a removed service', () => {
  for (const { json } of all) assert.ok(!REMOVED_SERVICES.test(JSON.stringify(json)), `/${json.name} mentions a removed service`);
});

test('every command has an execute handler keyed by its name', () => {
  for (const [name, cmd] of commands) {
    assert.equal(cmd.data.name, name);
    assert.equal(typeof cmd.execute, 'function', `/${name}`);
  }
});
