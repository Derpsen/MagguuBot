import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ModalSubmitInteraction,
} from 'discord.js';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { tickets } from '../../db/schema.js';
import { Colors } from '../../embeds/colors.js';
import { logger } from '../../utils/logger.js';
import { getTicketCategory } from '../ticket-categories.js';
import { createPrivateTicketChannel, ticketTopicSlug } from '../ticket-channel.js';

export async function handleTicketModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const [, categoryKey] = interaction.customId.split(':');
  const category = getTicketCategory(categoryKey ?? '');
  if (!category || !interaction.guild) {
    await interaction.reply({ content: 'Kategorie ungültig.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;

  const topic = interaction.fields.getTextInputValue('topic');
  const details = interaction.fields.getTextInputValue('details') || '';

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

  const { channel } = await createPrivateTicketChannel({
    guild,
    opener: interaction.user,
    botUserId: interaction.client.user?.id,
    name: `${category.emoji}-${interaction.user.username}-${ticketTopicSlug(topic)}`,
    topic: `${category.label} · von ${interaction.user.displayName} · ${interaction.user.id}`,
  });

  db.insert(tickets)
    .values({
      guildId: guild.id,
      channelId: channel.id,
      openerId: interaction.user.id,
      topic,
      category: category.key,
      lastActivityAt: new Date(),
    })
    .run();

  const pingRoles = category.pingRoles
    .map((name) => guild.roles.cache.find((r) => r.name === name))
    .filter((r): r is import('discord.js').Role => Boolean(r));

  const welcomeEmbed = new EmbedBuilder()
    .setColor(Colors.brand)
    .setAuthor({ name: `${category.emoji} ${category.label}` })
    .setTitle(`Ticket #${channel.id.slice(-4)} · ${interaction.user.displayName}`)
    .setDescription(
      [
        `**Worum gehts:** ${topic}`,
        details ? `\n**Details:**\n${details}` : '',
        '',
        `Hi ${interaction.user.toString()} — beschreib dein Problem hier, ein Mod meldet sich.`,
        '',
        `_Auto-close nach 48h Inaktivität, Warnung nach 24h._`,
      ].join('\n'),
    )
    .addFields(
      { name: 'Priorität', value: '🟡 Normal', inline: true },
      { name: 'Status', value: '⏳ Wartet auf Mod', inline: true },
    )
    .setFooter({ text: `Ticket-ID: ${channel.id}` });

  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:claim')
      .setStyle(ButtonStyle.Primary)
      .setLabel('Claim')
      .setEmoji('🙋'),
    new ButtonBuilder()
      .setCustomId('ticket:add-user')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('User hinzufügen')
      .setEmoji('➕'),
    new ButtonBuilder()
      .setCustomId('ticket:priority')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Priorität ändern')
      .setEmoji('🚦'),
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setStyle(ButtonStyle.Danger)
      .setLabel('Schließen')
      .setEmoji('🔒'),
  );

  const pingMentions = pingRoles.map((r) => r.toString()).join(' ');
  await channel.send({
    content: `${interaction.user.toString()} ${pingMentions}`.trim(),
    embeds: [welcomeEmbed],
    components: [controlRow],
    allowedMentions: { users: [interaction.user.id], roles: pingRoles.map((r) => r.id) },
  });

  await interaction.editReply(`✅ Ticket eröffnet: ${channel.toString()}`);
  logger.info(
    { ticket: channel.id, opener: interaction.user.id, category: category.key },
    'ticket opened (modal)',
  );
}
