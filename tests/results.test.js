'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { STATUS, makeResult, summarize, overallStatus, formatDuration, clampText } = require('../src/main/results');

const check = { id: 'demo', name: 'Demo check', tool: 'system' };

test('makeResult normalizes unknown statuses to info', () => {
  const result = makeResult(check, { status: 'not-a-status', finding: 'x' });
  assert.equal(result.status, 'info');
  assert.equal(result.id, 'demo');
  assert.equal(result.name, 'Demo check');
  assert.equal(result.tool, 'system');
});

test('makeResult keeps valid statuses and clamps long text', () => {
  const result = makeResult(check, { status: 'fail', finding: 'f'.repeat(900), evidence: 'e'.repeat(20000) });
  assert.equal(result.status, 'fail');
  assert.ok(result.finding.length <= 600);
  assert.ok(result.evidence.length < 13000);
  assert.match(result.evidence, /truncated/);
});

test('makeResult fills defaults instead of inventing data', () => {
  const result = makeResult(check, {});
  assert.equal(result.finding, 'No finding recorded.');
  assert.equal(result.evidence, 'No evidence was returned.');
  assert.equal(result.explanation, STATUS.info.description);
  assert.equal(result.nextStep, 'No action is required for this result.');
});

test('summarize counts statuses and attention items', () => {
  const s = summarize([
    { status: 'pass' },
    { status: 'info' },
    { status: 'warn' },
    { status: 'fail' },
    { status: 'error' },
    { status: 'skip' }
  ]);
  assert.deepEqual(s, { total: 6, pass: 1, info: 1, warn: 1, fail: 1, error: 1, skip: 1, attention: 3 });
});

test('overallStatus reflects the most serious result', () => {
  assert.equal(overallStatus([]), 'info');
  assert.equal(overallStatus([{ status: 'pass' }]), 'pass');
  assert.equal(overallStatus([{ status: 'pass' }, { status: 'warn' }]), 'warn');
  assert.equal(overallStatus([{ status: 'warn' }, { status: 'fail' }]), 'fail');
  assert.equal(overallStatus([{ status: 'warn' }, { status: 'error' }]), 'fail');
});

test('formatDuration is human readable', () => {
  assert.equal(formatDuration(12), '12 ms');
  assert.equal(formatDuration(1500), '1.5 s');
  assert.equal(formatDuration(65000), '1 min 5 s');
  assert.equal(formatDuration(-1), 'unknown');
});

test('clampText leaves short text untouched', () => {
  assert.equal(clampText('short', 100), 'short');
  assert.equal(clampText('', 100), '');
});
