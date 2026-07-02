export interface SqliteMigrationTarget {
  exec(sql: string): unknown;
}

function addColumnIfMissing(sqlite: SqliteMigrationTarget, table: string, column: string, type: string): void {
  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (err) {
    if (err instanceof Error && /duplicate column/i.test(err.message)) return;
    throw err;
  }
}

export function applyWebhookRetryMigration(sqlite: SqliteMigrationTarget): void {
  addColumnIfMissing(sqlite, 'webhook_events', 'retry_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(sqlite, 'webhook_events', 'next_retry_at', 'INTEGER');
  addColumnIfMissing(sqlite, 'webhook_events', 'retry_state', 'TEXT');
  addColumnIfMissing(sqlite, 'webhook_events', 'replay_of_event_id', 'INTEGER');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_webhook_retry_due ON webhook_events(retry_state, next_retry_at)');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_webhook_replay_of ON webhook_events(replay_of_event_id)');
}
