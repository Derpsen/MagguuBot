import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EmbedBuilder, MessagePayload, type MessageCreateOptions } from 'discord.js';

// The gateway module pulls in config/DB: throwaway env, no network, no Discord login.
const dir = mkdtempSync(join(tmpdir(), 'magguu-gateway-'));
process.env.DISCORD_TOKEN ??= 'test-token-not-used';
process.env.DISCORD_CLIENT_ID ??= '1498095100000000001';
process.env.DISCORD_GUILD_ID ??= '1400000000000000099';
process.env.WEBHOOK_SECRET ??= 'test-secret-0123456789abcdef';
process.env.DATABASE_PATH = join(dir, 'bot.db');

const { cardPostOptions, cardEditOptions, createDiscordCardGateway } = await import('../src/discord/plex-card.ts');
const { buildDigestEmbed } = await import('../src/utils/plex-new-digest.ts');
const { prepareNeuItems } = await import('../src/utils/plex-new.ts');

/** A target like a real channel from discord.js' point of view: its client would allow every mention type. */
const target = {
  client: { options: { allowedMentions: { parse: ['users', 'roles', 'everyone'] }, jsonTransformer: (v: unknown) => v } },
};

/** Runs the options through discord.js' own MessagePayload (what `channel.send` does before the HTTP call). */
function wireBody(options: MessageCreateOptions): {
  content?: string;
  allowed_mentions?: unknown;
  embeds?: Array<{ title?: string; description?: string; footer?: { text: string }; author?: { name: string }; fields?: Array<{ name: string; value: string }> }>;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = new MessagePayload(target as any, options).resolveBody();
  return payload.body as ReturnType<typeof wireBody>;
}

function embedChars(e: NonNullable<ReturnType<typeof wireBody>['embeds']>[number]): number {
  let n = (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0) + (e.author?.name.length ?? 0);
  for (const f of e.fields ?? []) n += f.name.length + f.value.length;
  return n;
}

function hugeEmbed(): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('T'.repeat(256))
    .setAuthor({ name: 'A'.repeat(256) })
    .setFooter({ text: 'F'.repeat(2048) })
    .setDescription('@everyone <@123456789012345678> ' + 'D'.repeat(4000));
  for (let i = 0; i < 3; i += 1) embed.addFields({ name: `field ${i}`, value: 'V'.repeat(600) });
  return embed;
}

test('cardPostOptions with a real EmbedBuilder: trimmed to 6000, no content, discord.js sends allowed_mentions {parse: []}', () => {
  const embed = hugeEmbed();
  const options = cardPostOptions(embed) satisfies MessageCreateOptions;
  const body = wireBody(options);
  assert.equal(body.content, undefined, 'embed only, nothing that could ping');
  assert.deepEqual(body.allowed_mentions, { parse: [] }, 'explicit empty parse overrides the client default');
  assert.equal(body.embeds?.length, 1);
  const sent = body.embeds?.[0];
  assert.ok(sent);
  assert.ok(embedChars(sent) <= 6000, `embed is ${embedChars(sent)} characters`);
  assert.equal(sent.title?.length, 256, 'title is kept, the description gives way first');
  assert.match(sent.description ?? '', /^@everyone <@123456789012345678> D+…?$/s, 'mention text stays inert inside the embed');
});

test('cardPostOptions: a small embed is passed through untouched', () => {
  const embed = new EmbedBuilder().setTitle('Hallo').setDescription('klein');
  const body = wireBody(cardPostOptions(embed));
  assert.equal(body.embeds?.[0]?.description, 'klein');
  assert.deepEqual(body.allowed_mentions, { parse: [] });
});

test('cardEditOptions: real embed, trimmed, components cleared, no pings', () => {
  const options = cardEditOptions(hugeEmbed());
  assert.deepEqual(options.components, []);
  assert.deepEqual(options.allowedMentions, { parse: [] });
  const [first] = options.embeds ?? [];
  assert.ok(first instanceof EmbedBuilder);
  const json = first.toJSON();
  assert.ok(embedChars(json as Parameters<typeof embedChars>[0]) <= 6000);
});

test('digest embed with hostile titles goes through the real discord.js payload within the limits', () => {
  const now = Date.UTC(2026, 9, 23, 16, 0, 0);
  const raw = Array.from({ length: 30 }, (_, i) => ({
    media_type: 'movie',
    title: `@everyone @here <@&1234567890> **${i}** ${'x'.repeat(200)}`,
    year: '2025',
    added_at: Math.floor(now / 1000) - 60 * (i + 1),
  }));
  const items = prepareNeuItems(raw, { now, days: 7, type: 'all' });
  const embed = buildDigestEmbed({ items, sinceMs: now - 7 * 86_400_000, truncated: true });
  const body = wireBody(cardPostOptions(embed));
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  const sent = body.embeds?.[0];
  assert.ok(sent && embedChars(sent) <= 6000);
  assert.doesNotMatch(sent.description ?? '', /(?<!\\)@/, 'every @ is escaped');
});

test('createDiscordCardGateway: post/edit/delete hit the channel with exactly those options', async () => {
  const calls: Array<{ kind: string; args: unknown[] }> = [];
  const channel = {
    isSendable: () => true,
    send: async (o: MessageCreateOptions) => { calls.push({ kind: 'send', args: [o] }); return { id: '555' }; },
    messages: {
      edit: async (id: string, o: unknown) => { calls.push({ kind: 'edit', args: [id, o] }); },
      delete: async (id: string) => { calls.push({ kind: 'delete', args: [id] }); },
    },
  };
  const gateway = createDiscordCardGateway(async () => channel as never);
  assert.equal(await gateway.post('1', hugeEmbed()), '555');
  await gateway.edit('1', '555', hugeEmbed());
  await gateway.delete('1', '555');
  assert.deepEqual(calls.map((c) => c.kind), ['send', 'edit', 'delete']);
  const sendOptions = calls[0]?.args[0] as MessageCreateOptions;
  assert.deepEqual(sendOptions.allowedMentions, { parse: [] });
  assert.equal(sendOptions.content, undefined);
  assert.deepEqual((calls[1]?.args[1] as { allowedMentions: unknown }).allowedMentions, { parse: [] });
  assert.deepEqual(calls[1]?.args.slice(0, 1), ['555']);
});

test('createDiscordCardGateway: a channel that is not sendable fails before anything is posted', async () => {
  let sent = 0;
  const channel = { isSendable: () => false, send: async () => { sent += 1; return { id: '1' }; }, messages: {} };
  const gateway = createDiscordCardGateway(async () => channel as never);
  await assert.rejects(() => gateway.post('9', new EmbedBuilder().setTitle('x')), /not sendable/);
  assert.equal(sent, 0);
});
