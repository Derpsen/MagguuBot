import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { warnings } from '../../db/schema.js';
import { Colors } from '../../embeds/colors.js';
import { getUserXp, levelFromXp } from '../xp.js';
import type { SlashCommand } from './index.js';

export const userinfoCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Zeig Infos über einen User')
    .addUserOption((o) => o.setName('user').setDescription('Wer — default: du selbst')) as SlashCommandBuilder,
  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    if (!interaction.guild) {
      await interaction.reply({ content: 'Guild only.', flags: MessageFlags.Ephemeral });
      return;
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const xp = getUserXp(interaction.guild.id, target.id);
    const warnCount = db
      .select()
      .from(warnings)
      .where(and(eq(warnings.guildId, interaction.guild.id), eq(warnings.userId, target.id)))
      .all().length;

    const roles = member
      ? member.roles.cache
          .filter((r) => r.id !== interaction.guild!.id)
          .sort((a, b) => b.position - a.position)
          .map((r) => r.toString())
          .slice(0, 15)
          .join(' ')
      : '_—_';

    const e = new EmbedBuilder()
      .setColor(member?.displayColor || Colors.brand)
      .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'ID', value: `\`${target.id}\``, inline: true },
        { name: 'Account', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`, inline: true },
        {
          name: 'Joined',
          value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '_—_',
          inline: true,
        },
        { name: 'Level', value: xp ? `${levelFromXp(xp.xp)} (${xp.xp} XP)` : '—', inline: true },
        { name: 'Messages', value: xp ? `${xp.messagesCounted}` : '—', inline: true },
        { name: 'Warnings', value: `${warnCount}`, inline: true },
        { name: `Rollen${member?.roles.cache.size ? ` (${member.roles.cache.size - 1})` : ''}`, value: roles || '_none_' },
      )
      .setFooter({ text: 'MagguuBot  ·  userinfo' });

    await interaction.reply({ embeds: [e] });
  },
};
