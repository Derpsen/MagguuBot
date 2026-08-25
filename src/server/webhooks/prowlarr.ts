import { Hono } from 'hono';
import { getChannel } from '../../discord/channel-store.js';
import { buildAppUpdateEmbed, buildHealthEmbed } from '../../embeds/arr.js';
import { logger } from '../../utils/logger.js';
import { postEmbed } from '../discord-poster.js';
import { postOrEditLifecycleEmbed } from '../lifecycle-poster.js';
import { healthLevelForEvent, sonarrPayloadSchema } from './schemas.js';

export const prowlarrWebhook = new Hono().post('/', async (c) => {
  const parsed = sonarrPayloadSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.flatten() }, 'prowlarr webhook payload invalid');
    return c.json({ ok: false, error: 'invalid payload' }, 400);
  }
  const body = parsed.data;
  logger.debug({ eventType: body.eventType }, 'prowlarr webhook received');

  switch (body.eventType) {
    case 'Test':
      return c.json({ ok: true, test: true });
    case 'ApplicationUpdate': {
      await postEmbed({
        channelId: getChannel('health'),
        embed: buildAppUpdateEmbed({
          service: 'prowlarr',
          previousVersion: body.previousVersion,
          newVersion: body.newVersion,
          message: body.message,
        }),
        source: 'prowlarr',
        eventType: body.eventType,
        payload: body,
      });
      break;
    }
    case 'Health':
    case 'HealthRestored': {
      const common = {
        channelId: getChannel('health'),
        embed: buildHealthEmbed({
          service: 'Prowlarr',
          level: healthLevelForEvent(body.eventType, body.level),
          message: body.message ?? body.eventType,
          type: body.type,
        }),
        source: 'prowlarr',
        eventType: body.eventType,
        payload: body,
      };
      if (body.type) {
        await postOrEditLifecycleEmbed({
          ...common,
          lifecycleKey: `health:prowlarr:${body.type.toLowerCase()}`,
          state: body.eventType,
        });
      } else {
        await postEmbed(common);
      }
      break;
    }
    default:
      logger.debug({ eventType: body.eventType }, 'prowlarr event ignored');
  }

  return c.json({ ok: true });
});
