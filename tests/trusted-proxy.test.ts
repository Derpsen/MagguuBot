import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isTrustedProxy, parseTrustedProxies, resolveClientIp } from '../src/utils/trusted-proxy.js';

const headers = (h: Record<string, string>) => (name: string) => h[name];

describe('trusted proxy list', () => {
  it('unset/empty/none trusts nobody', () => {
    for (const value of [undefined, '', '  ', 'none']) {
      assert.equal(isTrustedProxy('127.0.0.1', parseTrustedProxies(value).cidrs), false, String(value));
    }
  });

  it('private keyword covers loopback, RFC1918 and ULA only', () => {
    const { cidrs } = parseTrustedProxies('private');
    for (const ip of ['127.0.0.1', '::1', '10.1.2.3', '172.17.0.2', '192.168.178.19', '::ffff:192.168.178.19', 'fd00::1']) {
      assert.equal(isTrustedProxy(ip, cidrs), true, ip);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '2001:db8::1', '', 'garbage']) {
      assert.equal(isTrustedProxy(ip, cidrs), false, ip);
    }
  });

  it('explicit IP/CIDR list pins the proxy and reports invalid entries', () => {
    const list = parseTrustedProxies('192.168.178.19, 172.18.0.0/16 true 10.0.0.0/33');
    assert.deepEqual(list.invalid, ['true', '10.0.0.0/33']);
    assert.equal(isTrustedProxy('192.168.178.19', list.cidrs), true);
    assert.equal(isTrustedProxy('192.168.178.20', list.cidrs), false);
    assert.equal(isTrustedProxy('172.18.5.9', list.cidrs), true);
  });
});

describe('resolveClientIp', () => {
  const trusted = parseTrustedProxies('192.168.178.19').cidrs;

  it('ignores spoofed headers from an untrusted peer (direct LAN client)', () => {
    const h = headers({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8', 'x-real-ip': '9.9.9.9' });
    assert.equal(resolveClientIp('192.168.178.50', h, trusted), '192.168.178.50');
  });

  it('ignores headers when no proxy is configured (live default)', () => {
    assert.equal(resolveClientIp('192.168.178.19', headers({ 'cf-connecting-ip': '1.2.3.4' }), []), '192.168.178.19');
  });

  it('uses cf-connecting-ip from the trusted proxy', () => {
    assert.equal(resolveClientIp('192.168.178.19', headers({ 'cf-connecting-ip': '1.2.3.4' }), trusted), '1.2.3.4');
  });

  it('takes the right-most untrusted X-Forwarded-For hop, not the client-supplied first entry', () => {
    const h = headers({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4, 192.168.178.19' });
    assert.equal(resolveClientIp('192.168.178.19', h, trusted), '1.2.3.4');
  });

  it('falls back past malformed header values', () => {
    assert.equal(resolveClientIp('192.168.178.19', headers({ 'cf-connecting-ip': 'evil', 'x-real-ip': '1.2.3.4' }), trusted), '1.2.3.4');
    assert.equal(resolveClientIp('192.168.178.19', headers({ 'x-forwarded-for': 'junk' }), trusted), '192.168.178.19');
  });

  it('returns null without a socket address', () => {
    assert.equal(resolveClientIp(undefined, headers({ 'cf-connecting-ip': '1.2.3.4' }), trusted), null);
  });
});
