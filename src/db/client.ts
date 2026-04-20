import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { config } from '../config.js';
import * as schema from './schema.js';

const path = resolve(config.DATABASE_PATH);
mkdirSync(dirname(path), { recursive: true });

const sqlite = new Database(path);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('foreign_keys = ON');

ensureSchema();

export const db = drizzle(sqlite, { schema });

function ensureSchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      channel_id TEXT,
      message_id TEXT,
      status TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_events_created ON webhook_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_webhook_events_source ON webhook_events(source, event_type);

    CREATE TABLE IF NOT EXISTS seerr_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seerr_request_id INTEGER NOT NULL UNIQUE,
      message_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      media_type TEXT NOT NULL,
      tmdb_id INTEGER,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_by TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_seerr_status ON seerr_requests(status);
  `);
}
