'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  humanBytes,
  parseDf,
  parseNetAccounts,
  parseSs,
  normalizeListeners,
  summarizeListeners,
  parseLastb,
  parseOsRelease,
  parseSshdConfig,
  parseResolvConf,
  parseEnabledUnits,
  findSuspiciousCommands
} = require('../src/main/parsers');

test('humanBytes formats common sizes', () => {
  assert.equal(humanBytes(0), '0 B');
  assert.equal(humanBytes(512), '512 B');
  assert.equal(humanBytes(1024), '1 KB');
  assert.equal(humanBytes(1024 * 1024 * 1.5), '1.5 MB');
  assert.equal(humanBytes(-1), 'unknown');
  assert.equal(humanBytes('nope'), 'unknown');
});

test('parseDf reads the last filesystem line', () => {
  const text = [
    'Filesystem     1024-blocks      Used Available Capacity Mounted on',
    'overlay           61202244  30000000  28000000      52% /'
  ].join('\n');
  const parsed = parseDf(text);
  assert.equal(parsed.filesystem, 'overlay');
  assert.equal(parsed.totalKb, 61202244);
  assert.equal(parsed.freeKb, 28000000);
  assert.equal(parsed.usedPct, 52);
  assert.equal(parsed.mount, '/');
});

test('parseDf rejects incomplete output', () => {
  assert.equal(parseDf(''), null);
  assert.equal(parseDf('one line only'), null);
});

test('parseNetAccounts extracts Windows policy values', () => {
  const text = [
    'Force user logoff how long after time expires?:       Never',
    'Minimum password length:                  8',
    'Maximum password age (days):             60',
    'Lockout threshold:                       10',
    'Lockout duration (minutes):              30'
  ].join('\r\n');
  const parsed = parseNetAccounts(text);
  assert.equal(parsed.minimumLength, 8);
  assert.equal(parsed.maximumAgeDays, 60);
  assert.equal(parsed.lockoutThreshold, 10);
  assert.equal(parsed.lockoutDuration, 30);
});

test('parseSs reads listeners and ports', () => {
  const text = [
    'tcp   LISTEN 0      4096   0.0.0.0:22      0.0.0.0:*',
    'tcp   LISTEN 0      4096      [::]:443        [::]:*',
    'udp   UNCONN 0      0      127.0.0.53:53     0.0.0.0:*'
  ].join('\n');
  const rows = parseSs(text);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].port, 22);
  assert.equal(rows[1].port, 443);
  assert.equal(rows[2].port, 53);
  assert.equal(rows[2].address, '127.0.0.53');
});

test('normalizeListeners marks exposure and risky ports', () => {
  const listeners = normalizeListeners(
    [
      { proto: 'tcp', local: '0.0.0.0:445', address: '0.0.0.0', port: 445 },
      { proto: 'tcp', local: '127.0.0.1:3306', address: '127.0.0.1', port: 3306 },
      { proto: 'tcp', local: '[::]:3389', address: '[::]', port: 3389 }
    ],
    'linux'
  );
  assert.equal(listeners.length, 3);
  assert.equal(listeners[0].exposed, true);
  assert.equal(listeners[0].risky, 'SMB');
  assert.equal(listeners[1].exposed, false);
  assert.equal(listeners[2].exposed, true);
  const summary = summarizeListeners(listeners);
  assert.equal(summary.risky.length, 2);
  assert.equal(summary.exposed, 2);
});

test('parseLastb counts users and sources', () => {
  const text = ['alice  pts/0  10.0.0.5  Mon Nov 10 10:00 - 10:01 (00:01)', 'bob    ssh    10.0.0.5  Mon Nov 10 10:02 - 10:03 (00:01)'].join('\n');
  const parsed = parseLastb(text);
  assert.equal(parsed.count, 2);
  assert.equal(parsed.sources[0].name, '10.0.0.5');
  assert.equal(parsed.sources[0].count, 2);
});

test('parseOsRelease unquotes values', () => {
  const parsed = parseOsRelease('NAME="Example Linux"\nID=example\nVERSION_ID="1.2"');
  assert.equal(parsed.NAME, 'Example Linux');
  assert.equal(parsed.ID, 'example');
  assert.equal(parsed.VERSION_ID, '1.2');
});

test('parseSshdConfig honours explicit directives', () => {
  const parsed = parseSshdConfig(
    ['# PermitRootLogin yes', 'PermitRootLogin no', 'PasswordAuthentication yes', 'PermitEmptyPasswords no', 'Port 2222'].join('\n')
  );
  assert.equal(parsed.permitRootLogin, 'no');
  assert.equal(parsed.passwordAuthentication, 'yes');
  assert.equal(parsed.permitEmptyPasswords, 'no');
  assert.equal(parsed.port, 2222);
});

test('parseResolvConf collects unique nameservers', () => {
  const parsed = parseResolvConf('nameserver 127.0.0.53\nnameserver 1.1.1.1\nnameserver 127.0.0.53\nsearch example.test');
  assert.deepEqual(parsed.servers, ['127.0.0.53', '1.1.1.1']);
  assert.deepEqual(parsed.search, ['example.test']);
});

test('parseEnabledUnits keeps unit names only', () => {
  assert.deepEqual(parseEnabledUnits('ssh.service enabled\ncron.service enabled disabled\n'), ['ssh.service', 'cron.service']);
});

test('findSuspiciousCommands flags temp paths but not normal commands', () => {
  const found = findSuspiciousCommands([
    '/usr/bin/firefox %u',
    '/tmp/.hidden/update --silent',
    'C:\\Users\\a\\AppData\\Local\\Temp\\x.bat',
    '/usr/lib/systemd/systemd --user'
  ]);
  assert.equal(found.length, 2);
});
