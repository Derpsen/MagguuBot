import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { announceCommand } from './announce.js';
import { arrStatusCommand } from './arr-status.js';
import { avatarCommand } from './avatar.js';
import { calendarCommand } from './calendar.js';
import { countdownCommand } from './countdown.js';
import { banCommand, unbanCommand } from './ban.js';
import { botinfoCommand } from './botinfo.js';
import { cleanupServerCommand } from './cleanup-server.js';
import { dbBackupCommand } from './db-backup.js';
import { helpCommand } from './help.js';
import { kickCommand } from './kick.js';
import { leaderboardCommand } from './leaderboard.js';
import { plexTopCommand } from './plex-top.js';
import { pollCommand } from './poll.js';
import { purgeCommand } from './purge.js';
import { purgeUserCommand } from './purge-user.js';
import { queueCommand } from './queue.js';
import { rankCommand } from './rank.js';
import { autoresponderCommand } from './autoresponder.js';
import { remindmeCommand } from './remindme.js';
import { repCommand } from './rep.js';
import { rolesPanelCommand } from './roles-panel.js';
import { scheduleAnnounceCommand } from './schedule-announce.js';
import { stickyCommand } from './sticky.js';
import { tagCommand } from './tag.js';
import { ticketPanelCommand } from './ticket-panel.js';
import { searchCommand } from './search.js';
import { serverinfoCommand } from './serverinfo.js';
import { setupServerCommand } from './setup-server.js';
import { slowmodeCommand } from './slowmode.js';
import { timeoutCommand } from './timeout.js';
import { userinfoCommand } from './userinfo.js';
import { warnCommand } from './warn.js';

export type CommandCategory = 'downloads' | 'moderation' | 'utility' | 'admin';

export interface SlashCommand {
  category: CommandCategory;
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const all: SlashCommand[] = [
  queueCommand,
  arrStatusCommand,
  calendarCommand,
  plexTopCommand,
  searchCommand,
  setupServerCommand,
  cleanupServerCommand,
  dbBackupCommand,
  warnCommand,
  timeoutCommand,
  kickCommand,
  banCommand,
  unbanCommand,
  purgeCommand,
  purgeUserCommand,
  slowmodeCommand,
  helpCommand,
  announceCommand,
  pollCommand,
  countdownCommand,
  remindmeCommand,
  rankCommand,
  leaderboardCommand,
  userinfoCommand,
  serverinfoCommand,
  avatarCommand,
  botinfoCommand,
  rolesPanelCommand,
  tagCommand,
  autoresponderCommand,
  scheduleAnnounceCommand,
  stickyCommand,
  ticketPanelCommand,
  repCommand,
];

export const commands = new Map<string, SlashCommand>(all.map((c) => [c.data.name, c]));
