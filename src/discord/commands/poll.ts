import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import type { SlashCommand } from './index.js';

const REACTIONS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

export const pollCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a reaction poll (2–10 options)')
    .addStringOption((o) =>
      o.setName('question').setDescription('Your question').setRequired(true).setMaxLength(256),
    )
    .addStringOption((o) =>
      o
        .setName('options')
        .setDescription('Pipe-separated options, e.g. "Ja | Nein | Vielleicht"')
        .setRequired(true)
        .setMaxLength(2000),
    ) as SlashCommandBuilder,
  async execute(interaction) {
    const question = interaction.options.getString('question', true);
    const raw = interaction.options.getString('options', true);
    const options = raw
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);

    if (options.length < 2) {
      await interaction.reply({
        content: 'Mindestens 2 Optionen — getrennt durch `|`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (options.length > 10) {
      await interaction.reply({
        content: 'Maximal 10 Optionen.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const body = options.map((o, i) => `${REACTIONS[i]}  ${o}`).join('\n');
    const embed = new EmbedBuilder()
      .setColor(Colors.brand)
      .setTitle(`📊  ${question}`)
      .setDescription(body)
      .setFooter({ text: `Poll by ${interaction.user.tag}` })
      .setTimestamp(new Date());

    await interaction.reply({ embeds: [embed] });
    const msg = await interaction.fetchReply();
    for (let i = 0; i < options.length; i++) {
      const reaction = REACTIONS[i];
      if (!reaction) continue;
      await msg.react(reaction).catch(() => null);
    }
  },
};
