import { z } from 'zod';

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

  HTTP_PORT: z.coerce.number().int().positive().default(3000),
  HTTP_HOST: z.string().default('0.0.0.0'),
  WEBHOOK_SECRET: z.string().min(16),

  SONARR_URL: z.string().url().optional(),
  SONARR_API_KEY: z.string().optional(),
  RADARR_URL: z.string().url().optional(),
  RADARR_API_KEY: z.string().optional(),
  SEERR_URL: z.string().url().optional(),
  SEERR_API_KEY: z.string().optional(),
  TAUTULLI_URL: z.string().url().optional(),
  TAUTULLI_API_KEY: z.string().optional(),
  SAB_URL: z.string().url().optional(),
  SAB_API_KEY: z.string().optional(),

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
