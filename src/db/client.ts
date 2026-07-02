import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { config } from '../config.js';
import * as schema from './schema.js';
import { applyStagedDatabaseRestore } from './restore.js';
import { applyWebhookRetryMigration } from './webhook-retry-migration.js';

const path = resolve(config.DATABASE_PATH);
mkdirSync(dirname(path), { recursive: true });
const restoredOnBoot = applyStagedDatabaseRestore();

const sqlite = new Database(path);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('foreign_keys = ON');

// `webhook_events` is append-only and stores the full payload per hit. Without
// retention it grows unbounded over months. Prune on boot + every 24h.
const WEBHOOK_EVENTS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

ensureSchema();
runMigrations();
scheduleWebhookEventsRetention();

export const db = drizzle(sqlite, { schema });
export const sqliteHandle = sqlite;

if (restoredOnBoot) {
  void import('../utils/logger.js').then(({ logger }) => logger.warn('staged database restore applied'));
}

function pruneWebhookEvents(): void {
  const cutoff = Date.now() - WEBHOOK_EVENTS_RETENTION_MS;
  try {
    const result = sqlite.prepare('DELETE FROM webhook_events WHERE created_at < ?').run(cutoff);
    if (result.changes > 0) {
      // Lazy logger import — logger module imports config which imports this file.
      void import('../utils/logger.js').then(({ logger }) =>
        logger.info({ deleted: result.changes, cutoff }, 'webhook_events retention prune'),
      );
    }
  } catch {
    /* prune is best-effort; never crash startup */
  }
}
function scheduleWebhookEventsRetention(): void {
  pruneWebhookEvents();
  setInterval(pruneWebhookEvents, 24 * 60 * 60 * 1000).unref();
}

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
  addColumnIfMissing('autoresponders', 'as_embed', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('rss_feeds', 'last_error', 'TEXT');
  addColumnIfMissing('rss_feeds', 'last_error_at', 'INTEGER');
  addColumnIfMissing('scheduled_announcements', 'recurrence', "TEXT NOT NULL DEFAULT 'none'");
  addColumnIfMissing('scheduled_announcements', 'last_fired_at', 'INTEGER');
  addColumnIfMissing('tickets', 'category', 'TEXT');
  addColumnIfMissing('tickets', 'priority', "TEXT DEFAULT 'normal'");
  addColumnIfMissing('tickets', 'claimed_by', 'TEXT');
  addColumnIfMissing('tickets', 'claimed_at', 'INTEGER');
  addColumnIfMissing('tickets', 'last_activity_at', 'INTEGER');
  addColumnIfMissing('tickets', 'closed_by', 'TEXT');
  addColumnIfMissing('tickets', 'close_reason', 'TEXT');
  addColumnIfMissing('seerr_requests', 'lifecycle_message_id', 'TEXT');
  addColumnIfMissing('seerr_requests', 'lifecycle_channel_id', 'TEXT');
  addColumnIfMissing('seerr_requests', 'updated_at', 'INTEGER');
  addColumnIfMissing('reminders', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
  applyWebhookRetryMigration(sqlite);
  sqlite.exec('UPDATE seerr_requests SET updated_at = created_at WHERE updated_at IS NULL');
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
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at INTEGER,
      retry_state TEXT,
      replay_of_event_id INTEGER,
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
      lifecycle_message_id TEXT,
      lifecycle_channel_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER
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
      last_error TEXT,
      last_error_at INTEGER,
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
      attempts INTEGER NOT NULL DEFAULT 0,
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
      as_embed INTEGER NOT NULL DEFAULT 0,
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
      recurrence TEXT NOT NULL DEFAULT 'none',
      last_fired_at INTEGER,
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

    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      upvoters TEXT NOT NULL DEFAULT '[]',
      downvoters TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_suggestions_guild_status ON suggestions(guild_id, status);
    CREATE INDEX IF NOT EXISTS idx_suggestions_author ON suggestions(guild_id, author_id, created_at);

    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      ip TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_audit_log_user ON admin_audit_log(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at DESC);

    CREATE TABLE IF NOT EXISTS session_revocations (
      user_id TEXT PRIMARY KEY,
      not_valid_before INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS member_history (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      first_joined_at INTEGER NOT NULL,
      last_joined_at INTEGER NOT NULL,
      last_left_at INTEGER,
      join_count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS afk (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      set_at INTEGER NOT NULL,
      original_nick TEXT,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS giveaways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      prize TEXT NOT NULL,
      winners_count INTEGER NOT NULL DEFAULT 1,
      ends_at INTEGER NOT NULL,
      ended INTEGER NOT NULL DEFAULT 0,
      host_id TEXT NOT NULL,
      participants TEXT NOT NULL DEFAULT '[]',
      winners TEXT NOT NULL DEFAULT '[]',
      required_role_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_giveaways_active ON giveaways(ended, ends_at);

    CREATE TABLE IF NOT EXISTS birthdays (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      day INTEGER NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER,
      last_celebrated_year INTEGER,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_birthdays_calendar ON birthdays(month, day);

    CREATE TABLE IF NOT EXISTS jtc_rooms (
      channel_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      text_channel_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      emoji TEXT,
      description TEXT,
      ping_roles TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_categories ON ticket_categories(guild_id, enabled, sort_order);

    CREATE TABLE IF NOT EXISTS feature_state (
      guild_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, key)
    );

    CREATE TABLE IF NOT EXISTS live_panels (
      guild_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, kind)
    );

    CREATE TABLE IF NOT EXISTS plex_activity_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      correlation_key TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plex_activity_correlation
      ON plex_activity_messages(guild_id, correlation_key, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_plex_activity_updated
      ON plex_activity_messages(updated_at);

    CREATE TABLE IF NOT EXISTS movie_nights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      title TEXT NOT NULL,
      scheduled_at INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      closed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_movie_nights_status ON movie_nights(guild_id, status, scheduled_at);

    CREATE TABLE IF NOT EXISTS movie_night_nominations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_night_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      nominated_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_movie_nominations_night ON movie_night_nominations(movie_night_id);

    CREATE TABLE IF NOT EXISTS movie_night_votes (
      movie_night_id INTEGER NOT NULL,
      nomination_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (movie_night_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_movie_votes_nomination ON movie_night_votes(nomination_id);
    CREATE INDEX IF NOT EXISTS idx_movie_votes_user ON movie_night_votes(user_id, created_at);
  `);
}
