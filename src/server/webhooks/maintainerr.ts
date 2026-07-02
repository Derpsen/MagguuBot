import { Hono } from 'hono';
import { EmbedBuilder } from 'discord.js';
import { getChannel } from '../../discord/channel-store.js';
import { Colors } from '../../embeds/colors.js';
import { logger } from '../../utils/logger.js';
import { isMaintainerrEventCode } from '../../utils/maintainerr.js';
import { postEmbed } from '../discord-poster.js';
import { maintainerrPayloadSchema, type MaintainerrEmbed } from './schemas.js';

function classify(input: MaintainerrEmbed | undefined): string {
  if (!input) return 'handled';
  const text = `${input.title ?? ''} ${input.description ?? ''}`.toLowerCase().replace(/[_-]+/g, ' ');
  if (/\bdelete(d)?\b|gelöscht/.test(text)) return 'deleted';
  if (/\bhandled\b|\bverarbeitet\b/.test(text)) return 'handled';
  if (/\babout to\b|\bin kürze\b|\bbald\b/.test(text)) return 'pending';
  if (/\badded to collection\b|\bhinzugefügt\b/.test(text)) return 'added';
  if (/\bremoved from collection\b|\bentfernt\b/.test(text)) return 'removed';
  if (/\bfail(ed)?\b/.test(text)) return 'failed';
  return 'event';
}

const COLOR_FOR: Record<string, number> = {
  added: Colors.warn,
  deleted: Colors.danger,
  removed: Colors.muted,
  pending: Colors.warn,
  handled: Colors.info,
  failed: Colors.danger,
  event: Colors.info,
};

export const maintainerrWebhook = new Hono().post('/', async (c) => {
  const parsed = maintainerrPayloadSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.flatten() }, 'maintainerr webhook payload invalid');
    return c.json({ ok: false, error: 'invalid payload' }, 400);
  }
  const body = parsed.data;
  const source = body.embeds?.[0];
  if (!source && !body.content?.trim()) {
    logger.debug('empty maintainerr webhook ignored');
    return c.json({ ok: true, skipped: 'empty payload' });
  }
  const kind = classify(source);

  const rebuilt = new EmbedBuilder()
    .setColor(typeof source?.color === 'number' ? source.color : COLOR_FOR[kind] ?? Colors.info)
    .setTimestamp(new Date())
    .setFooter({ text: 'MagguuBot · Maintainerr' });

  if (source?.author?.name) {
    rebuilt.setAuthor({ name: source.author.name, iconURL: validHttpUrl(source.author.icon_url) });
  } else {
    rebuilt.setAuthor({ name: 'Maintainerr' });
  }

  // Some Maintainerr templates send the internal notification enum as the
  // embed title while repeating the readable title in the description.
  if (source?.title && !isMaintainerrEventCode(source.title)) {
    rebuilt.setTitle(source.title.slice(0, 256));
  }
  if (source?.description) rebuilt.setDescription(source.description.slice(0, 4000));
  const sourceUrl = validHttpUrl(source?.url);
  const thumbnailUrl = validHttpUrl(source?.thumbnail?.url);
  const imageUrl = validHttpUrl(source?.image?.url);
  if (sourceUrl) rebuilt.setURL(sourceUrl);
  if (thumbnailUrl) rebuilt.setThumbnail(thumbnailUrl);
  if (imageUrl) rebuilt.setImage(imageUrl);
  if (source?.fields?.length) {
    rebuilt.addFields(
      source.fields.slice(0, 25).map((f) => ({
        name: f.name.slice(0, 256),
        value: f.value.slice(0, 1024),
        inline: f.inline ?? false,
      })),
    );
  } else if (body.content) {
    rebuilt.setDescription(body.content.slice(0, 4000));
  }

  await postEmbed({
    channelId: getChannel('maintainerr'),
    embed: rebuilt,
    source: 'maintainerr',
    eventType: kind,
    payload: body,
  });

  return c.json({ ok: true });
});

function validHttpUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
