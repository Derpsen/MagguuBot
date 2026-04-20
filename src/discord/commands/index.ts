import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { announceCommand } from './announce.js';
import { banCommand, unbanCommand } from './ban.js';
import { helpCommand } from './help.js';
import { kickCommand } from './kick.js';
import { pollCommand } from './poll.js';
import { purgeCommand } from './purge.js';
import { queueCommand } from './queue.js';
import { searchCommand } from './search.js';
import { setupServerCommand } from './setup-server.js';
import { timeoutCommand } from './timeout.js';
import { warnCommand } from './warn.js';

export type CommandCategory = 'downloads' | 'moderation' | 'utility' | 'admin';

export interface SlashCommand {
  category: CommandCategory;
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const all: SlashCommand[] = [
  queueCommand,
  searchCommand,
  setupServerCommand,
  warnCommand,
  timeoutCommand,
  kickCommand,
  banCommand,
  unbanCommand,
  purgeCommand,
  helpCommand,
  announceCommand,
  pollCommand,
];

export const commands = new Map<string, SlashCommand>(all.map((c) => [c.data.name, c]));
