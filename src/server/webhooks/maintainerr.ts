import { Hono } from 'hono';
import { EmbedBuilder } from 'discord.js';
import { getChannel } from '../../discord/channel-store.js';
import { Colors } from '../../embeds/colors.js';
import { postEmbed } from '../discord-poster.js';

interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: { text: string; icon_url?: string };
  image?: { url: string };
  thumbnail?: { url: string };
  author?: { name: string; icon_url?: string; url?: string };
  fields?: DiscordEmbedField[];
}

interface DiscordWebhookPayload {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: DiscordEmbed[];
}

function classify(input: DiscordEmbed | undefined): string {
  if (!input) return 'handled';
  const text = `${input.title ?? ''} ${input.description ?? ''}`.toLowerCase();
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
  const body = await c.req.json<DiscordWebhookPayload>();
  const source = body.embeds?.[0];
  const kind = classify(source);

  const rebuilt = new EmbedBuilder()
    .setColor(typeof source?.color === 'number' ? source.color : COLOR_FOR[kind] ?? Colors.info)
    .setTimestamp(new Date())
    .setFooter({ text: 'MagguuBot · Maintainerr' });

  if (source?.author?.name) {
    rebuilt.setAuthor({ name: source.author.name, iconURL: source.author.icon_url });
  } else {
    rebuilt.setAuthor({ name: 'Maintainerr' });
  }

  if (source?.title) rebuilt.setTitle(source.title.slice(0, 256));
  if (source?.description) rebuilt.setDescription(source.description.slice(0, 4000));
  if (source?.url) rebuilt.setURL(source.url);
  if (source?.thumbnail?.url) rebuilt.setThumbnail(source.thumbnail.url);
  if (source?.image?.url) rebuilt.setImage(source.image.url);
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
