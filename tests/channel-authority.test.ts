import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import {
  ANNOUNCE_CHANNEL_PERMS,
  invokerChannelError,
  missingChannelPermissions,
  PURGE_CHANNEL_PERMS,
  rolePingAllowed,
} from '../src/discord/channel-authority.js';

const perms = (...flags: bigint[]) => new PermissionsBitField(flags);

describe('invoker channel authority', () => {
  it('announce needs view + send in the target channel', () => {
    assert.deepEqual(missingChannelPermissions(perms(PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages), ANNOUNCE_CHANNEL_PERMS), []);
    assert.deepEqual(missingChannelPermissions(perms(PermissionFlagsBits.ViewChannel), ANNOUNCE_CHANNEL_PERMS), [PermissionFlagsBits.SendMessages]);
  });

  it('purge needs view + manage messages + history', () => {
    const all = perms(PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory);
    assert.deepEqual(missingChannelPermissions(all, PURGE_CHANNEL_PERMS), []);
    assert.deepEqual(missingChannelPermissions(perms(PermissionFlagsBits.ManageMessages), PURGE_CHANNEL_PERMS), [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
    ]);
  });

  it('Administrator satisfies everything; unknown permissions count as missing', () => {
    assert.deepEqual(missingChannelPermissions(perms(PermissionFlagsBits.Administrator), PURGE_CHANNEL_PERMS), []);
    assert.deepEqual(missingChannelPermissions(null, ANNOUNCE_CHANNEL_PERMS), [...ANNOUNCE_CHANNEL_PERMS]);
  });

  it('formats a German error only when something is missing', () => {
    assert.equal(invokerChannelError('<#1>', []), null);
    assert.equal(invokerChannelError('<#1>', [PermissionFlagsBits.SendMessages]), '❌ Dir fehlen in <#1> die Rechte: `Nachrichten senden`.');
  });
});

describe('role ping permission', () => {
  it('allows mentionable roles for anyone', () => {
    assert.equal(rolePingAllowed(true, perms()), true);
    assert.equal(rolePingAllowed(true, null), true);
  });

  it('non-mentionable roles need MentionEveryone in the channel', () => {
    assert.equal(rolePingAllowed(false, perms(PermissionFlagsBits.ManageMessages)), false);
    assert.equal(rolePingAllowed(false, null), false);
    assert.equal(rolePingAllowed(false, perms(PermissionFlagsBits.MentionEveryone)), true);
  });
});
