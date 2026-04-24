import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

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
  status: text('status', {
    enum: ['pending', 'approved', 'declined', 'available', 'failed', 'deleted'],
  }).notNull(),
  requestedBy: text('requested_by'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const channelConfig = sqliteTable(
  'channel_config',
  {
    guildId: text('guild_id').notNull(),
    key: text('key').notNull(),
    channelId: text('channel_id').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.key] }) }),
);

export const welcomeMessages = sqliteTable(
  'welcome_messages',
  {
    guildId: text('guild_id').notNull(),
    planName: text('plan_name').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.planName] }) }),
);

export const rssFeeds = sqliteTable('rss_feeds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  channelId: text('channel_id').notNull(),
  excludeKeywords: text('exclude_keywords'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  seenGuids: text('seen_guids'),
  lastRunAt: integer('last_run_at', { mode: 'timestamp_ms' }),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type RssFeed = typeof rssFeeds.$inferSelect;

export const countdowns = sqliteTable('countdowns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  channelId: text('channel_id').notNull(),
  messageId: text('message_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  targetAt: integer('target_at', { mode: 'timestamp_ms' }).notNull(),
  finished: integer('finished', { mode: 'boolean' }).notNull().default(false),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  lastRenderedLabel: text('last_rendered_label'),
});

export const stickyMessages = sqliteTable(
  'sticky_messages',
  {
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    content: text('content').notNull(),
    currentMessageId: text('current_message_id'),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.channelId] }) }),
);

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

export const botSettings = sqliteTable('bot_settings', {
  guildId: text('guild_id').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type BotSetting = typeof botSettings.$inferSelect;

export const customCommands = sqliteTable('custom_commands', {
  guildId: text('guild_id').notNull(),
  name: text('name').notNull(),
  response: text('response').notNull(),
  createdBy: text('created_by').notNull(),
  uses: integer('uses').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const autoresponders = sqliteTable('autoresponders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  pattern: text('pattern').notNull(),
  response: text('response').notNull(),
  matchType: text('match_type', { enum: ['substring', 'word', 'regex'] }).notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  autoDeleteSeconds: integer('auto_delete_seconds'),
  asEmbed: integer('as_embed', { mode: 'boolean' }).notNull().default(false),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const scheduledAnnouncements = sqliteTable('scheduled_announcements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  channelId: text('channel_id').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  color: text('color').notNull().default('brand'),
  fireAt: integer('fire_at', { mode: 'timestamp_ms' }).notNull(),
  fired: integer('fired', { mode: 'boolean' }).notNull().default(false),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const tickets = sqliteTable('tickets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  channelId: text('channel_id').notNull().unique(),
  openerId: text('opener_id').notNull(),
  topic: text('topic'),
  closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const reputation = sqliteTable('reputation', {
  guildId: text('guild_id').notNull(),
  userId: text('user_id').notNull(),
  rep: integer('rep').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const reputationLog = sqliteTable('reputation_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  giverId: text('giver_id').notNull(),
  receiverId: text('receiver_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type CustomCommand = typeof customCommands.$inferSelect;
export type Autoresponder = typeof autoresponders.$inferSelect;
export type ScheduledAnnouncement = typeof scheduledAnnouncements.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type Reputation = typeof reputation.$inferSelect;
