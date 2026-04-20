import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../../config.js';
import { buildSabEventEmbed } from '../../embeds/sabnzbd.js';
import { logger } from '../../utils/logger.js';
import { postEmbed } from '../discord-poster.js';

const sabSchema = z.object({
  event: z.enum(['complete', 'failed', 'warning']),
  name: z.string().min(1).max(500),
  category: z.string().max(128).optional(),
  sizeBytes: z.coerce.number().int().nonnegative().optional(),
  failMessage: z.string().max(2000).optional(),
  storageDir: z.string().max(2000).optional(),
});

const channelFor = {
  complete: () => config.DISCORD_CHANNEL_IMPORTS,
  failed: () => config.DISCORD_CHANNEL_FAILURES,
  warning: () => config.DISCORD_CHANNEL_HEALTH,
} as const;

export const sabnzbdWebhook = new Hono().post('/', async (c) => {
  const parsed = sabSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    logger.warn({ err: parsed.error.flatten() }, 'sabnzbd webhook payload invalid');
    return c.json({ ok: false, error: parsed.error.flatten() }, 400);
  }
  const { event, name, category, sizeBytes, failMessage, storageDir } = parsed.data;

  await postEmbed({
    channelId: channelFor[event](),
    embed: buildSabEventEmbed({ status: event, name, category, sizeBytes, failMessage, storageDir }),
    source: 'sabnzbd',
    eventType: event,
    payload: parsed.data,
  });

  return c.json({ ok: true });
});
