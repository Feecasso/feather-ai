'use strict';

/** Pure text parsers used by platform checks. Kept separate so they are testable. */

function humanBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function parseDf(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const parts = lines[lines.length - 1].split(/\s+/);
  if (parts.length < 6) return null;
  const totalKb = Number(parts[1]);
  const usedKb = Number(parts[2]);
  const freeKb = Number(parts[3]);
  const pct = Number(String(parts[4]).replace('%', ''));
  if (![totalKb, usedKb, freeKb, pct].every(Number.isFinite)) return null;
  return {
    filesystem: parts[0],
    totalKb,
    usedKb,
    freeKb,
    usedPct: pct,
    mount: parts.slice(5).join(' ')
  };
}

function parseNetAccounts(text) {
  const out = { raw: String(text || '').trim(), minimumLength: null, maximumAgeDays: null, lockoutThreshold: null, lockoutDuration: null };
  for (const line of out.raw.split(/\r?\n/)) {
    const clean = line.replace(/[.]{3,}/g, ' ').replace(/\s+/g, ' ').trim();
    let m;
    if ((m = clean.match(/^Minimum password length:\s*(\d+)/i))) out.minimumLength = Number(m[1]);
    else if ((m = clean.match(/^Maximum password age \(days\):\s*(\d+)/i))) out.maximumAgeDays = Number(m[1]);
    else if ((m = clean.match(/^Lockout threshold:\s*(\d+)/i))) out.lockoutThreshold = Number(m[1]);
    else if ((m = clean.match(/^Lockout duration \(minutes\):\s*(\d+)/i))) out.lockoutDuration = Number(m[1]);
  }
  return out;
}

function parseSs(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean) continue;
    const parts = clean.split(/\s+/);
    if (parts.length < 5) continue;
    const local = parts[4] || '';
    const idx = local.lastIndexOf(':');
    if (idx < 0) continue;
    const port = Number(local.slice(idx + 1));
    if (!Number.isFinite(port)) continue;
    rows.push({
      proto: parts[0],
      state: parts[1],
      local,
      address: local.slice(0, idx),
      port,
      raw: clean
    });
  }
  return rows;
}

const RISKY_PORTS = new Map([
  [21, 'FTP'],
  [23, 'Telnet'],
  [135, 'RPC'],
  [139, 'NetBIOS'],
  [445, 'SMB'],
  [1433, 'MSSQL'],
  [3306, 'MySQL'],
  [3389, 'Remote Desktop'],
  [5432, 'PostgreSQL'],
  [5900, 'VNC'],
  [6379, 'Redis'],
  [27017, 'MongoDB']
]);

function normalizeListeners(rows, platform = 'linux') {
  const listeners = [];
  for (const row of rows || []) {
    let address = row.address || row.localAddress || '';
    let port = Number(row.port || row.localPort);
    if (!Number.isFinite(port)) continue;
    const exposed = platform === 'win32'
      ? address === '0.0.0.0' || address === '::' || address === '[::]'
      : address === '0.0.0.0' || address === '::' || address === '*' || address === '[::]';
    listeners.push({
      port,
      address,
      exposed,
      process: row.process || row.processName || '',
      risky: RISKY_PORTS.get(port) || null,
      proto: row.proto || 'tcp'
    });
  }
  return listeners;
}

function summarizeListeners(listeners) {
  const risky = listeners.filter((l) => l.risky && l.exposed);
  return { total: listeners.length, exposed: listeners.filter((l) => l.exposed).length, risky };
}

function parseLastb(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const users = new Map();
  const sources = new Map();
  let count = 0;
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    if (/^btmp/i.test(parts[0]) || /^Username/i.test(parts[0])) continue;
    const user = parts[0];
    const source = parts[2];
    if (!user || !source) continue;
    count += 1;
    users.set(user, (users.get(user) || 0) + 1);
    sources.set(source, (sources.get(source) || 0) + 1);
  }
  return { count, users: topEntries(users), sources: topEntries(sources) };
}

function topEntries(map, limit = 5) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => ({ name, count }));
}

function parseOsRelease(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/\\(["\\$`])/g, '$1');
  }
  return out;
}

function parseSshdConfig(text) {
  const out = { permitRootLogin: null, passwordAuthentication: null, permitEmptyPasswords: null, port: null, lines: [] };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+)\s+(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].split('#')[0].trim();
    if (key === 'permitrootlogin') out.permitRootLogin = value.toLowerCase();
    else if (key === 'passwordauthentication') out.passwordAuthentication = value.toLowerCase();
    else if (key === 'permitemptypasswords') out.permitEmptyPasswords = value.toLowerCase();
    else if (key === 'port') out.port = Number(value) || value;
    if (['permitrootlogin', 'passwordauthentication', 'permitemptypasswords', 'port'].includes(key)) {
      out.lines.push(line);
    }
  }
  return out;
}

function parseResolvConf(text) {
  const servers = [];
  let search = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) continue;
    const m = clean.match(/^nameserver\s+(\S+)/i);
    if (m) servers.push(m[1]);
    const s = clean.match(/^search\s+(.+)$/i);
    if (s) search = s[1].split(/\s+/);
  }
  return { servers: [...new Set(servers)], search };
}

function parseEnabledUnits(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/)[0])
    .filter(Boolean);
}

function findSuspiciousCommands(lines) {
  const suspicious = [];
  for (const line of lines || []) {
    const value = String(line || '');
    if (/(?:^|[\s"'=])\/tmp\/|(?:^|[\s"'=])\/dev\/shm\/|\\Temp\\|\\AppData\\Local\\Temp\\/.test(value)) {
      suspicious.push(value.trim());
    } else if (/\.(?:scr|pif|hta|vbs|js|jse|wsf|bat|cmd)(?:"|\s|$)/i.test(value) && /Temp|tmp|AppData/i.test(value)) {
      suspicious.push(value.trim());
    }
  }
  return [...new Set(suspicious)].slice(0, 10);
}

module.exports = {
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
  findSuspiciousCommands,
  RISKY_PORTS
};
