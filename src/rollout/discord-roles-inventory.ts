/**
 * Read-only inventory: members per role (counts only), dangerous permissions, empty/unused/duplicate/managed roles,
 * roles the bot references, @everyone permissions and a visibility matrix per category. No user ids or names.
 *
 *   docker exec -u 99:100 MagguuBot node dist/rollout/discord-roles-inventory.js [--json]
 */
import { assertKnownOptions, fail, finish, loadRefs, loadSnapshot, makeRest } from './roles-cli.js';
import { buildInventory, formatInventory } from './roles-inventory.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  assertKnownOptions(argv, ['--json'], []);
  const refs = loadRefs();
  const snap = await loadSnapshot(makeRest('Rollen-Inventur (nur lesen)'), refs);
  const inv = buildInventory(snap, refs);
  finish(0, argv.includes('--json') ? `${JSON.stringify(inv)}\n` : formatInventory(inv));
}

main().catch(fail);
