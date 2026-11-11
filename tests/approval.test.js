'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { ApprovalStore } = require('../src/main/approval');

test('approval token is single use', () => {
  let now = 1000;
  const store = new ApprovalStore({ ttlMs: 1000, now: () => now });
  const { token } = store.approve('flush-dns');
  const entry = store.consume(token, 'flush-dns');
  assert.equal(entry.repairId, 'flush-dns');
  assert.throws(() => store.consume(token, 'flush-dns'), /already been used|invalid/i);
});

test('approval token cannot be used for another repair', () => {
  const store = new ApprovalStore();
  const { token } = store.approve('flush-dns');
  assert.throws(() => store.consume(token, 'clear-temp'), /different repair/i);
});

test('expired approval is rejected', () => {
  let now = 1000;
  const store = new ApprovalStore({ ttlMs: 500, now: () => now });
  const { token, expiresAt } = store.approve('clear-temp');
  assert.equal(expiresAt, 1500);
  now = 2000;
  assert.throws(() => store.consume(token, 'clear-temp'), /expired/i);
});

test('missing approval token is rejected', () => {
  const store = new ApprovalStore();
  assert.throws(() => store.consume('', 'flush-dns'), /token is required/i);
  assert.throws(() => store.consume(undefined, 'flush-dns'), /token is required/i);
});

test('prune removes only expired tokens', () => {
  let now = 0;
  const store = new ApprovalStore({ ttlMs: 100, now: () => now });
  store.approve('a');
  now = 50;
  store.approve('b');
  now = 120;
  store.prune();
  assert.equal(store.tokens.size, 1);
});
