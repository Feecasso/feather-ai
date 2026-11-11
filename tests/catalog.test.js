'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { tools, toolMap, allChecks, allRepairs, validateCatalog, checksForPlatform, repairsForPlatform } = require('../src/shared/catalog');

test('catalog validates without errors', () => {
  assert.deepEqual(validateCatalog(), []);
});

test('catalog contains the four documented tools', () => {
  assert.deepEqual(
    tools.map((t) => t.id),
    ['system', 'security', 'repair', 'reports']
  );
  assert.ok(toolMap.system.checks.length > 0);
  assert.ok(toolMap.security.checks.length > 0);
  assert.ok(toolMap.repair.repairs.length > 0);
});

test('every check and repair has a unique id', () => {
  assert.equal(new Set(allChecks.map((c) => c.id)).size, allChecks.length);
  assert.equal(new Set(allRepairs.map((r) => r.id)).size, allRepairs.length);
});

test('platform filtering only returns supported items', () => {
  for (const platform of ['win32', 'linux']) {
    for (const check of checksForPlatform(platform)) {
      assert.ok(check.platforms.includes(platform));
    }
    for (const repair of repairsForPlatform(platform)) {
      assert.ok(repair.platforms.includes(platform));
    }
  }
  assert.equal(checksForPlatform('win32').some((c) => c.id === 'ssh-config'), false);
  assert.equal(checksForPlatform('linux').some((c) => c.id === 'ssh-config'), true);
});

test('every catalog check has a platform handler', () => {
  const files = {
    win32: path.join(__dirname, '../src/main/platform/windows.js'),
    linux: path.join(__dirname, '../src/main/platform/linux.js')
  };
  for (const [platform, file] of Object.entries(files)) {
    const source = fs.readFileSync(file, 'utf8');
    const start = source.indexOf('async function runCheck');
    assert.ok(start > 0, `${platform} runCheck exists`);
    const end = source.indexOf('async function', start + 10);
    const body = source.slice(start, end > 0 ? end : undefined);
    const implemented = new Set([...body.matchAll(/^\s{4}'?([a-z0-9-]+)'?:\s*check/gm)].map((m) => m[1]));
    for (const check of checksForPlatform(platform)) {
      assert.ok(implemented.has(check.id), `${platform} implements catalog check ${check.id}`);
    }
  }
});

test('every catalog repair has a platform branch', () => {
  const files = {
    win32: path.join(__dirname, '../src/main/platform/windows.js'),
    linux: path.join(__dirname, '../src/main/platform/linux.js')
  };
  for (const [platform, file] of Object.entries(files)) {
    const source = fs.readFileSync(file, 'utf8');
    const implemented = new Set([...source.matchAll(/id === '([a-z0-9-]+)'/g)].map((m) => m[1]));
    for (const repair of repairsForPlatform(platform)) {
      assert.ok(implemented.has(repair.id), `${platform} implements catalog repair ${repair.id}`);
    }
  }
});

test('high-risk repairs always require administrator rights', () => {
  for (const repair of allRepairs.filter((r) => r.risk === 'High')) {
    assert.equal(repair.admin, true, `${repair.id} must require admin`);
  }
});
