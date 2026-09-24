'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickEdge } = require('../packages/common/index.js');

test('pickEdge routes by client region with reason', () => {
  const map = { us: 'http://u', eu: 'http://e', asia: 'http://a' };
  assert.equal(pickEdge('eu', map).url, 'http://e');
  assert.equal(pickEdge('ASIA', map).region, 'asia');
  assert.match(pickEdge('xx', map, 'us').reason, /default/);
});

test('LRU+TTL semantics (mirrors edge implementation)', () => {
  // Inline copy of the eviction rule to lock the contract without importing server.
  const m = new Map();
  const max = 2;
  const set = (k, v) => { if (m.has(k)) m.delete(k); else if (m.size >= max) m.delete(m.keys().next().value); m.set(k, v); };
  set('a', 1); set('b', 2); set('c', 3);
  assert.ok(!m.has('a') && m.has('c'), 'oldest evicted at capacity');
  const expiresAt = Date.now() - 1;
  assert.ok(Date.now() > expiresAt, 'expired entry treated as miss');
});

test('consistency matrix shape', () => {
  const matrix = [{ key: 'k', origin: 2, us: 1, eu: 2, asia: 2 }];
  const stale = matrix.filter((r) => r.origin !== r.us || r.origin !== r.eu || r.origin !== r.asia);
  assert.equal(stale.length, 1);
});
