/**
 * Shared glue of the four role CLIs (backup / inventory / apply / restore). Runs INSIDE the bot container: token,
 * guild and database come from its env/volume and are never printed. Output is counters, role names and channel
 * names only – no user ids or names, no member lists.
 */
import { dirname, join, resolve } from 'node:path';
import { config } from '../config.js';
import { sqliteHandle } from '../db/client.js';
import { getAllSettings } from '../settings.js';
import { DiscordRest } from './rest.js';
import { collectRoleRefs, type RoleRefs } from './roles-refs.js';
import { takeRolesSnapshot } from './roles-snapshot.js';
import type { RolesSnapshot } from './roles-model.js';

export const AUDIT_REASON = 'Rollen-Aufräumen';

/** Default backup directory: next to the database (the mounted /app/data volume), uid 99 can write there. */
export function defaultRolesBackupDir(): string {
  return join(dirname(resolve(config.DATABASE_PATH)), 'roles-backups');
}

export function optionValue(argv: readonly string[], name: string): string | undefined {
  const hit = argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
}

export function assertKnownOptions(argv: readonly string[], flags: readonly string[], valued: readonly string[]): void {
  for (const a of argv) {
    const [k] = a.split('=', 1);
    if (!(flags.includes(a) || (valued.includes(k as string) && a.includes('=')))) {
      throw new Error(`Unbekannte Option: ${k} (erlaubt: ${[...flags, ...valued.map((v) => `${v}=…`)].join(', ')})`);
    }
  }
}

export function protectedUserIds(): string[] {
  return (config.ADMIN_USER_IDS ?? '').split(/[\s,]+/).filter((s) => /^\d{17,20}$/.test(s));
}

export function loadRefs(): RoleRefs {
  return collectRoleRefs({
    db: sqliteHandle,
    guildId: config.DISCORD_GUILD_ID,
    settings: getAllSettings() as unknown as Record<string, unknown>,
    autoRoleEnv: config.AUTO_ROLE_ID,
    rioThresholdsEnv: config.RIO_ROLE_THRESHOLDS,
  });
}

export function makeRest(reason = AUDIT_REASON): DiscordRest {
  return new DiscordRest(config.DISCORD_TOKEN, reason);
}

export async function loadSnapshot(rest: DiscordRest, refs: RoleRefs, allowMissingChannels = false): Promise<RolesSnapshot> {
  const snap = await takeRolesSnapshot(rest, config.DISCORD_GUILD_ID, [...refs.channelIds]);
  if (allowMissingChannels && snap.missingKnownChannels) {
    snap.notes.push(`--allow-missing-channels: ${snap.missingKnownChannels} fehlende Kanal-ID(s) bewusst akzeptiert`);
    snap.missingKnownChannels = 0;
  }
  return snap;
}

/** Status only: DiscordError text carries ids (paths) and must not be printed. */
export function fail(err: unknown): never {
  const status = (err as { status?: number }).status;
  process.stderr.write(`Abgebrochen${status ? ` (HTTP ${status})` : `: ${String((err as Error).message ?? err).slice(0, 160)}`}\n`);
  process.exit(1);
}

export function finish(code: number, output: string): void {
  process.stdout.write(output, () => process.exit(code));
}
