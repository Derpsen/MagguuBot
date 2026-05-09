import {
  ChannelType,
  PermissionFlagsBits,
  type CategoryChannel,
  type Guild,
  type VoiceChannel,
  type VoiceState,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { jtcRooms } from '../db/schema.js';
import { getSetting } from '../settings.js';
import { logger } from '../utils/logger.js';

export async function handleJtcVoiceUpdate(
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  const triggerId = getSetting('jtcChannelId');
  if (!triggerId) return;

  if (newState.channelId === triggerId && oldState.channelId !== triggerId) {
    await createPersonalRoom(newState);
  }

  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    await maybeDeleteEmptyRoom(oldState);
  }
}

async function createPersonalRoom(state: VoiceState): Promise<void> {
  const member = state.member;
  const guild = state.guild;
  if (!member) return;

  const categoryId = getSetting('jtcCategoryId');
  let parent: CategoryChannel | null = null;
  if (categoryId) {
    const fetched = await guild.channels.fetch(categoryId).catch(() => null);
    if (fetched && fetched.type === ChannelType.GuildCategory) {
      parent = fetched as CategoryChannel;
    }
  }
  if (!parent) {
    const trigger = await guild.channels.fetch(state.channelId!).catch(() => null);
    if (trigger?.parentId) {
      const cat = await guild.channels.fetch(trigger.parentId).catch(() => null);
      if (cat && cat.type === ChannelType.GuildCategory) parent = cat as CategoryChannel;
    }
  }

  try {
    const channel = await guild.channels.create({
      name: `🔊 ${member.displayName}`.slice(0, 100),
      type: ChannelType.GuildVoice,
      parent: parent?.id ?? undefined,
      permissionOverwrites: [
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.MuteMembers,
            PermissionFlagsBits.DeafenMembers,
            PermissionFlagsBits.PrioritySpeaker,
          ],
        },
      ],
      reason: 'JTC personal room',
    });

    db.insert(jtcRooms)
      .values({ channelId: channel.id, guildId: guild.id, ownerId: member.id })
      .run();

    await member.voice.setChannel(channel.id, 'JTC: move to personal room');
    logger.info({ ownerId: member.id, channelId: channel.id }, 'jtc room created');
  } catch (err) {
    logger.warn({ err, userId: member.id }, 'jtc room create failed');
  }
}

async function maybeDeleteEmptyRoom(state: VoiceState): Promise<void> {
  if (!state.channelId) return;
  const row = db.select().from(jtcRooms).where(eq(jtcRooms.channelId, state.channelId)).get();
  if (!row) return;

  const channel = await state.guild.channels.fetch(state.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildVoice) return;

  if ((channel as VoiceChannel).members.size > 0) return;

  try {
    await channel.delete('JTC: empty personal room');
    db.delete(jtcRooms).where(eq(jtcRooms.channelId, state.channelId)).run();
    logger.info({ channelId: state.channelId, ownerId: row.ownerId }, 'jtc room deleted (empty)');
  } catch (err) {
    logger.warn({ err, channelId: state.channelId }, 'jtc room delete failed');
  }
}

export async function ensureJtcChannel(guild: Guild): Promise<{
  triggerChannelId: string;
  categoryId: string;
}> {
  const categoryName = '🎙️ VOICE-CREATE';
  let category = guild.channels.cache.find(
    (c) => c.name === categoryName && c.type === ChannelType.GuildCategory,
  ) as CategoryChannel | undefined;
  if (!category) {
    category = (await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
    })) as CategoryChannel;
  }

  const triggerName = '➕ Voice erstellen';
  let trigger = guild.channels.cache.find(
    (c) => c.name === triggerName && c.type === ChannelType.GuildVoice,
  ) as VoiceChannel | undefined;
  if (!trigger) {
    trigger = (await guild.channels.create({
      name: triggerName,
      type: ChannelType.GuildVoice,
      parent: category.id,
    })) as VoiceChannel;
  }

  return { triggerChannelId: trigger.id, categoryId: category.id };
}
