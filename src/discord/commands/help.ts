import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Colors } from '../../embeds/colors.js';
import { commands, type SlashCommand, type CommandCategory } from './index.js';

const CATEGORY_META: Record<CommandCategory, { emoji: string; label: string; order: number }> = {
  downloads: { emoji: '📥', label: 'Downloads', order: 1 },
  moderation: { emoji: '🛡️', label: 'Moderation', order: 2 },
  utility: { emoji: '🛠️', label: 'Utility', order: 3 },
  admin: { emoji: '⚙️', label: 'Admin', order: 4 },
};

export const helpCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Alle Bot-Befehle kategorisiert') as SlashCommandBuilder,
  async execute(interaction) {
    const byCategory = new Map<CommandCategory, SlashCommand[]>();
    for (const cmd of commands.values()) {
      const list = byCategory.get(cmd.category) ?? [];
      list.push(cmd);
      byCategory.set(cmd.category, list);
    }

    const e = new EmbedBuilder()
      .setColor(Colors.brand)
      .setTitle('🤖 Alle Bot-Befehle')
      .setDescription('Tipp `/` in einem Channel und wähl einen Command. Viele sind admin-only.')
      .setFooter({ text: 'MagguuBot' });

    const entries = Array.from(byCategory.entries()).sort(
      (a, b) => CATEGORY_META[a[0]].order - CATEGORY_META[b[0]].order,
    );
    for (const [cat, cmds] of entries) {
      const meta = CATEGORY_META[cat];
      const sorted = [...cmds].sort((a, b) => a.data.name.localeCompare(b.data.name));
      const value = sorted.map((c) => `**/${c.data.name}** — ${c.data.description}`).join('\n');
      e.addFields({ name: `${meta.emoji} ${meta.label}`, value: value.slice(0, 1024) });
    }

    await interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
  },
};
