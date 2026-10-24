import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { logger } from '../utils/logger.js';
import { commandDenyReason } from './command-gate.js';
import { commands as defaultCommands } from './commands/index.js';

export interface DispatchLog {
  warn(obj: Record<string, unknown>, msg: string): void;
}

/** Minimal shape of a registered command (the real `commands` map satisfies it). */
export interface DispatchableCommand {
  data: { toJSON(): { default_member_permissions?: string | null } };
  execute(interaction: ChatInputCommandInteraction): Promise<unknown>;
}

export type DispatchResult = 'unknown' | 'denied' | 'executed';

/**
 * Chat-input entry point of the client: unknown command, central permission gate (fail closed, also in DMs where
 * `memberPermissions` is null), then the command itself. A denial is logged as a warning with ONLY the command name
 * and a reason category - never user/guild/channel ids, option values or permission bits.
 */
export async function dispatchChatInputCommand(
  interaction: ChatInputCommandInteraction,
  registry: ReadonlyMap<string, DispatchableCommand> = defaultCommands,
  log: DispatchLog = logger,
): Promise<DispatchResult> {
  const cmd = registry.get(interaction.commandName);
  if (!cmd) {
    await interaction.reply({ content: 'Unbekannter Befehl.', flags: MessageFlags.Ephemeral });
    return 'unknown';
  }
  const requiredPermissions = cmd.data.toJSON().default_member_permissions;
  const reason = commandDenyReason(requiredPermissions, interaction.memberPermissions);
  if (reason) {
    log.warn({ command: interaction.commandName, reason }, 'slash command denied by permission gate');
    await interaction.reply({
      content: 'Du hast keine Berechtigung für diesen Command.',
      flags: MessageFlags.Ephemeral,
    });
    return 'denied';
  }
  await cmd.execute(interaction);
  return 'executed';
}
