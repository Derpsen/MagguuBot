import type { Client } from 'discord.js';

// Leaf holder for the one discord.js Client. Feature modules (schedulers, cards, commands) only need `getClient()`;
// importing it from here instead of `client.ts` keeps them out of the boot module's import graph, so
// client.ts -> commands/events -> feature -> client.ts is no longer a runtime import cycle.
let client: Client | null = null;

export function getClient(): Client {
  if (!client) throw new Error('discord client not initialized');
  return client;
}

/** Called once by `startDiscord()` right after constructing the client. */
export function setClient(c: Client): void {
  client = c;
}
