import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const webhookEvents = sqliteTable('webhook_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source').notNull(),
  eventType: text('event_type').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  channelId: text('channel_id'),
  messageId: text('message_id'),
  status: text('status', { enum: ['posted', 'failed', 'skipped'] }).notNull(),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const seerrRequests = sqliteTable('seerr_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seerrRequestId: integer('seerr_request_id').notNull().unique(),
  messageId: text('message_id').notNull(),
  channelId: text('channel_id').notNull(),
  mediaType: text('media_type', { enum: ['movie', 'tv'] }).notNull(),
  tmdbId: integer('tmdb_id'),
  title: text('title').notNull(),
  status: text('status', { enum: ['pending', 'approved', 'declined'] }).notNull(),
  requestedBy: text('requested_by'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const warnings = sqliteTable('warnings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  userId: text('user_id').notNull(),
  moderatorId: text('moderator_id').notNull(),
  reason: text('reason'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
export type SeerrRequest = typeof seerrRequests.$inferSelect;
export type NewSeerrRequest = typeof seerrRequests.$inferInsert;
export type Warning = typeof warnings.$inferSelect;
export type NewWarning = typeof warnings.$inferInsert;
