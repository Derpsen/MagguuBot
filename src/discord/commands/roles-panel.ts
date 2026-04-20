import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  type TextChannel,
} from 'discord.js';
import { and, desc, eq } from 'drizzle-orm';
import { Colors } from '../../embeds/colors.js';
import { db } from '../../db/client.js';
import { rolePanels, type RolePanelEntry } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import type { SlashCommand } from './index.js';

export const rolesPanelCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('roles-panel')
    .setDescription('Admin: self-assign role panels with buttons')
    .addSubcommand((s: SlashCommandSubcommandBuilder) =>
      s
        .setName('create')
        .setDescription('Create a new empty role panel in a channel')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Target channel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('title').setDescription('Panel title').setRequired(true).setMaxLength(256),
        )
        .addStringOption((o) =>
          o.setName('description').setDescription('Panel description').setMaxLength(2000),
        ),
    )
    .addSubcommand((s: SlashCommandSubcommandBuilder) =>
      s
        .setName('add')
        .setDescription('Add a toggleable role to the latest panel in this channel')
        .addRoleOption((o) => o.setName('role').setDescription('Role to toggle').setRequired(true))
        .addStringOption((o) =>
          o.setName('label').setDescription('Button label').setRequired(true).setMaxLength(80),
        )
        .addStringOption((o) =>
          o.setName('emoji').setDescription('Optional emoji (unicode or <:name:id>)'),
        ),
    )
    .addSubcommand((s: SlashCommandSubcommandBuilder) =>
      s
        .setName('remove')
        .setDescription('Remove a role from the latest panel in this channel')
        .addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true)),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({ content: 'Nur im Server nutzbar.', flags: MessageFlags.Ephemeral });
      return;
    }

    const sub = interaction.options.getSubcommand(true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (sub === 'create') {
      const channel = interaction.options.getChannel('channel', true) as TextChannel;
      const title = interaction.options.getString('title', true);
      const description = interaction.options.getString('description') ?? null;

      const embed = buildPanelEmbed(title, description, []);
      const message = await channel.send({ embeds: [embed], components: [] });

      db.insert(rolePanels)
        .values({
          guildId: interaction.guildId as string,
          channelId: channel.id,
          messageId: message.id,
          title,
          description,
          roles: [],
        })
        .run();

      await interaction.editReply(
        `✅ Panel erstellt in ${channel.toString()}. Füge Rollen hinzu mit \`/roles-panel add\` (im Ziel-Channel).`,
      );
      return;
    }

    if (sub === 'add' || sub === 'remove') {
      const panel = findLatestPanel(interaction.guildId as string, interaction.channelId);
      if (!panel) {
        await interaction.editReply(
          '❌ Kein Panel in diesem Channel gefunden. Erst `/roles-panel create` ausführen.',
        );
        return;
      }

      const targetRole = interaction.options.getRole('role', true);
      const entries = panel.roles as RolePanelEntry[];

      if (sub === 'add') {
        const label = interaction.options.getString('label', true);
        const emoji = interaction.options.getString('emoji') ?? undefined;

        if (entries.length >= 5) {
          await interaction.editReply('❌ Maximal 5 Rollen pro Panel (Discord Button-Limit pro Row).');
          return;
        }

        const filtered = entries.filter((e) => e.roleId !== targetRole.id);
        filtered.push({ roleId: targetRole.id, label, emoji });
        await refreshPanel(interaction, panel, filtered);
        await interaction.editReply(`✅ ${targetRole.toString()} → **${label}** hinzugefügt.`);
        return;
      }

      const remaining = entries.filter((e) => e.roleId !== targetRole.id);
      if (remaining.length === entries.length) {
        await interaction.editReply(`❌ ${targetRole.toString()} ist nicht im Panel.`);
        return;
      }
      await refreshPanel(interaction, panel, remaining);
      await interaction.editReply(`✅ ${targetRole.toString()} entfernt.`);
    }
  },
};

function findLatestPanel(guildId: string, channelId: string) {
  return db
    .select()
    .from(rolePanels)
    .where(and(eq(rolePanels.guildId, guildId), eq(rolePanels.channelId, channelId)))
    .orderBy(desc(rolePanels.updatedAt))
    .limit(1)
    .get();
}

async function refreshPanel(
  interaction: { guild: { channels: { fetch: (id: string) => Promise<unknown> } } | null },
  panel: { guildId: string; channelId: string; messageId: string; title: string; description: string | null },
  entries: RolePanelEntry[],
): Promise<void> {
  if (!interaction.guild) return;
  const channel = (await interaction.guild.channels.fetch(panel.channelId)) as TextChannel | null;
  if (!channel?.isTextBased()) throw new Error('panel channel missing');
  const message = await channel.messages.fetch(panel.messageId).catch(() => null);
  if (!message) throw new Error('panel message deleted');

  const embed = buildPanelEmbed(panel.title, panel.description, entries);
  const components = entries.length > 0 ? [buildPanelButtons(entries)] : [];

  await message.edit({ embeds: [embed], components });

  db.update(rolePanels)
    .set({ roles: entries, updatedAt: new Date() })
    .where(
      and(
        eq(rolePanels.guildId, panel.guildId),
        eq(rolePanels.messageId, panel.messageId),
      ),
    )
    .run();

  logger.info({ panel: panel.messageId, count: entries.length }, 'role panel updated');
}

export function buildPanelEmbed(
  title: string,
  description: string | null,
  entries: RolePanelEntry[],
): EmbedBuilder {
  const list = entries.length > 0
    ? entries.map((e) => `${e.emoji ?? '•'} **${e.label}** — <@&${e.roleId}>`).join('\n')
    : '_Noch keine Rollen. Admin fügt sie mit `/roles-panel add` hinzu._';

  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setTitle(title)
    .setDescription((description ? `${description}\n\n` : '') + list)
    .setFooter({ text: 'Klick einen Button um die Rolle zu togglen' });
}

export function buildPanelButtons(entries: RolePanelEntry[]): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const entry of entries) {
    const btn = new ButtonBuilder()
      .setCustomId(`role-panel:toggle:${entry.roleId}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(entry.label);
    if (entry.emoji) btn.setEmoji(entry.emoji);
    row.addComponents(btn);
  }
  return row;
}
