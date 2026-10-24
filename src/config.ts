import { z } from 'zod';
import { DEFAULT_ADDON_REPOSITORIES } from './utils/github-routing.js';
import { emptyEnvToUndefined, envBoolean } from './utils/env.js';

const httpUrl = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'URL must use HTTP or HTTPS');
const optionalHttpUrl = z.preprocess(emptyEnvToUndefined, httpUrl.optional());
const optionalHttpsOrigin = z.preprocess(
  emptyEnvToUndefined,
  z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && url.pathname === '/'
      && !url.search
      && !url.hash;
  }, 'URL must be an HTTPS origin without path, query, hash, or credentials').optional(),
);
const optionalSecret = z.preprocess(emptyEnvToUndefined, z.string().min(16).optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),

  DISCORD_CHANNEL_GRABS: z.string().optional(),
  DISCORD_CHANNEL_IMPORTS: z.string().optional(),
  DISCORD_CHANNEL_FAILURES: z.string().optional(),
  DISCORD_CHANNEL_REQUESTS: z.string().optional(),
  DISCORD_CHANNEL_APPROVALS: z.string().optional(),
  DISCORD_CHANNEL_NEW_ON_PLEX: z.string().optional(),
  DISCORD_CHANNEL_HEALTH: z.string().optional(),
  DISCORD_CHANNEL_WELCOME: z.string().optional(),
  DISCORD_CHANNEL_AUDIT_LOG: z.string().optional(),
  DISCORD_CHANNEL_MOD_LOG: z.string().optional(),
  DISCORD_CHANNEL_GITHUB: z.string().optional(),
  DISCORD_CHANNEL_STARBOARD: z.string().optional(),
  DISCORD_CHANNEL_PLEX_ACTIVITY: z.string().optional(),
  DISCORD_CHANNEL_BLIZZARD: z.string().optional(),
  /** Legacy alias for DISCORD_CHANNEL_BLIZZARD (pre-2026-10-22 key `blueTracker`). */
  DISCORD_CHANNEL_BLUE_TRACKER: z.string().optional(),
  DISCORD_CHANNEL_ADDON_UPDATES: z.string().optional(),
  DISCORD_CHANNEL_FAQ: z.string().optional(),
  DISCORD_CHANNEL_WEEKLY_DIGEST: z.string().optional(),
  /** Optional override for the weekly Plex statistics card; default is the weeklyDigest channel. */
  DISCORD_CHANNEL_PLEX_WEEKLY: z.string().optional(),
  /** Optional override for the weekly "Neu hinzugefügt" digest; default: newOnPlex channel, then weeklyDigest. */
  DISCORD_CHANNEL_NEW_ADDED: z.string().optional(),
  DISCORD_CHANNEL_DOWNLOAD_LIVE: z.string().optional(),
  DISCORD_CHANNEL_MOVIE_NIGHT: z.string().optional(),
  DISCORD_CHANNEL_SUGGESTIONS: z.string().optional(),
  DISCORD_CHANNEL_TICKET_LOGS: z.string().optional(),

  WOW_BLUE_TRACKER_URL: optionalHttpUrl,
  ADDON_REPO_FULL_NAMES: z.string().default(DEFAULT_ADDON_REPOSITORIES),
  // Read-only token for the private addon repo; enables the release poller.
  MAGGUUUI_READ_TOKEN: z.preprocess(emptyEnvToUndefined, z.string().min(1).optional()),
  MAGGUUUI_RELEASE_REPO: z.string().regex(/^[\w.-]+\/[\w.-]+$/).default('Derpsen/MagguuUI'),
  // Website FAQ auto-answer: comma-separated help channel IDs; empty disables it.
  FAQ_AUTOANSWER_CHANNEL_IDS: z.string().default(''),
  WEBSITE_FAQ_API_URL: httpUrl.default('https://ui.magguu.xyz/api/v1/faqs'),
  WEBSITE_FAQ_PAGE_URL: httpUrl.default('https://ui.magguu.xyz/faq'),
  FAQ_AUTOANSWER_MIN_SCORE: z.coerce.number().min(0.4).max(1).default(0.6),
  FAQ_AUTOANSWER_USER_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(86_400).default(300),
  FAQ_AUTOANSWER_CHANNEL_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(86_400).default(60),
  FAQ_AUTOANSWER_REPEAT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(10_080).default(360),
  ADDON_RELEASE_POLL_MINUTES: z.coerce.number().int().min(0).max(1440).default(15),
  TIME_ZONE: z.string().default('Europe/Berlin').refine((value) => {
    try {
      new Intl.DateTimeFormat('de-DE', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA time zone'),
  WEEKLY_DIGEST_ENABLED: envBoolean(true),
  WEEKLY_DIGEST_DAY: z.coerce.number().int().min(0).max(6).default(0),
  WEEKLY_DIGEST_HOUR: z.coerce.number().int().min(0).max(23).default(10),
  PLEX_WEEKLY_ENABLED: envBoolean(true),
  PLEX_WEEKLY_DAY: z.coerce.number().int().min(0).max(6).default(1),
  PLEX_WEEKLY_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  PLEX_NEW_DIGEST_ENABLED: envBoolean(true),
  PLEX_NEW_DIGEST_DAY: z.coerce.number().int().min(0).max(6).default(5),
  PLEX_NEW_DIGEST_HOUR: z.coerce.number().int().min(0).max(23).default(18),
  AUTOMATIC_BACKUP_ENABLED: envBoolean(true),
  AUTOMATIC_BACKUP_HOUR: z.coerce.number().int().min(0).max(23).default(4),
  AUTOMATIC_BACKUP_RETENTION: z.coerce.number().int().min(1).max(30).default(7),
  WEBHOOK_RETRY_ENABLED: envBoolean(true),
  WEBHOOK_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  PLEX_ACTIVITY_RETENTION_DAYS: z.coerce.number().int().min(0).max(90).default(7),
  PLEX_STALE_SESSION_MINUTES: z.coerce.number().int().min(0).max(180).default(20),
  STATUS_STALE_HOURS: z.coerce.number().positive().max(8760).default(24),

  OPENAI_API_KEY: z.string().optional(),

  STARBOARD_THRESHOLD: z.coerce.number().int().positive().default(3),
  STARBOARD_EMOJI: z.string().default('⭐'),
  AUTOMOD_INVITE_FILTER: envBoolean(true),
  AUTOMOD_CAPS_FILTER: envBoolean(false),
  AUTOMOD_CAPS_THRESHOLD: z.coerce.number().min(0).max(100).default(70),
  AUTOMOD_CAPS_MIN_LEN: z.coerce.number().int().positive().default(10),
  AUTOMOD_MENTION_SPAM: envBoolean(true),
  AUTOMOD_MENTION_THRESHOLD: z.coerce.number().int().positive().default(5),
  AUTOMOD_EXTERNAL_LINK_FILTER: envBoolean(false),
  AUTO_ROLE_ID: z.preprocess(
    emptyEnvToUndefined,
    z.string().regex(/^\d{17,20}$/).optional(),
  ),

  HTTP_PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  HTTP_HOST: z.string().default('0.0.0.0'),
  // Proxy headers (cf-connecting-ip / x-forwarded-for / x-real-ip) are trusted
  // only when the socket peer is in TRUSTED_PROXIES (IPs/CIDRs, `private`,
  // `none`; unset = none). TRUST_PROXY alone no longer trusts anything (it is
  // kept only to warn about the legacy setting), see src/server/client-ip.ts.
  TRUST_PROXY: envBoolean(false),
  TRUSTED_PROXIES: z.preprocess(emptyEnvToUndefined, z.string().optional()),
  WEBHOOK_SECRET: z.string().min(16),
  // GitHub webhook secret is enforced if any GitHub repo points at the bot.
  // Required >= 16 chars when present; absent disables the route at runtime.
  GITHUB_WEBHOOK_SECRET: optionalSecret,
  // Bearer token for GET /api/status (Home Assistant); empty disables the route.
  STATUS_API_TOKEN: optionalSecret,

  DISCORD_CLIENT_SECRET: z.string().optional(),
  SESSION_SECRET: optionalSecret,
  ADMIN_USER_IDS: z.string().optional(),
  DASHBOARD_BASE_URL: optionalHttpsOrigin,

  SONARR_URL: optionalHttpUrl,
  SONARR_API_KEY: z.string().optional(),
  RADARR_URL: optionalHttpUrl,
  RADARR_API_KEY: z.string().optional(),
  SEERR_URL: optionalHttpUrl,
  SEERR_API_KEY: z.string().optional(),
  SAB_URL: optionalHttpUrl,
  SAB_API_KEY: z.string().optional(),
  TAUTULLI_URL: optionalHttpUrl,
  TAUTULLI_API_KEY: z.string().optional(),

  TMDB_API_KEY: z.string().optional(),

  DATABASE_PATH: z.string().default('./data/bot.db'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('[config] Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
