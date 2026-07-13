import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalDashboardPath,
  canonicalDashboardUrl,
  isCanonicalDashboardHost,
  isCanonicalDashboardRequest,
} from '../src/server/auth/canonical-dashboard.js';

const DASHBOARD_URL = 'https://bot.magguu.xyz';

test('recognises only the configured dashboard host', () => {
  assert.equal(isCanonicalDashboardHost(DASHBOARD_URL, 'bot.magguu.xyz'), true);
  assert.equal(isCanonicalDashboardHost(DASHBOARD_URL, 'BOT.MAGGUU.XYZ:443'), true);
  assert.equal(isCanonicalDashboardHost(DASHBOARD_URL, '192.168.1.10:3000'), false);
  assert.equal(isCanonicalDashboardHost(DASHBOARD_URL, 'bot.magguu.xyz:3000'), false);
});

test('falls back to the request URL when a Host header is unavailable', () => {
  assert.equal(
    isCanonicalDashboardHost(DASHBOARD_URL, undefined, 'https://bot.magguu.xyz/settings'),
    true,
  );
  assert.equal(
    isCanonicalDashboardHost(DASHBOARD_URL, undefined, 'http://localhost:3000/settings'),
    false,
  );
});

test('requires HTTPS and accepts canonical reverse-proxy forwarding', () => {
  assert.equal(isCanonicalDashboardRequest(DASHBOARD_URL, {
    requestHost: 'bot.magguu.xyz',
    requestUrl: 'http://bot.magguu.xyz/settings',
  }), false);
  assert.equal(isCanonicalDashboardRequest(DASHBOARD_URL, {
    requestHost: 'MagguuBot:3000',
    requestUrl: 'http://MagguuBot:3000/settings',
    forwardedHost: 'bot.magguu.xyz',
    forwardedProto: 'https',
  }), true);
  assert.equal(isCanonicalDashboardRequest(DASHBOARD_URL, {
    requestHost: '192.168.1.10:3000',
    requestUrl: 'http://192.168.1.10:3000/settings',
  }), false);
});

test('replaces a local origin while preserving dashboard path and query', () => {
  assert.equal(
    canonicalDashboardUrl(
      DASHBOARD_URL,
      'http://192.168.1.10:3000/requests?status=pending&page=2#ignored',
    ),
    'https://bot.magguu.xyz/requests?status=pending&page=2',
  );
});

test('canonical dashboard paths cannot switch to a different origin', () => {
  assert.equal(
    canonicalDashboardPath(DASHBOARD_URL, '/auth/start?next=%2Fsettings'),
    'https://bot.magguu.xyz/auth/start?next=%2Fsettings',
  );
  assert.equal(
    canonicalDashboardPath(DASHBOARD_URL, '//attacker.example/login'),
    'https://bot.magguu.xyz/login',
  );
});
