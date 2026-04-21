import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Collection,
  type Message,
  type TextChannel,
} from 'discord.js';
import { postModLog } from '../mod-log.js';
import type { SlashCommand } from './index.js';

const MAX_BULK_ITERATIONS = 10;
const HARD_LIMIT = 500;

export const purgeCommand: SlashCommand = {
  category: 'moderation',
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk-delete messages in the current channel')
    .addIntegerOption((o) =>
      o
        .setName('count')
        .setDescription('How many messages (1–100, ignored wenn all=true)')
        .setMinValue(1)
        .setMaxValue(100),
    )
    .addBooleanOption((o) =>
      o.setName('all').setDescription(`Bis zu ${HARD_LIMIT} Nachrichten in diesem Channel löschen`),
    )
    .addUserOption((o) => o.setName('from').setDescription('Nur von diesem User'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages) as SlashCommandBuilder,
  async execute(interaction) {
    const wantAll = interaction.options.getBoolean('all') ?? false;
    const count = interaction.options.getInteger('count');
    const filterUser = interaction.options.getUser('from');

    if (!wantAll && !count) {
      await interaction.reply({
        content: 'Gib entweder `count` an oder setze `all:true`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!interaction.guild || !interaction.channel || interaction.channel.isDMBased()) {
      await interaction.reply({ content: 'Nur in Server-Textkanälen.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.channel as TextChannel;
    let totalDeleted = 0;
    let hitFloor = false;

    try {
      if (wantAll) {
        for (let i = 0; i < MAX_BULK_ITERATIONS && totalDeleted < HARD_LIMIT; i++) {
          const batch = await channel.messages.fetch({ limit: 100 });
          const filtered = pickMessages(batch, filterUser?.id, HARD_LIMIT - totalDeleted);
          if (filtered.length === 0) break;
          const deleted = await channel.bulkDelete(filtered, true);
          if (deleted.size === 0) {
            hitFloor = true;
            break;
          }
          totalDeleted += deleted.size;
          if (deleted.size < filtered.length) {
            hitFloor = true;
            break;
          }
        }
      } else {
        const n = count ?? 100;
        const batch = await channel.messages.fetch({ limit: 100 });
        const filtered = pickMessages(batch, filterUser?.id, n);
        const deleted = await channel.bulkDelete(filtered, true);
        totalDeleted = deleted.size;
      }

      await postModLog({
        guild: interaction.guild,
        action: 'purge',
        moderator: interaction.user,
        reason: filterUser ? `nur von ${filterUser.tag}` : wantAll ? 'all-mode' : undefined,
        extra: [
          { name: 'Channel', value: channel.toString(), inline: true },
          { name: 'Deleted', value: `${totalDeleted}`, inline: true },
          { name: 'Mode', value: wantAll ? `all (max ${HARD_LIMIT})` : `count ${count}`, inline: true },
        ],
      });

      const suffix = hitFloor
        ? ' — _Rest ist älter als 14 Tage und kann nicht bulk-gelöscht werden._'
        : '';
      await interaction.editReply(`🧹 **${totalDeleted}** Nachrichten gelöscht.${suffix}`);
    } catch (err) {
      await interaction.editReply(
        `Konnte nicht löschen. ${totalDeleted > 0 ? `Immerhin ${totalDeleted} gelöscht. ` : ''}Fehler: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
};

function pickMessages(
  batch: Collection<string, Message>,
  userId: string | undefined,
  limit: number,
): Message[] {
  const filtered = userId ? batch.filter((m) => m.author.id === userId) : batch;
  return Array.from(filtered.values()).slice(0, limit);
}
