import { MessageType, type Message } from 'discord.js';
import { logger } from '../utils/logger.js';

const MAX_PINS_REACHED_CODE = 30003;

function discordErrorCodeOf(err: unknown): number | undefined {
  return err && typeof err === 'object' ? (err as { code?: number }).code : undefined;
}

/** Pin a bot message (idempotent) and delete the "pinned a message" notice. */
export async function ensurePinned(message: Message, reason = 'MagguuBot card'): Promise<boolean> {
  if (message.pinned) return true;
  try {
    await message.pin(reason);
    await deletePinNotification(message);
    return true;
  } catch (err) {
    const code = discordErrorCodeOf(err);
    const isMaxPins = code === MAX_PINS_REACHED_CODE;
    if (!isMaxPins) {
      logger.warn(
        { code, err, messageId: message.id, channelId: message.channelId, channelName: 'name' in message.channel ? message.channel.name : '?' },
        'pin failed — bot likely lacks ManageMessages globally; grant it on the bot role in Server Settings -> Roles',
      );
      return false;
    }

    // 50-pin limit reached — try to make room by unpinning the oldest pin in this channel
    try {
      const channel = message.channel;
      if (!('messages' in channel)) {
        logger.warn({ messageId: message.id }, 'pin failed — 50-pin limit, channel does not expose messages');
        return false;
      }
      // Only ever evict the oldest pin the bot itself authored; human pins are never touched.
      const pins = await channel.messages.fetchPinned();
      const botId = message.client.user?.id;
      const oldestPin = pins
        .filter((pin) => pin.author.id === botId && pin.id !== message.id)
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .first();
      if (!oldestPin) {
        logger.warn({ messageId: message.id }, 'pin failed — 50-pin limit, no pins to evict');
        return false;
      }
      await oldestPin.unpin('evicting oldest pin to make room for fresh welcome embed');
      logger.info({ evicted: oldestPin.id, channelId: message.channelId }, 'pin: evicted oldest to free 50-pin slot');
      await message.pin(reason);
      await deletePinNotification(message);
      return true;
    } catch (evictErr) {
      logger.warn({ err: evictErr, messageId: message.id }, 'pin retry failed after eviction attempt');
      return false;
    }
  }
}

async function deletePinNotification(pinnedMessage: Message): Promise<void> {
  try {
    const recent = await pinnedMessage.channel.messages.fetch({ limit: 5, after: pinnedMessage.id });
    const notification = recent.find(
      (m) => m.type === MessageType.ChannelPinnedMessage && m.reference?.messageId === pinnedMessage.id,
    );
    if (notification) await notification.delete();
  } catch {
    /* notification cleanup is best-effort */
  }
}
