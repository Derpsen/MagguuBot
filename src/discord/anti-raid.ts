import {
  EmbedBuilder,
  GuildVerificationLevel,
  type Guild,
  type GuildMember,
  type TextChannel,
} from 'discord.js';
import { Colors } from '../embeds/colors.js';
import { getSetting } from '../settings.js';
import { logger } from '../utils/logger.js';
import { getChannel } from './channel-store.js';
import { postModLog } from './mod-log.js';

interface JoinTrack {
  guildId: string;
  events: number[];
  raidActive: boolean;
  previousLevel: GuildVerificationLevel | null;
}

const STATE = new Map<string, JoinTrack>();
const RAID_COOLDOWN_MS = 15 * 60 * 1000;

export async function checkAntiRaid(member: GuildMember): Promise<boolean> {
  if (!getSetting('antiRaidEnabled')) return false;
  const threshold = getSetting('antiRaidJoinThreshold');
  const windowSec = getSetting('antiRaidJoinWindowSec');
  const windowMs = windowSec * 1000;
  const now = Date.now();
  let track = STATE.get(member.guild.id);
  if (!track) {
    track = { guildId: member.guild.id, events: [], raidActive: false, previousLevel: null };
    STATE.set(member.guild.id, track);
  }
  track.events.push(now);
  track.events = track.events.filter((t) => now - t <= windowMs);

  if (track.events.length >= threshold && !track.raidActive) {
    await triggerRaidProtection(member.guild, track, track.events.length);
    return true;
  }

  if (track.raidActive && now - (track.events[track.events.length - 1] ?? now) > RAID_COOLDOWN_MS) {
    await releaseRaidProtection(member.guild, track);
  }

  return false;
}

async function triggerRaidProtection(
  guild: Guild,
  track: JoinTrack,
  joins: number,
): Promise<void> {
  track.raidActive = true;
  try {
    track.previousLevel = guild.verificationLevel;
    await guild.setVerificationLevel(GuildVerificationLevel.High, 'anti-raid auto-trigger');
    logger.warn({ joins, guildId: guild.id }, 'anti-raid: verification raised to HIGH');
  } catch (err) {
    logger.warn({ err }, 'anti-raid: verification level change failed');
  }

  const modLogId = getChannel('modLog');
  if (modLogId) {
    const ch = await guild.channels.fetch(modLogId).catch(() => null);
    if (ch?.isSendable()) {
      await (ch as TextChannel).send({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.danger)
            .setTitle('🛡️ Anti-Raid aktiviert')
            .setDescription(
              `**${joins} Joins** in den letzten ${getSetting('antiRaidJoinWindowSec')}s erkannt.\n\nVerifikations-Level wurde auf **HIGH** gesetzt. Auto-Reset nach 15min Ruhe.`,
            )
            .setTimestamp(new Date()),
        ],
      });
    }
  }

  const botUser = guild.client.user;
  if (botUser) {
    await postModLog({
      guild,
      action: 'antiraid',
      moderator: botUser,
      reason: `${joins} joins in ${getSetting('antiRaidJoinWindowSec')}s`,
      extra: [{ name: 'Verification', value: 'HIGH (auto)', inline: true }],
    });
  }
}

async function releaseRaidProtection(guild: Guild, track: JoinTrack): Promise<void> {
  if (!track.raidActive) return;
  track.raidActive = false;
  try {
    if (track.previousLevel !== null) {
      await guild.setVerificationLevel(track.previousLevel, 'anti-raid cooldown');
      logger.info({ guildId: guild.id }, 'anti-raid: verification restored');
    }
  } catch (err) {
    logger.warn({ err }, 'anti-raid: verification restore failed');
  }
}

export async function checkUsernameFilter(member: GuildMember): Promise<boolean> {
  const raw = getSetting('usernameBlockedSubstrings');
  if (!raw.trim()) return false;
  const substrings = raw
    .split(/[\n,]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 2);
  if (substrings.length === 0) return false;

  const haystack = `${member.user.username} ${member.user.globalName ?? ''} ${member.displayName}`.toLowerCase();
  const hit = substrings.find((s) => haystack.includes(s));
  if (!hit) return false;

  try {
    if (member.kickable) {
      await member.kick(`username-filter: matched "${hit}"`);
    } else if (member.bannable) {
      await member.ban({ reason: `username-filter: matched "${hit}"`, deleteMessageSeconds: 0 });
    }
  } catch (err) {
    logger.warn({ err, userId: member.id }, 'username filter action failed');
    return false;
  }

  const botUser = member.guild.client.user;
  if (botUser) {
    await postModLog({
      guild: member.guild,
      action: 'kick',
      moderator: botUser,
      target: member.user,
      reason: `username-filter: "${hit}" in display`,
    });
  }
  return true;
}
