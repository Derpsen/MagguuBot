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
import { dispatchChatInputCommand } from './command-dispatch.js';
import { commands } from './commands/index.js';
import { getFeatureState, setFeatureState } from './feature-state.js';
import { commandsInSync, diffCommands, type CommandShape } from '../utils/command-diff.js';
import { hashSlashCommandBody } from './slash-body-hash.js';
import { backfillWelcomePins, handleSetupServerButton } from './commands/setup-server.js';
import { allEvents } from './events/index.js';
import { handleFaqAutocomplete } from './commands/faq.js';
import { autocompleteTagNames } from './commands/tag.js';
import { handleGiveawayButton } from './interactions/giveaway-buttons.js';
import { handleNeuButton } from './interactions/neu-buttons.js';
import { handleRoleButton } from './interactions/role-buttons.js';
import { handleSuggestionButton } from './interactions/suggestion-buttons.js';
import { handleRolePanelButton } from './interactions/role-panel-buttons.js';
import { handleSeerrButton } from './interactions/seerr-buttons.js';
import { handleTicketButton } from './interactions/ticket-buttons.js';
import { handleTicketCategorySelect } from './interactions/ticket-category-select.js';
import { handleTicketModalSubmit } from './interactions/ticket-modal.js';
import { handleMovieNightVote } from './movie-night.js';
import { auditRioTiers } from './rio-roles.js';
import { noteGatewayDown, noteGatewayReady, setGatewayProbe } from './gateway-health.js';

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
    allowedMentions: { parse: [], repliedUser: false },
  });
  client = c;

  // Gateway state for /healthz (booleans, ping and timestamps only).
  setGatewayProbe(() => ({ ready: c.isReady(), pingMs: c.ws.ping }));
  c.on('clientReady', () => noteGatewayReady());
  c.on('shardReady', () => noteGatewayReady());
  c.on('shardResume', () => noteGatewayReady());
  c.on('shardReconnecting', () => noteGatewayDown());

  c.once('clientReady', () => {
    logger.info({ tag: c.user?.tag }, 'discord connected');
  });

  // Surface gateway-level failures so an invalidated session, network drop,
  // or shard error doesn't leave the bot half-dead with nothing in the logs.
  c.on('error', (err) => logger.error({ err }, 'discord client error'));
  c.on('shardError', (err, shardId) => logger.error({ err, shardId }, 'discord shard error'));
  c.on('shardDisconnect', (event, shardId) => {
    noteGatewayDown();
    logger.warn({ code: event.code, shardId }, 'discord shard disconnect');
  });
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

  c.on('interactionCreate', handleInteraction);

  c.once('clientReady', () => {
    setTimeout(() => {
      void backfillWelcomePins().catch((err) => logger.warn({ err }, 'welcome-pin backfill failed'));
    }, 5000);
  });

  // Raider.IO score roles: refuse dangerous / managed / @everyone tier roles from the env or /rio-config up front
  c.once('clientReady', () => {
    void (async () => {
      const guild = await c.guilds.fetch(config.DISCORD_GUILD_ID);
      await auditRioTiers(guild as unknown as Parameters<typeof auditRioTiers>[0]);
    })().catch((err) => logger.warn({ err }, 'rio: startup role audit failed'));
  });

  await registerCommands();
  await c.login(config.DISCORD_TOKEN);
}

/** All interactions (commands, autocomplete, buttons, selects, modals). Exported so the wiring can be tested. */
export async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      await dispatchChatInputCommand(interaction);
    } else if (interaction.isAutocomplete()) {
      if (interaction.commandName === 'tag' && interaction.guildId) {
        const focused = interaction.options.getFocused();
        const results = autocompleteTagNames(interaction.guildId, focused);
        await interaction.respond(results);
      } else if (interaction.commandName === 'faq') {
        await handleFaqAutocomplete(interaction);
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
      } else if (interaction.customId.startsWith('giveaway:')) {
        await handleGiveawayButton(interaction);
      } else if (interaction.customId.startsWith('neu:')) {
        await handleNeuButton(interaction);
      } else if (interaction.customId.startsWith('setup-server:')) {
        await handleSetupServerButton(interaction);
      } else {
        await interaction.reply({
          content: 'Diese Schaltfläche wird nicht mehr unterstützt.',
          flags: MessageFlags.Ephemeral,
        });
      }
    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('movie-night:')) {
        await handleMovieNightVote(interaction);
      } else if (interaction.customId.startsWith('ticket-category:')) {
        await handleTicketCategorySelect(interaction);
      } else {
        await interaction.reply({
          content: 'Dieses Auswahlmenü wird nicht mehr unterstützt.',
          flags: MessageFlags.Ephemeral,
        });
      }
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('ticket-modal:')) {
        await handleTicketModalSubmit(interaction);
      } else {
        await interaction.reply({
          content: 'Dieses Formular wird nicht mehr unterstützt.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  } catch (err) {
    logger.error({ err }, 'interaction handler failed');
    if (interaction.isRepliable() && interaction.deferred && interaction.isMessageComponent()) {
      await interaction
        .followUp({
          content: '⚠️ Etwas ist schiefgelaufen. Bitte versuche es erneut.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    } else if (interaction.isRepliable() && interaction.deferred) {
      await interaction
        .editReply({
          content: '⚠️ Etwas ist schiefgelaufen. Bitte versuche es erneut.',
          embeds: [],
          components: [],
        })
        .catch(() => {});
    } else if (interaction.isRepliable() && interaction.replied) {
      await interaction
        .followUp({
          content: '⚠️ Etwas ist schiefgelaufen. Bitte versuche es erneut.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    } else if (interaction.isRepliable()) {
      await interaction
        .reply({ content: '⚠️ Something went wrong.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }
}

const SLASH_HASH_KEY = 'slash_commands_hash';

/**
 * Register guild slash commands. The body hash alone is not trusted: the registered
 * commands are read back and compared (normalised like Discord stores them), so drift
 * on Discord's side — or a hash stored after a partial PUT — re-registers on restart.
 */
async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  const route = Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID);
  const body = Array.from(commands.values()).map((cmd) => cmd.data.toJSON());
  const local = body as unknown as CommandShape[];
  const hash = hashSlashCommandBody(body);
  const registered = (await rest.get(route).catch((err: unknown) => {
    logger.warn({ err }, 'reading registered slash commands failed; registering');
    return null;
  })) as CommandShape[] | null;
  const drift = registered ? diffCommands(registered, local) : null;
  if (drift && commandsInSync(drift) && getFeatureState(SLASH_HASH_KEY) === hash) {
    logger.info({ count: body.length }, 'slash commands unchanged');
    return;
  }
  if (drift && !commandsInSync(drift)) {
    logger.info(
      { missing: drift.missing, extra: drift.extra, changed: drift.changed.map((c) => `${c.name}:${c.what}`) },
      'registered slash commands differ from code',
    );
  }
  const stored = (await rest.put(route, { body })) as CommandShape[] | null;
  const after = Array.isArray(stored) ? diffCommands(stored, local) : null;
  if (after && !commandsInSync(after)) {
    logger.warn({ changed: after.changed }, 'Discord stored slash commands differently than sent');
  }
  setFeatureState(SLASH_HASH_KEY, hash);
  logger.info({ count: body.length }, 'slash commands registered');
}
