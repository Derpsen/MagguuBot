import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Guard for the module graph of src/: no NEW runtime import cycle. Only static value imports/re-exports count;
// `import type`, all-`type` specifier lists and dynamic `import()` are erased or lazy and cannot deadlock module init.
// Known, accepted cycle: /help lists the registry it is part of (read lazily inside execute, never at module init).
const ACCEPTED = [['discord/commands/help.ts', 'discord/commands/index.ts']];

const src = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') ? [join(dir, e.name)] : [],
  );
}

const STATIC = /^\s*(import|export)\s+(type\s+)?(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]/gm;

export function valueImports(file: string, code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(STATIC)) {
    const [, kind, typeOnly, clause, spec] = m;
    if (typeOnly || !spec.startsWith('.')) continue;
    if (kind === 'export' && !clause) continue; // `export ... ` without from is not an import
    const braces = /^\{([\s\S]*)\}$/.exec((clause ?? '').trim());
    if (braces && braces[1].split(',').map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith('type '))) continue;
    const target = resolve(dirname(file), spec.replace(/\.js$/, '.ts'));
    if (existsSync(target)) out.push(target);
  }
  return out;
}

function cycles(graph: Map<string, string[]>): string[][] {
  // Tarjan SCC
  let index = 0;
  const idx = new Map<string, number>(), low = new Map<string, number>(), on = new Set<string>(), stack: string[] = [], out: string[][] = [];
  const visit = (v: string): void => {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); on.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const scc: string[] = [];
      let w: string;
      do { w = stack.pop()!; on.delete(w); scc.push(w); } while (w !== v);
      if (scc.length > 1 || (graph.get(v) ?? []).includes(v)) out.push(scc.map((f) => relative(src, f)).sort());
    }
  };
  for (const v of graph.keys()) if (!idx.has(v)) visit(v);
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

test('parser: type-only and dynamic imports are not edges', () => {
  const f = join(src, 'x', 'a.ts');
  const code = [
    "import type { A } from '../discord/client.js';",
    "import { type B, type C } from '../discord/client.js';",
    "const m = await import('../discord/client.js');",
    "import { getClient } from '../discord/client-ref.js';",
    "export { x } from '../discord/client.js';",
  ].join('\n');
  assert.deepEqual(valueImports(f, code).map((p) => relative(src, p)), ['discord/client-ref.ts', 'discord/client.ts']);
});

test('src/ has no runtime import cycle beyond the accepted list', () => {
  const graph = new Map<string, string[]>();
  for (const f of tsFiles(src)) graph.set(f, valueImports(f, readFileSync(f, 'utf8')));
  assert.ok(graph.size > 100, 'walked src/');
  assert.deepEqual(cycles(graph), ACCEPTED, 'new runtime import cycle: import getClient from discord/client-ref.ts, use `import type`, or a lazy import()');
});
