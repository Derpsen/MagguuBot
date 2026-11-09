import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = join(HERE, '../src/server/admin/index.ts');

/** Characterization: every adminRouter.(get|post|put|patch|delete) path in source, ordered. */
const EXPECTED = [
  'GET /me',
  'POST /logout',
  'GET /search',
  'GET /stats',
  'GET /services/health',
  'GET /warnings',
  'DELETE /warnings/:id',
  'GET /xp',
  'GET /webhooks',
  'GET /webhooks/health',
  'POST /webhooks/:id/replay',
  'GET /rss',
  'POST /rss',
  'PATCH /rss/:id',
  'DELETE /rss/:id',
  'DELETE /webhooks',
  'GET /settings',
  'PUT /settings',
  'GET /guild',
  'POST /auto-role/reconcile',
  'GET /channels',
  'PUT /channels/:key',
  'GET /reminders',
  'DELETE /reminders/:id',
  'GET /seerr',
  'GET /seerr/weekly',
  'POST /seerr/:id/approve',
  'POST /seerr/:id/decline',
  'GET /role-panels',
  'DELETE /role-panels/:messageId',
  'GET /tags',
  'POST /tags',
  'DELETE /tags/:name',
  'GET /autoresponders',
  'POST /autoresponders',
  'PATCH /autoresponders/:id',
  'DELETE /autoresponders/:id',
  'GET /scheduled',
  'PATCH /scheduled/:id',
  'DELETE /scheduled/:id',
  'GET /tickets',
  'POST /tickets/:id/close',
  'GET /reputation',
  'GET /audit-log',
  'POST /sessions/revoke',
] as const;

function extractRoutes(src: string): string[] {
  const out: string[] = [];
  const re = /adminRouter\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(`${m[1].toUpperCase()} ${m[2]}`);
  return out;
}

test('admin router requires admin on every route', () => {
  const src = readFileSync(ADMIN_SRC, 'utf8');
  assert.match(src, /adminRouter\.use\('\*', requireAdmin\)/);
});

test('admin route surface (method + path) matches the pinned inventory', () => {
  const src = readFileSync(ADMIN_SRC, 'utf8');
  const got = extractRoutes(src);
  assert.deepEqual(got, [...EXPECTED], 'admin route added/removed/renamed — update EXPECTED deliberately');
  assert.ok(got.length >= 30, `expected a dense admin surface, got ${got.length}`);
});
