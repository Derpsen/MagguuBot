import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type CategoryChannel,
  type Guild,
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

  await interaction.editReply('Ticket wird in 5 Sekunden gelöscht…');
  const channel = interaction.channel;
  if (channel && 'send' in channel) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.danger)
          .setDescription(`🔒 Ticket geschlossen von ${interaction.user.toString()} · Channel wird gelöscht`),
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
