import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ticketTopicSlug } from '../src/discord/ticket-channel.js';

describe('ticket channel naming', () => {
  it('normalizes topics to the established Discord channel slug', () => {
    assert.equal(ticketTopicSlug('Plex spielt nicht!'), 'plex-spielt-nicht');
    assert.equal(ticketTopicSlug('  mehrere   Abstände  '), 'mehrere-abst-nde');
  });

  it('limits slugs and falls back for topics without ASCII characters', () => {
    assert.equal(ticketTopicSlug('a'.repeat(50)), 'a'.repeat(30));
    assert.equal(ticketTopicSlug('🎫🎫🎫'), 'support');
  });
});
