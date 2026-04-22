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
runMigrations();

export const db = drizzle(sqlite, { schema });
export const sqliteHandle = sqlite;

function addColumnIfMissing(table: string, column: string, type: string): void {
  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (err) {
    if (err instanceof Error && /duplicate column/i.test(err.message)) return;
    throw err;
  }
}

function runMigrations(): void {
  addColumnIfMissing('autoresponders', 'auto_delete_seconds', 'INTEGER');
}

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

    CREATE TABLE IF NOT EXISTS warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      reason TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_warnings_user ON warnings(guild_id, user_id);

    CREATE TABLE IF NOT EXISTS channel_config (
      guild_id TEXT NOT NULL,
      key TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, key)
    );

    CREATE TABLE IF NOT EXISTS welcome_messages (
      guild_id TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, plan_name)
    );

    CREATE TABLE IF NOT EXISTS rss_feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      exclude_keywords TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      seen_guids TEXT,
      last_run_at INTEGER,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rss_feeds_enabled ON rss_feeds(guild_id, enabled);

    CREATE TABLE IF NOT EXISTS countdowns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      target_at INTEGER NOT NULL,
      finished INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_rendered_label TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_countdowns_active ON countdowns(finished, target_at);

    CREATE TABLE IF NOT EXISTS sticky_messages (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      content TEXT NOT NULL,
      current_message_id TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      guild_id TEXT,
      channel_id TEXT,
      message TEXT NOT NULL,
      due_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(due_at);

    CREATE TABLE IF NOT EXISTS user_xp (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 0,
      messages_counted INTEGER NOT NULL DEFAULT 0,
      last_granted_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_xp_leaderboard ON user_xp(guild_id, xp DESC);

    CREATE TABLE IF NOT EXISTS role_panels (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      roles TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_role_panels_channel ON role_panels(guild_id, channel_id);

    CREATE TABLE IF NOT EXISTS starboard_posts (
      guild_id TEXT NOT NULL,
      original_message_id TEXT NOT NULL,
      original_channel_id TEXT NOT NULL,
      starboard_message_id TEXT NOT NULL,
      star_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, original_message_id)
    );

    CREATE TABLE IF NOT EXISTS bot_settings (
      guild_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, key)
    );

    CREATE TABLE IF NOT EXISTS custom_commands (
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      response TEXT NOT NULL,
      created_by TEXT NOT NULL,
      uses INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, name)
    );

    CREATE TABLE IF NOT EXISTS autoresponders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      pattern TEXT NOT NULL,
      response TEXT NOT NULL,
      match_type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      auto_delete_seconds INTEGER,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_autoresponders_guild ON autoresponders(guild_id, enabled);

    CREATE TABLE IF NOT EXISTS scheduled_announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT 'brand',
      fire_at INTEGER NOT NULL,
      fired INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_due ON scheduled_announcements(fired, fire_at);

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL UNIQUE,
      opener_id TEXT NOT NULL,
      topic TEXT,
      closed_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_open ON tickets(guild_id, closed_at);

    CREATE TABLE IF NOT EXISTS reputation (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      rep INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_reputation_leaderboard ON reputation(guild_id, rep DESC);

    CREATE TABLE IF NOT EXISTS reputation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      giver_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reputation_log_giver ON reputation_log(guild_id, giver_id, created_at DESC);
  `);
}
