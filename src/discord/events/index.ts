import type { ClientEvents } from 'discord.js';
import { guildMemberAddEvent } from './guild-member-add.js';
import { guildMemberRemoveEvent } from './guild-member-remove.js';
import { guildMemberUpdateEvent } from './guild-member-update.js';
import type { BotEvent } from './types.js';

export const allEvents: BotEvent<keyof ClientEvents>[] = [
  guildMemberAddEvent as BotEvent<keyof ClientEvents>,
  guildMemberRemoveEvent as BotEvent<keyof ClientEvents>,
  guildMemberUpdateEvent as BotEvent<keyof ClientEvents>,
];
