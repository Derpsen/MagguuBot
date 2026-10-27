import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeInventory, inventoryChannel, INVENTORY_MAX_PAGES, snowflakeDate } from '../src/rollout/inventory.ts';

type Call = { method: string; path: string };

/** Fake REST over a channel with `total` messages (ids descending like Discord returns them). */
function fakeRest(total: number, fail?: { status: number }) {
  const calls: Call[] = [];
  const ids = Array.from({ length: total }, (_, i) => String(1_540_000_000_000_000_000n - BigInt(i) * 1000n));
  return {
    calls,
    rest: {
      async request<T>(method: string, path: string): Promise<T | null> {
        calls.push({ method, path });
        if (fail) throw Object.assign(new Error('HTTP'), { status: fail.status });
        const before = /before=(\d+)/.exec(path)?.[1];
        const from = before ? ids.filter((id) => BigInt(id) < BigInt(before)) : ids;
        return from.slice(0, 100).map((id) => ({ id })) as unknown as T;
      },
    },
  };
}

test('snowflakeDate decodes the creation date and rejects non-snowflakes', () => {
  assert.equal(snowflakeDate('175928847299117063'), '2016-04-30T11:18:25.796Z');
  assert.equal(snowflakeDate('new:channel:x'), null);
});

test('inventory counts small channels exactly with GET only', async () => {
  const { rest, calls } = fakeRest(37);
  const inv = await inventoryChannel(rest, '123');
  assert.equal(inv.messages, 37);
  assert.equal(inv.capped, false);
  assert.ok(inv.newestAt);
  assert.deepEqual(calls.map((c) => c.method), ['GET']);
  assert.match(describeInventory(inv), /^ · Nachrichten: 37 · letzte \d{4}-\d{2}-\d{2}$/);
});

test('inventory: empty channel is 0, exact multiples of 100 end on the empty page', async () => {
  assert.equal((await inventoryChannel(fakeRest(0).rest, '1')).messages, 0);
  assert.equal(describeInventory(await inventoryChannel(fakeRest(0).rest, '1')), ' · Nachrichten: 0');
  const two = await inventoryChannel(fakeRest(200).rest, '1');
  assert.equal(two.messages, 200);
  assert.equal(two.capped, false);
});

test('inventory is bounded: big channels are reported as N+ after at most the page cap', async () => {
  const { rest, calls } = fakeRest(5000);
  const inv = await inventoryChannel(rest, '1');
  assert.equal(inv.capped, true);
  assert.equal(inv.messages, 100 * INVENTORY_MAX_PAGES);
  assert.equal(calls.length, INVENTORY_MAX_PAGES);
  assert.ok(calls.every((c) => c.method === 'GET' && /^\/channels\/1\/messages\?limit=100/.test(c.path)));
  assert.match(describeInventory(inv), /Nachrichten: 500\+/);
});

test('inventory: an unreadable channel is reported, never thrown, never guessed', async () => {
  const inv = await inventoryChannel(fakeRest(10, { status: 403 }).rest, '1');
  assert.equal(inv.messages, null);
  assert.equal(describeInventory(inv), ' · Nachrichten: unbekannt (HTTP 403)');
});
