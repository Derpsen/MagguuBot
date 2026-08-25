import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Guild,
  type GuildTextBasedChannel,
  type Message,
  type TextChannel,
} from 'discord.js';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { tickets } from '../../db/schema.js';
import { Colors } from '../../embeds/colors.js';
import { logger } from '../../utils/logger.js';
import { getChannel, saveChannel } from '../channel-store.js';
import { createPrivateTicketChannel, TICKET_CATEGORY_NAME } from '../ticket-channel.js';

const TICKET_LOG_CHANNEL_NAME = 'ticket-logs';

export async function handleTicketButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, ...rest] = interaction.customId.split(':');
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'Nur im Server.', flags: MessageFlags.Ephemeral });
    return;
  }

  switch (action) {
    case 'open':
      await openLegacyTicket(interaction);
      return;
    case 'close':
      await closeTicket(interaction);
      return;
    case 'claim':
      await claimTicket(interaction);
      return;
    case 'add-user':
      await promptAddUser(interaction);
      return;
    case 'priority':
      await cyclePriority(interaction);
      return;
    case 'priority-set':
      await setPriority(interaction, rest[0] ?? 'normal');
      return;
    default:
      await interaction.reply({ content: 'Unbekannte Ticket-Aktion.', flags: MessageFlags.Ephemeral });
  }
}

async function openLegacyTicket(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;
  if (!guild) return;

  const existing = db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.guildId, guild.id),
        eq(tickets.openerId, interaction.user.id),
        isNull(tickets.closedAt),
      ),
    )
    .get();
  if (existing) {
    await interaction.editReply(`Du hast bereits ein offenes Ticket: <#${existing.channelId}>`);
    return;
  }

  const { channel, moderatorRoles } = await createPrivateTicketChannel({
    guild,
    opener: interaction.user,
    botUserId: interaction.client.user?.id,
    name: `ticket-${interaction.user.username}`,
    topic: `Ticket von ${interaction.user.displayName} · ${interaction.user.id}`,
  });

  db.insert(tickets)
    .values({
      guildId: guild.id,
      channelId: channel.id,
      openerId: interaction.user.id,
      lastActivityAt: new Date(),
    })
    .run();

  const welcomeEmbed = new EmbedBuilder()
    .setColor(Colors.info)
    .setTitle('🎫 Ticket offen')
    .setDescription(
      `Hi ${interaction.user.toString()} — beschreib dein Problem, ein Mod antwortet bald.`,
    )
    .setFooter({ text: 'Ticket-ID: ' + channel.id });

  const controlRow = standardControlRow();
  await channel.send({
    content: `${interaction.user.toString()} ${moderatorRoles.map((role) => role.toString()).join(' ')}`,
    embeds: [welcomeEmbed],
    components: [controlRow],
  });

  await interaction.editReply(`✅ Ticket eröffnet: ${channel.toString()}`);
}

async function claimTicket(interaction: ButtonInteraction): Promise<void> {
  const ticket = await loadTicket(interaction);
  if (!ticket) return;
  const isMod = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ?? false;
  if (!isMod) {
    await interaction.reply({ content: 'Nur Mods können Tickets claimen.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (ticket.claimedBy) {
    if (ticket.claimedBy === interaction.user.id) {
      db.update(tickets)
        .set({ claimedBy: null, claimedAt: null })
        .where(eq(tickets.channelId, interaction.channelId))
        .run();
      await interaction.reply({
        content: `↩️ Du hast den Claim zurückgegeben.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      content: `Bereits geclaimt von <@${ticket.claimedBy}>.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  db.update(tickets)
    .set({ claimedBy: interaction.user.id, claimedAt: new Date() })
    .where(eq(tickets.channelId, interaction.channelId))
    .run();

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.success)
        .setDescription(`🙋 ${interaction.user.toString()} hat dieses Ticket geclaimt.`),
    ],
  });
}

async function promptAddUser(interaction: ButtonInteraction): Promise<void> {
  const isMod = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ?? false;
  if (!isMod) {
    await interaction.reply({ content: 'Nur Mods.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({
    content:
      'Schreib `+@user` (mit Mention) im Channel um jemanden hinzuzufügen, oder `-@user` um sie wieder zu entfernen.\n\n_Tipp: nur Mods können Add/Remove triggern._',
    flags: MessageFlags.Ephemeral,
  });
}

async function cyclePriority(interaction: ButtonInteraction): Promise<void> {
  const isMod = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ?? false;
  if (!isMod) {
    await interaction.reply({ content: 'Nur Mods.', flags: MessageFlags.Ephemeral });
    return;
  }
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:priority-set:low')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('🟢 Low'),
    new ButtonBuilder()
      .setCustomId('ticket:priority-set:normal')
      .setStyle(ButtonStyle.Primary)
      .setLabel('🟡 Normal'),
    new ButtonBuilder()
      .setCustomId('ticket:priority-set:high')
      .setStyle(ButtonStyle.Danger)
      .setLabel('🔴 High'),
  );
  await interaction.reply({
    content: 'Priorität wählen:',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

async function setPriority(interaction: ButtonInteraction, level: string): Promise<void> {
  const isMod = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ?? false;
  if (!isMod) {
    await interaction.reply({ content: 'Nur Mods.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (level !== 'low' && level !== 'normal' && level !== 'high') {
    await interaction.reply({ content: 'Ungültige Priorität.', flags: MessageFlags.Ephemeral });
    return;
  }
  const ticket = await loadTicket(interaction);
  if (!ticket) return;
  const valid = ['low', 'normal', 'high'].includes(level) ? (level as 'low' | 'normal' | 'high') : 'normal';
  db.update(tickets).set({ priority: valid }).where(eq(tickets.channelId, interaction.channelId)).run();
  const label = valid === 'low' ? '🟢 Low' : valid === 'normal' ? '🟡 Normal' : '🔴 High';
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(valid === 'high' ? Colors.danger : valid === 'normal' ? Colors.warn : Colors.success)
        .setDescription(`🚦 Priorität gesetzt: **${label}** (von ${interaction.user.toString()})`),
    ],
  });
}

async function loadTicket(interaction: ButtonInteraction): Promise<typeof tickets.$inferSelect | null> {
  if (!interaction.guild) return null;
  const ticket = db
    .select()
    .from(tickets)
    .where(and(eq(tickets.guildId, interaction.guild.id), eq(tickets.channelId, interaction.channelId)))
    .get();
  if (!ticket || ticket.closedAt) {
    await interaction.reply({
      content: 'Kein offenes Ticket in diesem Channel.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
  return ticket;
}

async function closeTicket(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;
  if (!guild) return;

  const ticket = db
    .select()
    .from(tickets)
    .where(and(eq(tickets.guildId, guild.id), eq(tickets.channelId, interaction.channelId)))
    .get();
  if (!ticket) {
    await interaction.editReply('Kein Ticket in diesem Channel.');
    return;
  }
  if (ticket.closedAt) {
    await interaction.editReply('Ticket ist bereits geschlossen.');
    return;
  }

  const isOpener = ticket.openerId === interaction.user.id;
  const isMod = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false;
  if (!isOpener && !isMod) {
    await interaction.editReply('Nur der Eröffner oder ein Mod kann das Ticket schließen.');
    return;
  }

  db.update(tickets)
    .set({ closedAt: new Date(), closedBy: interaction.user.id, closeReason: 'manual close' })
    .where(eq(tickets.channelId, interaction.channelId))
    .run();

  const channel = interaction.channel;
  let messages: Message[] = [];
  if (channel && channel.isTextBased()) {
    try {
      messages = await fetchAllMessages(channel as GuildTextBasedChannel);
    } catch (err) {
      logger.warn({ err, ticket: interaction.channelId }, 'ticket transcript fetch failed');
    }
  }

  const transcriptHtml = messages.length > 0 ? buildHtmlTranscript(ticket, messages) : null;
  const transcriptTxt = messages.length > 0 ? buildTextTranscript(ticket, messages) : null;
  const filename = `ticket-${ticket.id}-${ticket.channelId}`;

  if (transcriptHtml && transcriptTxt) {
    const htmlFile = new AttachmentBuilder(Buffer.from(transcriptHtml, 'utf8'), {
      name: `${filename}.html`,
    });
    const txtFile = new AttachmentBuilder(Buffer.from(transcriptTxt, 'utf8'), {
      name: `${filename}.txt`,
    });

    try {
      const opener = await guild.client.users.fetch(ticket.openerId);
      await opener.send({
        content: `Hier ist dein Ticket-Transkript (Channel <#${ticket.channelId}>, ID ${ticket.id}).`,
        files: [htmlFile, txtFile],
      });
    } catch (err) {
      logger.debug({ err, opener: ticket.openerId }, 'ticket transcript DM blocked');
    }

    const logChannel = await ensureTicketLogChannel(guild);
    if (logChannel) {
      await logChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.muted)
            .setTitle(`📝 Ticket #${ticket.id} geschlossen`)
            .addFields(
              { name: 'Opener', value: `<@${ticket.openerId}>`, inline: true },
              { name: 'Closed by', value: interaction.user.toString(), inline: true },
              { name: 'Category', value: ticket.category ?? '—', inline: true },
              { name: 'Priority', value: ticket.priority ?? 'normal', inline: true },
              { name: 'Topic', value: ticket.topic ?? '—', inline: false },
            )
            .setTimestamp(new Date()),
        ],
        files: [
          new AttachmentBuilder(Buffer.from(transcriptHtml, 'utf8'), { name: `${filename}.html` }),
          new AttachmentBuilder(Buffer.from(transcriptTxt, 'utf8'), { name: `${filename}.txt` }),
        ],
      });
    }
  }

  await interaction.editReply('Ticket wird in 5 Sekunden gelöscht…');
  if (channel && 'send' in channel) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.danger)
          .setDescription(
            `🔒 Ticket geschlossen von ${interaction.user.toString()}${
              transcriptHtml ? ' · Transkript an Eröffner + ticket-logs' : ''
            }`,
          ),
      ],
    });
  }

  setTimeout(async () => {
    const ch = await guild.channels.fetch(interaction.channelId).catch(() => null);
    if (ch && 'delete' in ch) {
      await ch.delete('ticket closed').catch(() => {});
    }
  }, 5000);
  logger.info({ ticket: interaction.channelId, closer: interaction.user.id }, 'ticket closed');
}

const TRANSCRIPT_FETCH_LIMIT = 100;
const TRANSCRIPT_MAX_PAGES = 10;

async function fetchAllMessages(channel: GuildTextBasedChannel): Promise<Message[]> {
  const collected: Message[] = [];
  let beforeId: string | undefined;
  for (let page = 0; page < TRANSCRIPT_MAX_PAGES; page++) {
    const batch = await channel.messages
      .fetch({ limit: TRANSCRIPT_FETCH_LIMIT, before: beforeId })
      .catch(() => null);
    if (!batch || batch.size === 0) break;
    collected.push(...batch.values());
    if (batch.size < TRANSCRIPT_FETCH_LIMIT) break;
    beforeId = batch.last()?.id;
  }
  return collected.reverse();
}

function buildTextTranscript(
  ticket: typeof tickets.$inferSelect,
  messages: Message[],
): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const ts = new Date(msg.createdTimestamp).toISOString();
    const author = msg.author.bot ? `${msg.author.username} [BOT]` : msg.author.username;
    const tag = msg.author.id === ticket.openerId ? ' (opener)' : '';
    const content =
      msg.content || (msg.embeds.length > 0 ? '[embed]' : msg.attachments.size > 0 ? '[attachment]' : '');
    lines.push(`[${ts}] ${author}${tag}: ${content}`);
  }
  return [
    `Ticket transcript — channel ${ticket.channelId}`,
    `Generated at ${new Date().toISOString()}`,
    `Topic: ${ticket.topic ?? '—'}`,
    `Category: ${ticket.category ?? '—'}`,
    '',
    ...lines,
  ].join('\n');
}

function buildHtmlTranscript(
  ticket: typeof tickets.$inferSelect,
  messages: Message[],
): string {
  const safe = (s: string): string =>
    s.replace(/[&<>"']/g, (c) =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
    );
  const rows = messages
    .map((m) => {
      const ts = new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19);
      const isOpener = m.author.id === ticket.openerId;
      const isBot = m.author.bot;
      const role = isBot ? 'bot' : isOpener ? 'opener' : 'mod';
      const avatar = m.author.displayAvatarURL({ extension: 'png', size: 64 });
      const attachments = Array.from(m.attachments.values())
        .map((a) =>
          a.contentType?.startsWith('image/')
            ? `<img src="${safe(a.url)}" loading="lazy" />`
            : `<a href="${safe(a.url)}" target="_blank" rel="noopener">${safe(a.name ?? a.url)}</a>`,
        )
        .join('');
      return `<div class="msg ${role}">
  <img class="avatar" src="${safe(avatar)}" alt="" />
  <div class="body">
    <div class="meta"><span class="author">${safe(m.author.username)}</span> ${
      isBot ? '<span class="badge">BOT</span>' : ''
    }${isOpener ? '<span class="badge opener">OPENER</span>' : ''} <span class="ts">${ts}</span></div>
    <div class="content">${safe(m.content || '').replace(/\n/g, '<br>')}</div>
    ${attachments ? `<div class="atts">${attachments}</div>` : ''}
  </div>
</div>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Ticket #${ticket.id} Transcript</title>
<style>
  body { background: #0e1119; color: #fff; font-family: system-ui, sans-serif; margin: 0; padding: 24px; }
  header { border-bottom: 1px solid #2a2d3e; padding-bottom: 16px; margin-bottom: 24px; }
  header h1 { margin: 0; color: #5865F2; }
  header p { margin: 4px 0; color: #9ca3af; font-size: 14px; }
  .msg { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid #1a1d2e; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; }
  .body { flex: 1; min-width: 0; }
  .meta { font-size: 13px; color: #9ca3af; margin-bottom: 4px; }
  .author { color: #fff; font-weight: 600; }
  .badge { background: #5865F2; color: #fff; font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-left: 4px; }
  .badge.opener { background: #22c55e; }
  .ts { float: right; }
  .content { white-space: pre-wrap; word-break: break-word; }
  .atts { margin-top: 8px; }
  .atts img { max-width: 320px; border-radius: 6px; display: block; margin: 4px 0; }
  .atts a { color: #7289FA; }
  .msg.opener { background: rgba(88, 101, 242, 0.05); }
  .msg.bot { opacity: 0.85; }
</style>
</head>
<body>
<header>
  <h1>Ticket #${ticket.id} Transcript</h1>
  <p><strong>Topic:</strong> ${safe(ticket.topic ?? '—')}</p>
  <p><strong>Category:</strong> ${safe(ticket.category ?? '—')}</p>
  <p><strong>Opener:</strong> ${ticket.openerId} · <strong>Generated:</strong> ${new Date().toISOString()}</p>
</header>
<main>
${rows}
</main>
</body>
</html>`;
}

function standardControlRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:claim')
      .setStyle(ButtonStyle.Primary)
      .setLabel('Claim')
      .setEmoji('🙋'),
    new ButtonBuilder()
      .setCustomId('ticket:priority')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Priorität')
      .setEmoji('🚦'),
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setStyle(ButtonStyle.Danger)
      .setLabel('Schließen')
      .setEmoji('🔒'),
  );
}

async function ensureTicketLogChannel(guild: Guild): Promise<TextChannel | null> {
  const explicit = getChannel('ticketLogs');
  if (explicit) {
    const ch = await guild.channels.fetch(explicit).catch(() => null);
    if (ch && ch.isSendable()) return ch as TextChannel;
  }
  const found = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === TICKET_LOG_CHANNEL_NAME,
  ) as TextChannel | undefined;
  if (found) {
    saveChannel('ticketLogs', found.id);
    return found;
  }
  try {
    const cat = guild.channels.cache.find(
      (c) => c.name === TICKET_CATEGORY_NAME && c.type === ChannelType.GuildCategory,
    );
    const created = await guild.channels.create({
      name: TICKET_LOG_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: cat?.id,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        ...guild.roles.cache
          .filter((r) => ['Admin', 'Moderator'].includes(r.name))
          .map((r) => ({
            id: r.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
          })),
      ],
    });
    saveChannel('ticketLogs', created.id);
    return created;
  } catch (err) {
    logger.warn({ err }, 'ticket-logs channel create failed');
    return null;
  }
}
