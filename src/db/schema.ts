import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const webhookEvents = sqliteTable('webhook_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source').notNull(),
  eventType: text('event_type').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  channelId: text('channel_id'),
  messageId: text('message_id'),
  status: text('status', { enum: ['posted', 'failed', 'skipped'] }).notNull(),
  error: text('error'),
  retryCount: integer('retry_count').notNull().default(0),
  nextRetryAt: integer('next_retry_at', { mode: 'timestamp_ms' }),
  retryState: text('retry_state', { enum: ['pending', 'resolved', 'exhausted'] }),
  replayOfEventId: integer('replay_of_event_id'),
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
  lifecycleMessageId: text('lifecycle_message_id'),
  lifecycleChannelId: text('lifecycle_channel_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
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
  lastError: text('last_error'),
  lastErrorAt: integer('last_error_at', { mode: 'timestamp_ms' }),
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
  attempts: integer('attempts').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const userXp = sqliteTable(
  'user_xp',
  {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    xp: integer('xp').notNull().default(0),
    level: integer('level').notNull().default(0),
    messagesCounted: integer('messages_counted').notNull().default(0),
    lastGrantedAt: integer('last_granted_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.userId] }) }),
);

export const rolePanels = sqliteTable(
  'role_panels',
  {
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    roles: text('roles', { mode: 'json' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.messageId] }) }),
);

export const starboardPosts = sqliteTable(
  'starboard_posts',
  {
    guildId: text('guild_id').notNull(),
    originalMessageId: text('original_message_id').notNull(),
    originalChannelId: text('original_channel_id').notNull(),
    starboardMessageId: text('starboard_message_id').notNull(),
    starCount: integer('star_count').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.originalMessageId] }) }),
);

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

export const botSettings = sqliteTable(
  'bot_settings',
  {
    guildId: text('guild_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.key] }) }),
);

export type BotSetting = typeof botSettings.$inferSelect;

export const customCommands = sqliteTable(
  'custom_commands',
  {
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
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.name] }) }),
);

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
  recurrence: text('recurrence', { enum: ['none', 'daily', 'weekly', 'monthly'] })
    .notNull()
    .default('none'),
  lastFiredAt: integer('last_fired_at', { mode: 'timestamp_ms' }),
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
  category: text('category'),
  priority: text('priority', { enum: ['low', 'normal', 'high'] }).default('normal'),
  claimedBy: text('claimed_by'),
  claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }),
  lastActivityAt: integer('last_activity_at', { mode: 'timestamp_ms' }),
  closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
  closedBy: text('closed_by'),
  closeReason: text('close_reason'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const reputation = sqliteTable(
  'reputation',
  {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    rep: integer('rep').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.userId] }) }),
);

export const reputationLog = sqliteTable('reputation_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  giverId: text('giver_id').notNull(),
  receiverId: text('receiver_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const suggestions = sqliteTable('suggestions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  channelId: text('channel_id').notNull(),
  messageId: text('message_id').notNull(),
  authorId: text('author_id').notNull(),
  text: text('text').notNull(),
  status: text('status', { enum: ['open', 'accepted', 'denied', 'in-progress'] })
    .notNull()
    .default('open'),
  upvoters: text('upvoters', { mode: 'json' }).$type<string[]>().notNull().default([]),
  downvoters: text('downvoters', { mode: 'json' }).$type<string[]>().notNull().default([]),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type CustomCommand = typeof customCommands.$inferSelect;
export const adminAuditLog = sqliteTable('admin_audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  action: text('action').notNull(),
  target: text('target'),
  detail: text('detail'),
  ip: text('ip'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sessionRevocations = sqliteTable('session_revocations', {
  userId: text('user_id').primaryKey(),
  // All session cookies issued before this timestamp are no longer valid for
  // the user. Cheaper than a full session-id table and works with our
  // stateless HMAC cookie design.
  notValidBefore: integer('not_valid_before', { mode: 'timestamp_ms' }).notNull(),
});

export const memberHistory = sqliteTable(
  'member_history',
  {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    firstJoinedAt: integer('first_joined_at', { mode: 'timestamp_ms' }).notNull(),
    lastJoinedAt: integer('last_joined_at', { mode: 'timestamp_ms' }).notNull(),
    lastLeftAt: integer('last_left_at', { mode: 'timestamp_ms' }),
    joinCount: integer('join_count').notNull().default(1),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.userId] }) }),
);

export const afk = sqliteTable(
  'afk',
  {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    reason: text('reason').notNull(),
    setAt: integer('set_at', { mode: 'timestamp_ms' }).notNull(),
    originalNick: text('original_nick'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.userId] }) }),
);

export const giveaways = sqliteTable('giveaways', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  channelId: text('channel_id').notNull(),
  messageId: text('message_id').notNull(),
  prize: text('prize').notNull(),
  winnersCount: integer('winners_count').notNull().default(1),
  endsAt: integer('ends_at', { mode: 'timestamp_ms' }).notNull(),
  ended: integer('ended', { mode: 'boolean' }).notNull().default(false),
  hostId: text('host_id').notNull(),
  participants: text('participants', { mode: 'json' }).$type<string[]>().notNull().default([]),
  winners: text('winners', { mode: 'json' }).$type<string[]>().notNull().default([]),
  requiredRoleId: text('required_role_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const birthdays = sqliteTable(
  'birthdays',
  {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    day: integer('day').notNull(),
    month: integer('month').notNull(),
    year: integer('year'),
    lastCelebratedYear: integer('last_celebrated_year'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.userId] }) }),
);

export const jtcRooms = sqliteTable('jtc_rooms', {
  channelId: text('channel_id').primaryKey(),
  guildId: text('guild_id').notNull(),
  ownerId: text('owner_id').notNull(),
  textChannelId: text('text_channel_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const ticketCategories = sqliteTable('ticket_categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  key: text('key').notNull(),
  label: text('label').notNull(),
  emoji: text('emoji'),
  description: text('description'),
  pingRoles: text('ping_roles'),
  sortOrder: integer('sort_order').notNull().default(0),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
});

export const featureState = sqliteTable(
  'feature_state',
  {
    guildId: text('guild_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.key] }) }),
);

export const livePanels = sqliteTable(
  'live_panels',
  {
    guildId: text('guild_id').notNull(),
    kind: text('kind', { enum: ['downloads'] }).notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.kind] }) }),
);

export const plexActivityMessages = sqliteTable(
  'plex_activity_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    correlationKey: text('correlation_key').notNull(),
    sessionKey: text('session_key'),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    state: text('state').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('idx_plex_activity_correlation').on(t.guildId, t.correlationKey, t.updatedAt),
    index('idx_plex_activity_updated').on(t.updatedAt),
  ],
);

export const eventLifecycleMessages = sqliteTable(
  'event_lifecycle_messages',
  {
    guildId: text('guild_id').notNull(),
    lifecycleKey: text('lifecycle_key').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    state: text('state').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.lifecycleKey] }) }),
);

export const movieNights = sqliteTable('movie_nights', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  channelId: text('channel_id').notNull(),
  messageId: text('message_id'),
  title: text('title').notNull(),
  scheduledAt: integer('scheduled_at', { mode: 'timestamp_ms' }),
  status: text('status', { enum: ['open', 'closed', 'finished'] }).notNull().default('open'),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
});

export const movieNightNominations = sqliteTable('movie_night_nominations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  movieNightId: integer('movie_night_id').notNull(),
  title: text('title').notNull(),
  url: text('url'),
  nominatedBy: text('nominated_by').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const movieNightVotes = sqliteTable(
  'movie_night_votes',
  {
    movieNightId: integer('movie_night_id').notNull(),
    nominationId: integer('nomination_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ pk: primaryKey({ columns: [t.movieNightId, t.userId] }) }),
);

export type MemberHistory = typeof memberHistory.$inferSelect;
export type Afk = typeof afk.$inferSelect;
export type Giveaway = typeof giveaways.$inferSelect;
export type Birthday = typeof birthdays.$inferSelect;
export type JtcRoom = typeof jtcRooms.$inferSelect;
export type TicketCategory = typeof ticketCategories.$inferSelect;
export type LivePanel = typeof livePanels.$inferSelect;
export type PlexActivityMessage = typeof plexActivityMessages.$inferSelect;
export type EventLifecycleMessage = typeof eventLifecycleMessages.$inferSelect;
export type MovieNight = typeof movieNights.$inferSelect;
export type MovieNightNomination = typeof movieNightNominations.$inferSelect;

export type Autoresponder = typeof autoresponders.$inferSelect;
export type ScheduledAnnouncement = typeof scheduledAnnouncements.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type Reputation = typeof reputation.$inferSelect;
export type Suggestion = typeof suggestions.$inferSelect;
export type AdminAuditLogEntry = typeof adminAuditLog.$inferSelect;
