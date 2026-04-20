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

export const channelConfig = sqliteTable('channel_config', {
  guildId: text('guild_id').notNull(),
  key: text('key').notNull(),
  channelId: text('channel_id').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
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

export const reminders = sqliteTable('reminders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  guildId: text('guild_id'),
  channelId: text('channel_id'),
  message: text('message').notNull(),
  dueAt: integer('due_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const userXp = sqliteTable('user_xp', {
  guildId: text('guild_id').notNull(),
  userId: text('user_id').notNull(),
  xp: integer('xp').notNull().default(0),
  level: integer('level').notNull().default(0),
  messagesCounted: integer('messages_counted').notNull().default(0),
  lastGrantedAt: integer('last_granted_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const rolePanels = sqliteTable('role_panels', {
  guildId: text('guild_id').notNull(),
  channelId: text('channel_id').notNull(),
  messageId: text('message_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  roles: text('roles', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const starboardPosts = sqliteTable('starboard_posts', {
  guildId: text('guild_id').notNull(),
  originalMessageId: text('original_message_id').notNull(),
  originalChannelId: text('original_channel_id').notNull(),
  starboardMessageId: text('starboard_message_id').notNull(),
  starCount: integer('star_count').notNull(),
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
export type RolePanel = typeof rolePanels.$inferSelect;
export type NewRolePanel = typeof rolePanels.$inferInsert;
export type StarboardPost = typeof starboardPosts.$inferSelect;
export type NewStarboardPost = typeof starboardPosts.$inferInsert;

export interface RolePanelEntry {
  roleId: string;
  label: string;
  emoji?: string;
}
