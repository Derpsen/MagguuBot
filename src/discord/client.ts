import {
  Client,
  GatewayIntentBits,
  type Interaction,
  MessageFlags,
  Partials,
  REST,
  Routes,
} from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { commands } from './commands/index.js';
import { allEvents } from './events/index.js';
import { autocompleteTagNames } from './commands/tag.js';
import { handleAutoresponderButton } from './interactions/autoresponder-buttons.js';
import { handleRoleButton } from './interactions/role-buttons.js';
import { handleRolePanelButton } from './interactions/role-panel-buttons.js';
import { handleSeerrButton } from './interactions/seerr-buttons.js';
import { handleTicketButton } from './interactions/ticket-buttons.js';

let client: Client | null = null;

export function getClient(): Client {
  if (!client) throw new Error('discord client not initialized');
  return client;
}

export async function startDiscord(): Promise<void> {
  const c = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });
  client = c;

  c.once('clientReady', () => {
    logger.info({ tag: c.user?.tag }, 'discord connected');
  });

  for (const event of allEvents) {
    if (event.once) c.once(event.name, (...args) => Promise.resolve(event.execute(...args)));
    else c.on(event.name, (...args) => Promise.resolve(event.execute(...args)));
  }

  c.on('interactionCreate', async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const cmd = commands.get(interaction.commandName);
        if (!cmd) {
          await interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
          return;
        }
        await cmd.execute(interaction);
      } else if (interaction.isAutocomplete()) {
        if (interaction.commandName === 'tag' && interaction.guildId) {
          const focused = interaction.options.getFocused();
          const results = autocompleteTagNames(interaction.guildId, focused);
          await interaction.respond(results);
        }
      } else if (interaction.isButton()) {
        if (interaction.customId.startsWith('seerr:')) {
          await handleSeerrButton(interaction);
        } else if (interaction.customId.startsWith('role-panel:')) {
          await handleRolePanelButton(interaction);
        } else if (interaction.customId.startsWith('role:')) {
          await handleRoleButton(interaction);
        } else if (interaction.customId.startsWith('ticket:')) {
          await handleTicketButton(interaction);
        } else if (interaction.customId.startsWith('autoresp:')) {
          await handleAutoresponderButton(interaction);
        }
      }
    } catch (err) {
      logger.error({ err }, 'interaction handler failed');
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction
          .reply({ content: '⚠️ Something went wrong.', flags: MessageFlags.Ephemeral })
          .catch(() => {});
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
