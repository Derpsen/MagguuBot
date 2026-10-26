#!/usr/bin/env node
// undici-8-lock watch (read-only, no bump, no PR, no dependency change).
// The undici >=8 lock in renovate.json stays until Marco/Buddy decide. This only reports WHEN it may be time to look:
//   (a) discord.js `latest` on npm reached major 15 or higher
//   (b) the latest discord.js or @discordjs/rest depends on an undici range whose lowest allowed major is 8 or higher
// Usage: node scripts/undici-watch.mjs [--fixture file.json] [--out result.json]
//   --fixture  offline test input {"discord.js": {version, dependencies}, "@discordjs/rest": {...}}
//   --out      writes {state, issues:[{title, body}]} for tools/undici-watch-issue.sh (default: undici-watch.json)
// Exit 0 always on success (also when it reports), 1 when npm cannot be read (the run turns red, no issue).
import { readFile, writeFile } from 'node:fs/promises';

const PACKAGES = ['discord.js', '@discordjs/rest'];
export const TITLE_MAJOR = 'undici-8-Lock prüfen: discord.js latest ist Major 15 oder höher';
export const TITLE_UNDICI = 'undici-8-Lock prüfen: discord.js/@discordjs/rest latest nutzt undici ^8';
const LOCK_NOTE = 'Möglicher Zeitpunkt, den undici-8-Lock zu prüfen. Der Lock in `renovate.json` bleibt bestehen; es wurde nichts geändert, kein PR, kein Bump. Die Entscheidung liegt bei Marco/Buddy.';

// Lowest allowed major of each alternative of a semver range ("^7 || ^8" -> [7, 8]). We flag when ANY alternative starts at 8 or higher;
// an open range like ">=6" is not flagged (its lowest major is 6).
export function rangeMinMajors(range) {
  return String(range ?? '')
    .split('||')
    .map((part) => /(\d+)/.exec(part)?.[1])
    .filter((n) => n !== undefined)
    .map(Number);
}

export function evaluate(data) {
  const dj = data['discord.js'] ?? {};
  const rest = data['@discordjs/rest'] ?? {};
  const djMajor = Number.parseInt(String(dj.version ?? '').split('.')[0] ?? '', 10);
  const state = {
    'discord.js': { version: dj.version ?? null, undici: dj.dependencies?.undici ?? null },
    '@discordjs/rest': { version: rest.version ?? null, undici: rest.dependencies?.undici ?? null },
  };
  const issues = [];
  if (Number.isFinite(djMajor) && djMajor >= 15) {
    issues.push({
      title: TITLE_MAJOR,
      body: `${LOCK_NOTE}\n\nAuslöser: discord.js \`latest\` auf npm ist ${dj.version} (Major 15 oder höher).\n\nIst-Stand: discord.js ${state['discord.js'].version} (undici ${state['discord.js'].undici ?? 'keine Angabe'}), @discordjs/rest ${state['@discordjs/rest'].version} (undici ${state['@discordjs/rest'].undici ?? 'keine Angabe'}).`,
    });
  }
  const hits = PACKAGES.filter((p) => rangeMinMajors(state[p].undici).some((m) => m >= 8));
  if (hits.length > 0) {
    issues.push({
      title: TITLE_UNDICI,
      body: `${LOCK_NOTE}\n\nAuslöser: ${hits.map((p) => `${p} ${state[p].version} verlangt undici \`${state[p].undici}\``).join('; ')}.\n\nIst-Stand: discord.js ${state['discord.js'].version} (undici ${state['discord.js'].undici ?? 'keine Angabe'}), @discordjs/rest ${state['@discordjs/rest'].version} (undici ${state['@discordjs/rest'].undici ?? 'keine Angabe'}).`,
    });
  }
  return { state, issues };
}

async function fetchLatest(pkg) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}/latest`, { headers: { accept: 'application/json', 'user-agent': 'magguu-undici-watch' } });
      if (!res.ok) throw new Error(`npm registry ${pkg}: ${res.status}`);
      const j = await res.json();
      return { version: j.version, dependencies: j.dependencies ?? {} };
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const fixture = opt('--fixture');
  const out = opt('--out') ?? 'undici-watch.json';
  let data;
  if (fixture) data = JSON.parse(await readFile(fixture, 'utf8'));
  else data = Object.fromEntries(await Promise.all(PACKAGES.map(async (p) => [p, await fetchLatest(p)])));
  const result = evaluate(data);
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
  const s = result.state;
  console.log(`undici-watch: discord.js ${s['discord.js'].version} (undici ${s['discord.js'].undici}), @discordjs/rest ${s['@discordjs/rest'].version} (undici ${s['@discordjs/rest'].undici}); ${result.issues.length} Meldung(en)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`::error::undici-watch: ${e.message}`); process.exit(1); });
}
