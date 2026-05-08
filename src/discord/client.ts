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
import { backfillWelcomePins } from './commands/setup-server.js';
import { allEvents } from './events/index.js';
import { autocompleteTagNames } from './commands/tag.js';
import { handleRoleButton } from './interactions/role-buttons.js';
import { handleSuggestionButton } from './interactions/suggestion-buttons.js';
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
      // privileged: required to receive guildMemberAdd/Remove for welcome flow
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      // required for stats voice-channel counter
      GatewayIntentBits.GuildVoiceStates,
      // privileged: ONLY required for autoresponder/automod content matching.
      // If autoresponders + content-based automod filters are ever removed,
      // this intent should also be dropped to minimize the privacy surface.
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });
  client = c;

  c.once('clientReady', () => {
    logger.info({ tag: c.user?.tag }, 'discord connected');
  });

  // Surface gateway-level failures so an invalidated session, network drop,
  // or shard error doesn't leave the bot half-dead with nothing in the logs.
  c.on('error', (err) => logger.error({ err }, 'discord client error'));
  c.on('shardError', (err, shardId) => logger.error({ err, shardId }, 'discord shard error'));
  c.on('shardDisconnect', (event, shardId) =>
    logger.warn({ code: event.code, shardId }, 'discord shard disconnect'),
  );
  c.on('invalidated', () => {
    logger.fatal('discord session invalidated — exiting so the supervisor can restart');
    process.exit(1);
  });

  for (const event of allEvents) {
    const onError = (err: unknown): void =>
      logger.error({ err, event: event.name }, 'discord event handler failed');
    if (event.once) {
      c.once(event.name, (...args) => {
        Promise.resolve(event.execute(...args)).catch(onError);
      });
    } else {
      c.on(event.name, (...args) => {
        Promise.resolve(event.execute(...args)).catch(onError);
      });
    }
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
        } else if (interaction.customId.startsWith('suggestion:')) {
          await handleSuggestionButton(interaction);
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

  c.once('clientReady', () => {
    setTimeout(() => {
      void backfillWelcomePins().catch((err) => logger.warn({ err }, 'welcome-pin backfill failed'));
    }, 5000);
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
