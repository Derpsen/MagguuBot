import {
  EmbedBuilder,
  GuildVerificationLevel,
  type Guild,
  type GuildMember,
} from 'discord.js';
import { config } from '../config.js';
import { Colors } from '../embeds/colors.js';
import { getSetting } from '../settings.js';
import { logger } from '../utils/logger.js';
import { getChannel } from './channel-store.js';
import { getClient } from './client.js';
import { deleteFeatureState, getFeatureState, setFeatureState } from './feature-state.js';
import { postModLog } from './mod-log.js';

interface JoinTrack {
  guildId: string;
  events: number[];
  raidActive: boolean;
  raidTriggeredAt: number | null;
  previousLevel: GuildVerificationLevel | null;
}

const STATE = new Map<string, JoinTrack>();
const RELEASE_TIMERS = new Map<string, NodeJS.Timeout>();
const RAID_COOLDOWN_MS = 15 * 60 * 1000;
const RAID_RELEASE_RETRY_MS = 5 * 60 * 1000;
const RAID_STATE_KEY = 'antiRaid:active';

export async function checkAntiRaid(member: GuildMember): Promise<boolean> {
  if (!getSetting('antiRaidEnabled')) return false;
  const threshold = getSetting('antiRaidJoinThreshold');
  const windowSec = getSetting('antiRaidJoinWindowSec');
  const windowMs = windowSec * 1000;
  const now = Date.now();
  let track = STATE.get(member.guild.id);
  if (!track) {
    track = { guildId: member.guild.id, events: [], raidActive: false, raidTriggeredAt: null, previousLevel: null };
    STATE.set(member.guild.id, track);
  }
  track.events.push(now);
  track.events = track.events.filter((t) => now - t <= windowMs);

  if (track.events.length >= threshold && !track.raidActive) {
    await triggerRaidProtection(member.guild, track, track.events.length);
    return true;
  }

  if (track.raidActive) {
    track.raidTriggeredAt = now;
    persistRaidState(track);
    scheduleRaidRelease(member.guild, track);
  }

  return false;
}

async function triggerRaidProtection(
  guild: Guild,
  track: JoinTrack,
  joins: number,
): Promise<void> {
  track.raidActive = true;
  track.raidTriggeredAt = Date.now();
  track.previousLevel = guild.verificationLevel;
  persistRaidState(track);
  try {
    await guild.setVerificationLevel(GuildVerificationLevel.High, 'anti-raid auto-trigger');
    scheduleRaidRelease(guild, track);
    logger.warn({ joins, guildId: guild.id }, 'anti-raid: verification raised to HIGH');
  } catch (err) {
    logger.warn({ err }, 'anti-raid: verification level change failed');
    track.raidActive = false;
    track.previousLevel = null;
    track.raidTriggeredAt = null;
    deleteFeatureState(RAID_STATE_KEY);
    return;
  }

  const modLogId = getChannel('modLog');
  if (modLogId) {
    const ch = await guild.channels.fetch(modLogId).catch(() => null);
    if (ch?.isSendable()) {
      await ch.send({
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
  const timer = RELEASE_TIMERS.get(guild.id);
  if (timer) clearTimeout(timer);
  RELEASE_TIMERS.delete(guild.id);
  try {
    if (track.previousLevel !== null) {
      await guild.setVerificationLevel(track.previousLevel, 'anti-raid cooldown');
      logger.info({ guildId: guild.id }, 'anti-raid: verification restored');
    }
  } catch (err) {
    logger.warn({ err }, 'anti-raid: verification restore failed');
    track.raidActive = true;
    track.raidTriggeredAt = Date.now() - RAID_COOLDOWN_MS + RAID_RELEASE_RETRY_MS;
    persistRaidState(track);
    scheduleRaidRelease(guild, track);
    return;
  }
  deleteFeatureState(RAID_STATE_KEY);
  track.previousLevel = null;
  track.raidTriggeredAt = null;
  track.events = [];
}

function scheduleRaidRelease(guild: Guild, track: JoinTrack): void {
  const existing = RELEASE_TIMERS.get(guild.id);
  if (existing) clearTimeout(existing);
  const lastJoinAt = track.raidTriggeredAt ?? Date.now();
  const delay = Math.max(1, RAID_COOLDOWN_MS - (Date.now() - lastJoinAt));
  const timer = setTimeout(() => {
    const remaining = RAID_COOLDOWN_MS - (Date.now() - (track.raidTriggeredAt ?? Date.now()));
    if (remaining > 0) {
      scheduleRaidRelease(guild, track);
      return;
    }
    void releaseRaidProtection(guild, track).catch((err) =>
      logger.error({ err, guildId: guild.id }, 'anti-raid automatic release failed'),
    );
  }, delay);
  timer.unref();
  RELEASE_TIMERS.set(guild.id, timer);
}

function persistRaidState(track: JoinTrack): void {
  if (track.previousLevel === null || track.raidTriggeredAt === null) return;
  setFeatureState(RAID_STATE_KEY, JSON.stringify({
    previousLevel: track.previousLevel,
    lastJoinAt: track.raidTriggeredAt,
  }));
}

export async function recoverAntiRaidProtection(): Promise<void> {
  const raw = getFeatureState(RAID_STATE_KEY);
  if (!raw) return;
  let parsed: { previousLevel?: unknown; lastJoinAt?: unknown };
  try {
    parsed = JSON.parse(raw) as { previousLevel?: unknown; lastJoinAt?: unknown };
  } catch {
    deleteFeatureState(RAID_STATE_KEY);
    return;
  }
  if (
    !Number.isInteger(parsed.previousLevel)
    || Number(parsed.previousLevel) < GuildVerificationLevel.None
    || Number(parsed.previousLevel) > GuildVerificationLevel.VeryHigh
    || typeof parsed.lastJoinAt !== 'number'
    || !Number.isFinite(parsed.lastJoinAt)
  ) {
    deleteFeatureState(RAID_STATE_KEY);
    return;
  }
  const guild = await getClient().guilds.fetch(config.DISCORD_GUILD_ID).catch(() => null);
  if (!guild) throw new Error('anti-raid recovery guild unavailable');
  const track: JoinTrack = {
    guildId: guild.id,
    events: [],
    raidActive: true,
    raidTriggeredAt: parsed.lastJoinAt,
    previousLevel: Number(parsed.previousLevel) as GuildVerificationLevel,
  };
  STATE.set(guild.id, track);
  if (Date.now() - parsed.lastJoinAt >= RAID_COOLDOWN_MS) {
    await releaseRaidProtection(guild, track);
  } else {
    scheduleRaidRelease(guild, track);
  }
  logger.info({ guildId: guild.id }, 'anti-raid state recovered after restart');
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
