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
  type CategoryChannel,
  type Guild,
  type GuildTextBasedChannel,
} from 'discord.js';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { tickets } from '../../db/schema.js';
import { Colors } from '../../embeds/colors.js';
import { logger } from '../../utils/logger.js';

const TICKET_CATEGORY_NAME = '🎫 TICKETS';

export async function handleTicketButton(interaction: ButtonInteraction): Promise<void> {
  const [, action] = interaction.customId.split(':');
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'Nur im Server.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === 'open') {
    await openTicket(interaction);
    return;
  }
  if (action === 'close') {
    await closeTicket(interaction);
    return;
  }
}

async function openTicket(interaction: ButtonInteraction): Promise<void> {
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

  const category = await ensureTicketCategory(guild);

  const modRoles = guild.roles.cache.filter((r) => ['Admin', 'Moderator'].includes(r.name));
  const channel = await guild.channels.create({
    name: `ticket-${interaction.user.username}`.slice(0, 90),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `Ticket von ${interaction.user.tag} · ${interaction.user.id}`,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      ...modRoles.map((r) => ({
        id: r.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
        ],
      })),
    ],
  });

  const client = interaction.client.user;
  if (client) {
    await channel.permissionOverwrites.create(client.id, {
      ViewChannel: true,
      SendMessages: true,
      EmbedLinks: true,
      ReadMessageHistory: true,
      ManageMessages: true,
    });
  }

  db.insert(tickets)
    .values({ guildId: guild.id, channelId: channel.id, openerId: interaction.user.id })
    .run();

  const welcomeEmbed = new EmbedBuilder()
    .setColor(Colors.info)
    .setTitle('🎫 Ticket offen')
    .setDescription(
      `Hi ${interaction.user.toString()} — beschreib dein Problem, ein Mod antwortet bald.\nKlick **Schließen** sobald alles geklärt ist.`,
    )
    .setFooter({ text: 'Ticket-ID: ' + channel.id });

  const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setStyle(ButtonStyle.Danger)
      .setLabel('Ticket schließen')
      .setEmoji('🔒'),
  );

  await channel.send({
    content: `${interaction.user.toString()} ${modRoles.map((r) => r.toString()).join(' ')}`,
    embeds: [welcomeEmbed],
    components: [closeRow],
  });

  await interaction.editReply(`✅ Ticket eröffnet: ${channel.toString()}`);
  logger.info({ ticket: channel.id, opener: interaction.user.id }, 'ticket opened');
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
    .set({ closedAt: new Date() })
    .where(eq(tickets.channelId, interaction.channelId))
    .run();

  const channel = interaction.channel;

  let transcript: string | null = null;
  if (channel && channel.isTextBased()) {
    try {
      transcript = await buildTicketTranscript(channel as GuildTextBasedChannel, ticket.openerId);
    } catch (err) {
      logger.warn({ err, ticket: interaction.channelId }, 'ticket transcript build failed');
    }
  }

  if (transcript) {
    const file = new AttachmentBuilder(Buffer.from(transcript, 'utf8'), {
      name: `ticket-${ticket.id}-${ticket.channelId}.txt`,
    });
    try {
      const opener = await guild.client.users.fetch(ticket.openerId);
      await opener.send({
        content: `Hier ist dein Ticket-Transkript (Channel <#${ticket.channelId}>, ID ${ticket.id}).`,
        files: [file],
      });
    } catch (err) {
      logger.debug({ err, opener: ticket.openerId }, 'ticket transcript DM blocked — opener has DMs disabled');
    }
  }

  await interaction.editReply('Ticket wird in 5 Sekunden gelöscht…');
  if (channel && 'send' in channel) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.danger)
          .setDescription(
            `🔒 Ticket geschlossen von ${interaction.user.toString()} · Channel wird gelöscht${
              transcript ? ' · Transkript an den Eröffner verschickt' : ''
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
  logger.info(
    { ticket: interaction.channelId, closer: interaction.user.id, transcriptDm: !!transcript },
    'ticket closed',
  );
}

const TRANSCRIPT_FETCH_LIMIT = 100;
const TRANSCRIPT_MAX_PAGES = 5;

async function buildTicketTranscript(
  channel: GuildTextBasedChannel,
  openerId: string,
): Promise<string> {
  const lines: string[] = [];
  let beforeId: string | undefined;

  for (let page = 0; page < TRANSCRIPT_MAX_PAGES; page++) {
    const batch = await channel.messages
      .fetch({ limit: TRANSCRIPT_FETCH_LIMIT, before: beforeId })
      .catch(() => null);
    if (!batch || batch.size === 0) break;
    for (const msg of batch.values()) {
      const ts = new Date(msg.createdTimestamp).toISOString();
      const author = msg.author.bot ? `${msg.author.username} [BOT]` : msg.author.username;
      const tag = msg.author.id === openerId ? ' (opener)' : '';
      const content = msg.content || (msg.embeds.length > 0 ? '[embed]' : msg.attachments.size > 0 ? '[attachment]' : '');
      lines.push(`[${ts}] ${author}${tag}: ${content}`);
    }
    if (batch.size < TRANSCRIPT_FETCH_LIMIT) break;
    beforeId = batch.last()?.id;
  }

  return [
    `Ticket transcript — channel ${channel.name} (${channel.id})`,
    `Generated at ${new Date().toISOString()}`,
    '',
    ...lines.reverse(),
  ].join('\n');
}

async function ensureTicketCategory(guild: Guild): Promise<CategoryChannel> {
  const existing = guild.channels.cache.find(
    (c) => c.name === TICKET_CATEGORY_NAME && c.type === ChannelType.GuildCategory,
  );
  if (existing && existing.type === ChannelType.GuildCategory) return existing as CategoryChannel;

  return (await guild.channels.create({
    name: TICKET_CATEGORY_NAME,
    type: ChannelType.GuildCategory,
  })) as CategoryChannel;
}
