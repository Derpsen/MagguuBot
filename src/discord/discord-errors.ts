// Discord REST error codes the bot reacts to, in one place (was copied into plex-card-manager, rio-roles and three
// Plex cleanup modules). Pure: no discord.js runtime import, safe for every feature module.
const DISCORD_UNKNOWN_CHANNEL = 10_003;
const DISCORD_UNKNOWN_MESSAGE = 10_008;
const DISCORD_MISSING_ACCESS = 50_001;
const DISCORD_CANNOT_EDIT_OTHERS = 50_005;
const DISCORD_MISSING_PERMISSIONS = 50_013;

/** Numeric Discord API error code of a thrown value, else null. */
export function discordErrorCode(err: unknown): number | null {
  if (!err || typeof err !== 'object' || !('code' in err)) return null;
  const code = (err as { code: unknown }).code;
  return typeof code === 'number' ? code : null;
}

/** The stored message can never be edited again: deleted, or not authored by this bot. */
export function isMessageGone(err: unknown): boolean {
  const code = discordErrorCode(err);
  return code === DISCORD_UNKNOWN_MESSAGE || code === DISCORD_CANNOT_EDIT_OTHERS;
}

/**
 * Retrying cannot help until someone fixes the server: channel deleted (10003), bot lost access
 * (50001) or lost the permission to view/send/edit (50013).
 */
export function isPermanentDiscordError(err: unknown): boolean {
  const code = discordErrorCode(err);
  return code === DISCORD_UNKNOWN_CHANNEL || code === DISCORD_MISSING_ACCESS || code === DISCORD_MISSING_PERMISSIONS;
}

/** Delete target already gone (Unknown Channel 10003 / Unknown Message 10008): nothing left to clean up. */
export function isAlreadyGone(err: unknown): boolean {
  const code = discordErrorCode(err);
  return code === DISCORD_UNKNOWN_CHANNEL || code === DISCORD_UNKNOWN_MESSAGE;
}
