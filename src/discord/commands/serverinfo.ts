import { ChannelType, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import type { SlashCommand } from './index.js';

export const serverinfoCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Zeig Infos über diesen Server') as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Guild only.', flags: MessageFlags.Ephemeral });
      return;
    }

    const g = interaction.guild;
    const channels = g.channels.cache;
    const text = channels.filter((c) => c.type === ChannelType.GuildText).size;
    const voice = channels.filter((c) => c.type === ChannelType.GuildVoice).size;
    const categories = channels.filter((c) => c.type === ChannelType.GuildCategory).size;

    const owner = await g.fetchOwner().catch(() => null);

    const e = new EmbedBuilder()
      .setColor(Colors.brand)
      .setAuthor({ name: g.name, iconURL: g.iconURL() ?? undefined })
      .setThumbnail(g.iconURL({ size: 256 }) ?? null)
      .addFields(
        { name: 'ID', value: `\`${g.id}\``, inline: true },
        { name: 'Owner', value: owner ? owner.user.tag : '_—_', inline: true },
        { name: 'Erstellt', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Mitglieder', value: `${g.memberCount}`, inline: true },
        { name: 'Boosts', value: `${g.premiumSubscriptionCount ?? 0} (Tier ${g.premiumTier})`, inline: true },
        { name: 'Rollen', value: `${g.roles.cache.size}`, inline: true },
        { name: 'Kategorien', value: `${categories}`, inline: true },
        { name: 'Text-Channels', value: `${text}`, inline: true },
        { name: 'Voice-Channels', value: `${voice}`, inline: true },
      )
      .setFooter({ text: 'MagguuBot  ·  serverinfo' });

    if (g.description) e.setDescription(g.description);
    const banner = g.bannerURL({ size: 1024 });
    if (banner) e.setImage(banner);

    await interaction.reply({ embeds: [e] });
  },
};
