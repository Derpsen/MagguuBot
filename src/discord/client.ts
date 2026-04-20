import {
  Client,
  GatewayIntentBits,
  type Interaction,
  MessageFlags,
  REST,
  Routes,
} from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { commands } from './commands/index.js';
import { handleSeerrButton } from './interactions/seerr-buttons.js';

let client: Client | null = null;

export function getClient(): Client {
  if (!client) throw new Error('discord client not initialized');
  return client;
}

export async function startDiscord(): Promise<void> {
  const c = new Client({ intents: [GatewayIntentBits.Guilds] });
  client = c;

  c.once('ready', () => {
    logger.info({ tag: c.user?.tag }, 'discord connected');
  });

  c.on('interactionCreate', async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const cmd = commands.get(interaction.commandName);
        if (!cmd) {
          await interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
          return;
        }
        await cmd.execute(interaction);
      } else if (interaction.isButton()) {
        if (interaction.customId.startsWith('seerr:')) {
          await handleSeerrButton(interaction);
        }
      }
    } catch (err) {
      logger.error({ err }, 'interaction handler failed');
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '⚠️ Something went wrong.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });

  await registerCommands();
  await c.login(config.DISCORD_TOKEN);
}

async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  const body = Array.from(commands.values()).map((cmd) => cmd.data.toJSON());
  await rest.put(Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID), { body });
  logger.info({ count: body.length }, 'slash commands registered');
}
