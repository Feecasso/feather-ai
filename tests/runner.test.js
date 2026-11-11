'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { CheckRunner } = require('../src/main/runner');

function fakePlatform(handler) {
  return { platform: 'linux', runCheck: handler };
}

test('runner emits ordered progress and results', async () => {
  const events = [];
  const runner = new CheckRunner({
    platform: fakePlatform(async (check) => ({ status: 'pass', finding: `${check.name} ok`, evidence: 'ev' })),
    onEvent: (event) => events.push(event)
  });
  const run = await runner.run({ tool: 'system', checkIds: ['os-info', 'uptime'] });
  assert.equal(run.results.length, 2);
  assert.equal(run.summary.pass, 2);
  const types = events.map((e) => e.type);
  assert.equal(types[0], 'run:start');
  assert.equal(types.at(-1), 'run:done');
  const progress = events.filter((e) => e.type === 'run:progress');
  assert.equal(progress[0].percent, 0);
  assert.equal(progress.at(-1).percent, 100);
  assert.deepEqual(run.results.map((r) => r.id), ['os-info', 'uptime']);
});

test('runner converts a thrown error into an error result', async () => {
  const runner = new CheckRunner({
    platform: fakePlatform(async () => {
      throw new Error('boom');
    })
  });
  const run = await runner.run({ tool: 'system', checkIds: ['os-info'] });
  assert.equal(run.results[0].status, 'error');
  assert.match(run.results[0].evidence, /boom/);
});

test('runner rejects an empty selection', async () => {
  const runner = new CheckRunner({ platform: fakePlatform(async () => ({})) });
  await assert.rejects(() => runner.run({ tool: 'system', checkIds: [] }), /select at least one check/i);
});

test('runner rejects tools without checks', async () => {
  const runner = new CheckRunner({ platform: fakePlatform(async () => ({})) });
  await assert.rejects(() => runner.run({ tool: 'repair', checkIds: ['os-info'] }), /does not run checks/i);
});

test('runner stops when the signal is aborted', async () => {
  const controller = new AbortController();
  let calls = 0;
  const runner = new CheckRunner({
    platform: fakePlatform(async () => {
      calls += 1;
      controller.abort();
      return { status: 'pass', finding: 'ok' };
    })
  });
  const run = await runner.run({ tool: 'system', checkIds: ['os-info', 'uptime', 'cpu-memory'], signal: controller.signal });
  assert.equal(run.cancelled, true);
  assert.equal(calls, 1);
  assert.equal(run.results.length, 0);
});

test('runner ignores ids that are not in the catalog', async () => {
  const runner = new CheckRunner({ platform: fakePlatform(async () => ({ status: 'pass', finding: 'ok' })) });
  const run = await runner.run({ tool: 'system', checkIds: ['os-info', 'not-a-real-check'] });
  assert.equal(run.results.length, 1);
  assert.equal(run.results[0].id, 'os-info');
});
