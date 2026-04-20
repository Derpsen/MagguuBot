import type { ClientEvents } from 'discord.js';

export interface BotEvent<T extends keyof ClientEvents> {
  name: T;
  once?: boolean;
  execute: (...args: ClientEvents[T]) => Promise<void> | void;
}
