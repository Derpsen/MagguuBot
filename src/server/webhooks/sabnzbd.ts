import { Hono } from 'hono';
import { z } from 'zod';
import { getChannel } from '../../discord/channel-store.js';
import { buildSabEventEmbed } from '../../embeds/sabnzbd.js';
import { logger } from '../../utils/logger.js';
import { postEmbed } from '../discord-poster.js';
import { importAlreadyReported, submitFeed } from '../feed-bursts.js';
import { normRelease } from '../../utils/import-dedupe.js';

/** How long a SAB "complete" waits for the matching Sonarr/Radarr import. */
export const SAB_COMPLETE_DEFER_MS = 3 * 60_000;

const sabSchema = z.object({
  event: z.enum(['complete', 'failed', 'warning']),
  name: z.string().min(1).max(500),
  category: z.string().max(128).optional(),
  sizeBytes: z.coerce.number().int().nonnegative().optional(),
  failMessage: z.string().max(2000).optional(),
  storageDir: z.string().max(2000).optional(),
});

const channelFor = {
  complete: () => getChannel('imports'),
  failed: () => getChannel('failures'),
  warning: () => getChannel('health'),
} as const;

export const sabnzbdWebhook = new Hono().post('/', async (c) => {
  const parsed = sabSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    logger.warn({ err: parsed.error.flatten() }, 'sabnzbd webhook payload invalid');
    return c.json({ ok: false, error: parsed.error.flatten() }, 400);
  }
  const { event, name, category, sizeBytes, failMessage, storageDir } = parsed.data;

  const post = async (): Promise<void> => {
    await postEmbed({
      channelId: channelFor[event](),
      embed: buildSabEventEmbed({ status: event, name, category, sizeBytes, failMessage, storageDir }),
      source: 'sabnzbd',
      eventType: event,
      payload: parsed.data,
    });
  };
  if (event !== 'complete') {
    await post();
    return c.json({ ok: true });
  }
  // Sonarr/Radarr report the same download with a richer card: wait for them, post SAB only if they did not.
  const nameKey = `rel:${normRelease(name)}`;
  const timer = setTimeout(() => {
    if (importAlreadyReported([nameKey])) {
      logger.debug({ name }, 'sabnzbd complete dropped (reported by Sonarr/Radarr)');
      return;
    }
    void submitFeed('imports', { service: 'SABnzbd', title: name, post }, [nameKey]).catch((err) =>
      logger.warn({ err }, 'sabnzbd complete post failed'),
    );
  }, SAB_COMPLETE_DEFER_MS);
  timer.unref?.();

  return c.json({ ok: true });
});
