import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { queueCommand } from './queue.js';
import { searchCommand } from './search.js';
import { setupServerCommand } from './setup-server.js';

export interface SlashCommand {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const all: SlashCommand[] = [queueCommand, searchCommand, setupServerCommand];

export const commands = new Map<string, SlashCommand>(all.map((c) => [c.data.name, c]));
