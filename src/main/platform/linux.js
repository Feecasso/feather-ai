'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { run, runElevatedShell } = require('../exec');

let activeSignal = null;
const {
  humanBytes,
  parseDf,
  parseSs,
  normalizeListeners,
  summarizeListeners,
  parseLastb,
  parseOsRelease,
  parseSshdConfig,
  parseResolvConf,
  parseEnabledUnits,
  findSuspiciousCommands
} = require('../parsers');

async function readText(file, max = 512 * 1024) {
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile() || stat.size > max) return null;
    return await fsp.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

const commandCache = new Map();
function commandExists(command) {
  if (commandCache.has(command)) return commandCache.get(command);
  const result = spawnSync('sh', ['-c', `command -v ${JSON.stringify(command)} >/dev/null 2>&1`], {
    timeout: 5000,
    windowsHide: true
  });
  const found = result.status === 0;
  commandCache.set(command, found);
  return found;
}

async function sh(script, options = {}) {
  return run('/bin/sh', ['-c', script], { timeout: 20000, ...options, signal: options.signal ?? activeSignal });
}

async function systemctl(args, options = {}) {
  return run('systemctl', args, { timeout: 15000, ...options, signal: options.signal ?? activeSignal });
}

async function isActive(unit) {
  const result = await systemctl(['is-active', unit]);
  return (result.stdout || '').trim() === 'active';
}

async function readAutostart() {
  const dirs = [path.join(os.homedir(), '.config/autostart'), '/etc/xdg/autostart'];
  const entries = [];
  for (const dir of dirs) {
    let names = [];
    try {
      names = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names.filter((n) => n.endsWith('.desktop')).slice(0, 100)) {
      const text = await readText(path.join(dir, name));
      if (!text) continue;
      const get = (key) => (text.match(new RegExp(`^${key}=(.+)$`, 'mi')) || [])[1]?.trim() || '';
      if (/^Hidden\s*=\s*true/im.test(text)) continue;
      entries.push({ name: get('Name') || name, exec: get('Exec'), file: path.join(dir, name), scope: dir.startsWith(os.homedir()) ? 'user' : 'system' });
    }
  }
  return entries;
}

async function getSystemInfo() {
  const osRelease = parseOsRelease((await readText('/etc/os-release')) || '');
  const pretty = osRelease.PRETTY_NAME || osRelease.NAME || 'Linux';
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const admin = uid === 0;
  const groups = (() => {
    try {
      return os.userInfo().username ? spawnSync('id', ['-nG'], { encoding: 'utf8', timeout: 4000 }).stdout.trim().split(/\s+/) : [];
    } catch {
      return [];
    }
  })();
  return {
    computerName: os.hostname(),
    osName: pretty,
    osDetail: `Linux ${os.release()} (${os.arch()})`,
    admin,
    elevation: commandExists('pkexec') ? 'pkexec' : commandExists('sudo') ? 'sudo' : 'none',
    mode: 'Offline - local only',
    user: os.userInfo().username,
    inAdminGroup: admin || groups.includes('sudo') || groups.includes('wheel')
  };
}

async function checkOsInfo() {
  const release = parseOsRelease((await readText('/etc/os-release')) || '');
  const pretty = release.PRETTY_NAME || release.NAME || 'Linux';
  return {
    status: 'info',
    finding: `${pretty} — kernel ${os.release()} (${os.arch()})`,
    evidence: [
      `Distribution: ${pretty}`,
      `Distribution ID: ${release.ID || 'unknown'} ${release.VERSION_ID || ''}`.trim(),
      `Kernel: ${os.release()}`,
      `Architecture: ${os.arch()}`,
      `Computer: ${os.hostname()}`
    ].join('\n'),
    explanation: 'This identifies the operating system that the checks are running on. It is read from the local system.',
    nextStep: 'No action required. Keep the operating system updated through its normal update tool.'
  };
}

async function checkUptime() {
  const seconds = Math.max(0, Math.floor(os.uptime()));
  const boot = new Date(Date.now() - seconds * 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return {
    status: 'info',
    finding: `Running for ${days} day${days === 1 ? '' : 's'}, ${hours} hour${hours === 1 ? '' : 's'}`,
    evidence: `Last start: ${boot.toISOString()}\nUptime: ${seconds} seconds`,
    explanation: 'A long uptime means kernel and service updates may be installed but not active until the next restart.',
    nextStep: days >= 30 ? 'Consider a restart at a convenient time so installed kernel updates take effect.' : 'No action required.'
  };
}

async function checkCpuMemory() {
  const cpus = os.cpus();
  const total = os.totalmem();
  const free = os.freemem();
  const usedPct = Math.round((1 - free / total) * 100);
  const load = os.loadavg()[0];
  const cores = cpus.length || 1;
  const meminfo = (await readText('/proc/meminfo')) || '';
  const swapTotal = Number((meminfo.match(/^SwapTotal:\s+(\d+)/m) || [])[1] || 0) * 1024;
  const swapFree = Number((meminfo.match(/^SwapFree:\s+(\d+)/m) || [])[1] || 0) * 1024;
  const status = usedPct >= 90 ? 'warn' : 'pass';
  return {
    status,
    finding: `${cpus[0]?.model?.trim() || 'Processor'} — ${cores} cores, ${humanBytes(total)} RAM (${usedPct}% used)`,
    evidence: [
      `CPU: ${cpus[0]?.model?.trim() || 'unknown'} (${cores} logical processors)`,
      `Load average (1 min): ${load.toFixed(2)}`,
      `Memory: ${humanBytes(total - free)} used of ${humanBytes(total)} (${usedPct}%)`,
      `Swap: ${humanBytes(swapTotal - swapFree)} used of ${humanBytes(swapTotal)}`
    ].join('\n'),
    explanation: 'Memory use at or above 90% can cause slowdowns and failed operations. The threshold is documented and applied consistently.',
    nextStep: status === 'warn' ? 'Close unused memory-heavy programs. If this is persistent, add memory.' : 'No action required.'
  };
}

async function checkDiskSpace() {
  let parsed = null;
  const df = await sh("df -Pk / 2>/dev/null");
  if (df.stdout) parsed = parseDf(df.stdout);
  if (!parsed) {
    try {
      const st = await fsp.statfs('/');
      const total = Number(st.blocks) * Number(st.bsize);
      const free = Number(st.bavail) * Number(st.bsize);
      parsed = { totalKb: total / 1024, freeKb: free / 1024, usedPct: Math.round((1 - free / total) * 100), mount: '/' };
    } catch {
      return { status: 'error', finding: 'Disk space could not be measured.', evidence: df.stderr, explanation: 'The filesystem did not return statistics.', nextStep: 'Run the check again with administrator rights.' };
    }
  }
  const freePct = 100 - parsed.usedPct;
  const status = freePct < 5 ? 'fail' : freePct < 15 ? 'warn' : 'pass';
  return {
    status,
    finding: `${humanBytes(parsed.freeKb * 1024)} free on / (${freePct}% available)`,
    evidence: `Filesystem: ${parsed.filesystem || parsed.mount}\nTotal: ${humanBytes((parsed.totalKb || 0) * 1024)}\nFree: ${humanBytes(parsed.freeKb * 1024)}\nUsed: ${parsed.usedPct}%`,
    explanation: 'Less than 15% free space can prevent updates and logging. Less than 5% is treated as a failure. These thresholds are fixed in the source.',
    nextStep: status === 'pass' ? 'No action required.' : 'Remove unneeded files or move large files to external storage before installing updates.'
  };
}

async function checkTimeSync() {
  if (commandExists('timedatectl')) {
    const result = await sh("timedatectl show -p NTPSynchronized -p NTP --value 2>/dev/null");
    const lines = result.stdout.split(/\r?\n/).map((l) => l.trim());
    if (lines.length >= 2 && /^(yes|no)$/i.test(lines[0])) {
      const sync = /^yes$/i.test(lines[0]);
      return {
        status: sync ? 'pass' : 'warn',
        finding: sync ? 'System clock is synchronized.' : 'System clock is not synchronized.',
        evidence: `NTPSynchronized: ${lines[0]}\nNTP enabled: ${lines[1] || 'unknown'}`,
        explanation: 'A correct clock is required for certificate validation and accurate log timestamps. Offline computers can still use a local or hardware time source.',
        nextStep: sync ? 'No action required.' : 'Enable a reliable time source for the system. On an offline computer, check the hardware clock.'
      };
    }
  }
  if (commandExists('chronyc')) {
    const result = await sh('chronyc tracking 2>/dev/null');
    if (result.ok) {
      const leap = (result.stdout.match(/^Leap status\s*:\s*(.+)$/m) || [])[1] || 'unknown';
      const sync = /normal/i.test(leap);
      return {
        status: sync ? 'pass' : 'warn',
        finding: `chrony leap status: ${leap}`,
        evidence: result.stdout,
        explanation: 'Chrony reports whether the clock is disciplined by a time source.',
        nextStep: sync ? 'No action required.' : 'Check the configured time sources and whether the network is reachable.'
      };
    }
  }
  return {
    status: 'info',
    finding: 'Time synchronization could not be verified with the available tools.',
    evidence: 'Neither timedatectl nor chronyc returned a usable synchronization state.',
    explanation: 'Feather AI does not invent a synchronization result. This check needs systemd-timesyncd, chrony, or ntp.',
    nextStep: 'Verify the system clock manually, especially before using certificates or reading security logs.'
  };
}

async function checkRights() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const info = await getSystemInfo();
  const result = spawnSync('id', [], { encoding: 'utf8', timeout: 5000 });
  return {
    status: info.admin ? 'pass' : 'info',
    finding: info.admin ? 'Running with root (administrator) rights.' : `Running as ${os.userInfo().username} (standard user).`,
    evidence: (result.stdout || `uid=${uid}`).trim(),
    explanation: 'Feather AI runs checks as the current user. Repairs that need root rights request approval separately; the main window is not elevated.',
    nextStep: info.admin ? 'No action required.' : 'No action required for read-only checks. Repairs that need administrator rights will show an approval prompt.'
  };
}

async function checkPendingReboot() {
  const files = ['/run/reboot-required', '/var/run/reboot-required'];
  let present = false;
  let packages = '';
  for (const file of files) {
    if (await exists(file)) {
      present = true;
      packages = (await readText(file)) || '';
      if (await exists(`${file}.pkgs`)) packages += `\n${(await readText(`${file}.pkgs`)) || ''}`;
      break;
    }
  }
  let newerKernel = null;
  try {
    const running = os.release();
    const modules = (await fsp.readdir('/usr/lib/modules')).filter((n) => !n.includes('.'));
    const newest = modules.sort().at(-1);
    if (newest && newest !== running) newerKernel = newest;
  } catch {
    /* not available */
  }
  if (present) {
    return {
      status: 'warn',
      finding: 'A restart is pending to finish installed updates.',
      evidence: `Marker: /run/reboot-required\n${packages.trim() || 'No package list was provided.'}`,
      explanation: 'The package manager marked the system as needing a restart. Some updates are not active until then.',
      nextStep: 'Save your work and restart at a convenient time.'
    };
  }
  if (newerKernel) {
    return {
      status: 'warn',
      finding: `A newer kernel (${newerKernel}) is installed but ${os.release()} is running.`,
      evidence: `Running kernel: ${os.release()}\nNewest installed: ${newerKernel}`,
      explanation: 'Kernel updates take effect only after a restart. The running kernel may lack the latest security fixes.',
      nextStep: 'Restart at a convenient time to activate the installed kernel.'
    };
  }
  return {
    status: 'pass',
    finding: 'No pending restart was found.',
    evidence: `No /run/reboot-required marker.\nRunning kernel: ${os.release()}`,
    explanation: 'No common restart marker was found and the running kernel matches the newest installed kernel.',
    nextStep: 'No action required.'
  };
}

async function checkFailedServices() {
  if (!commandExists('systemctl')) {
    return { status: 'skip', finding: 'systemd is not available.', evidence: 'systemctl was not found.', explanation: 'This check applies to systemd-based Linux systems.', nextStep: 'No action required.' };
  }
  const result = await systemctl(['--failed', '--no-legend', '--plain']);
  const lines = result.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!result.ok && !result.stdout) {
    return { status: 'info', finding: 'Failed services could not be listed.', evidence: result.stderr, explanation: 'systemctl did not return a usable list.', nextStep: 'Run this check with administrator rights.' };
  }
  return {
    status: lines.length ? 'warn' : 'pass',
    finding: lines.length ? `${lines.length} automatic service${lines.length === 1 ? '' : 's'} failed.` : 'No failed systemd services.',
    evidence: lines.slice(0, 12).join('\n') || 'systemctl reported no failed units.',
    explanation: 'Failed units can leave security, network, or update services inactive. A failed unit is not by itself evidence of an attack.',
    nextStep: lines.length ? 'Open a terminal only if you are comfortable doing so, and run: systemctl status <unit>. Or restart the failed service from Repair Tools.' : 'No action required.'
  };
}

async function checkBattery() {
  let dirs = [];
  try {
    dirs = await fsp.readdir('/sys/class/power_supply');
  } catch {
    return { status: 'skip', finding: 'Battery information is not available.', evidence: '/sys/class/power_supply is not readable.', explanation: 'This check requires Linux power-supply information.', nextStep: 'No action required.' };
  }
  const batteries = [];
  for (const dir of dirs) {
    const base = path.join('/sys/class/power_supply', dir);
    const type = ((await readText(path.join(base, 'type'))) || '').trim();
    if (type !== 'Battery') continue;
    const capacity = Number(((await readText(path.join(base, 'capacity'))) || '').trim());
    const status = ((await readText(path.join(base, 'status'))) || 'unknown').trim();
    const health = ((await readText(path.join(base, 'health'))) || '').trim();
    batteries.push({ name: dir, capacity, status, health });
  }
  if (!batteries.length) {
    return { status: 'skip', finding: 'No battery detected (desktop or virtual machine).', evidence: 'No power supply of type Battery was found.', explanation: 'Battery health checks only apply to laptops.', nextStep: 'No action required.' };
  }
  const worst = batteries.sort((a, b) => a.capacity - b.capacity)[0];
  const discharging = /discharging/i.test(worst.status);
  const badHealth = worst.health && !/good|normal/i.test(worst.health);
  const status = (discharging && worst.capacity <= 15) || badHealth ? 'warn' : 'pass';
  return {
    status,
    finding: `${worst.name}: ${Number.isFinite(worst.capacity) ? `${worst.capacity}%` : 'charge unknown'}, ${worst.status}${worst.health ? `, health ${worst.health}` : ''}`,
    evidence: batteries.map((b) => `${b.name}: ${b.capacity}% ${b.status} ${b.health}`).join('\n'),
    explanation: 'Very low charge or a battery reporting poor health can cause unexpected shutdowns. Charge readings are approximate.',
    nextStep: status === 'warn' ? 'Connect the charger and check the battery with the hardware vendor’s diagnostic tool.' : 'No action required.'
  };
}

async function checkSecureBoot() {
  if (commandExists('mokutil')) {
    const result = await sh('mokutil --sb-state 2>/dev/null');
    const text = result.stdout || result.stderr;
    if (/enabled/i.test(text)) {
      return { status: 'pass', finding: 'Secure Boot is enabled.', evidence: text, explanation: 'Secure Boot verifies the bootloader and kernel against trusted signatures. It is one layer of protection, not a guarantee.', nextStep: 'No action required.' };
    }
    if (/disabled/i.test(text)) {
      return { status: 'warn', finding: 'Secure Boot is disabled.', evidence: text, explanation: 'With Secure Boot disabled, unsigned boot code can run. Some Linux configurations intentionally disable it for drivers.', nextStep: 'If your distribution supports Secure Boot, consider enabling it. Verify required drivers first.' };
    }
  }
  if (!(await exists('/sys/firmware/efi'))) {
    return { status: 'skip', finding: 'The computer booted in legacy BIOS mode.', evidence: '/sys/firmware/efi is not present.', explanation: 'Secure Boot requires UEFI firmware. A legacy-boot system cannot report Secure Boot state.', nextStep: 'No action required unless you plan to migrate the system to UEFI.' };
  }
  return { status: 'info', finding: 'Secure Boot state could not be read.', evidence: 'UEFI firmware is present, but mokutil is not installed or returned no state.', explanation: 'Feather AI does not guess the firmware state.', nextStep: 'Install mokutil or check the firmware setup screen.' };
}

async function checkStartupItems() {
  const entries = await readAutostart();
  const suspicious = findSuspiciousCommands(entries.map((e) => e.exec));
  return {
    status: suspicious.length ? 'warn' : 'info',
    finding: entries.length ? `${entries.length} startup program${entries.length === 1 ? '' : 's'} configured (${entries.filter((e) => e.scope === 'user').length} user, ${entries.filter((e) => e.scope === 'system').length} system).` : 'No desktop startup programs were found.',
    evidence: entries.slice(0, 20).map((e) => `[${e.scope}] ${e.name}: ${e.exec || '(no command)'}`).join('\n') || 'No .desktop entries in the usual autostart directories.',
    explanation: 'Startup entries are not inherently malicious. This is an inventory; the Security Scan applies path checks and lists suspicious commands.',
    nextStep: suspicious.length ? 'Review the flagged commands shown in the Security Scan before changing anything.' : 'No action required.'
  };
}

async function checkNetworkAdapters() {
  const result = await sh('ip -brief addr show 2>/dev/null');
  let evidence = result.stdout;
  if (!evidence) {
    const interfaces = os.networkInterfaces();
    evidence = Object.entries(interfaces)
      .flatMap(([name, addrs]) => (addrs || []).map((a) => `${name} ${a.family} ${a.address}${a.internal ? ' (internal)' : ''}`))
      .join('\n');
  }
  const active = evidence.split(/\r?\n/).filter((l) => /\bUP\b/i.test(l));
  return {
    status: 'info',
    finding: `${active.length} network interface${active.length === 1 ? '' : 's'} up.`,
    evidence: evidence || 'No network interface information was returned.',
    explanation: 'This lists local interface state. It does not contact the internet and does not test whether a remote host is reachable.',
    nextStep: 'No action required.'
  };
}

async function checkAntivirus() {
  const clam = commandExists('clamscan');
  const rkhunter = commandExists('rkhunter');
  const chkrootkit = commandExists('chkrootkit');
  const freshclamActive = clam ? await isActive('clamav-freshclam') : false;
  if (!clam && !rkhunter && !chkrootkit) {
    return {
      status: 'info',
      finding: 'No malware scanner is installed (ClamAV, rkhunter, or chkrootkit).',
      evidence: 'Feather AI does not ship malware signatures and never downloads them silently.\nClamAV: not installed\nrkhunter: not installed\nchkrootkit: not installed',
      explanation: 'Linux malware protection is optional, and many systems rely on package integrity, firewalls, and monitoring instead of on-demand scanners. This is an observation, not a claim that the system is infected.',
      nextStep: 'If you want on-demand scanning, install ClamAV through your distribution and update its signatures separately. Feather AI will use it when present.'
    };
  }
  const lines = [];
  let status = 'pass';
  if (clam) {
    const version = await sh('clamscan --version 2>/dev/null');
    lines.push(version.stdout || 'ClamAV installed (version unavailable)');
    const freshclam = commandExists('freshclam');
    if (!freshclam) lines.push('freshclam is not installed: signatures cannot be updated automatically.');
    const db = ['/var/lib/clamav/daily.cvd', '/var/lib/clamav/daily.cld'];
    let ageDays = null;
    for (const file of db) {
      try {
        const stat = await fsp.stat(file);
        ageDays = Math.floor((Date.now() - stat.mtimeMs) / 86400000);
        break;
      } catch {
        /* keep looking */
      }
    }
    if (ageDays !== null) {
      lines.push(`Signature database age: ${ageDays} day${ageDays === 1 ? '' : 's'}`);
      if (ageDays > 14) status = 'warn';
    } else {
      lines.push('Signature database age: unknown (database file not found)');
      status = 'warn';
    }
    lines.push(`clamav-freshclam service: ${freshclamActive ? 'active' : 'not active'}`);
    if (freshclamActive === false) status = status === 'pass' ? 'warn' : status;
  }
  if (rkhunter) lines.push('rkhunter: installed');
  if (chkrootkit) lines.push('chkrootkit: installed');
  return {
    status,
    finding: clam ? `ClamAV is installed${freshclamActive ? ' and its update service is active' : ', but its update service is not active'}.` : 'A rootkit scanner is installed.',
    evidence: lines.join('\n'),
    explanation: 'On-demand scanners only find what they are asked to scan. An installed scanner is not proof of protection, and a missing scanner is not proof of infection.',
    nextStep: status === 'warn' ? 'Update signatures or enable the ClamAV update service. Run a scan separately if you suspect malware.' : 'No action required.'
  };
}

async function checkFirewall() {
  const lines = [];
  let enabled = false;
  let known = false;
  for (const [unit, label] of [
    ['ufw', 'ufw'],
    ['firewalld', 'firewalld']
  ]) {
    if (commandExists(unit) || (await isActive(unit))) {
      known = true;
      const active = await isActive(unit);
      lines.push(`${label}: ${active ? 'active' : 'inactive'}`);
      if (active) enabled = true;
    }
  }
  if (!known) {
    if (commandExists('nft')) {
      const nft = await sh('nft list ruleset 2>/dev/null | head -40');
      if (nft.stdout) {
        lines.push('nftables ruleset (first 40 lines):', nft.stdout);
        known = true;
        enabled = true;
      } else {
        lines.push('nftables is installed but the ruleset could not be read without administrator rights.');
        known = true;
      }
    } else if (commandExists('iptables')) {
      const ipt = await sh('iptables -S 2>/dev/null | head -20');
      lines.push(ipt.stdout ? `iptables rules:\n${ipt.stdout}` : 'iptables is installed but rules could not be read without administrator rights.');
      known = true;
      enabled = Boolean(ipt.stdout && !/^-P\s+\w+\s+ACCEPT$/m.test(ipt.stdout));
    }
  }
  if (!known) {
    return {
      status: 'warn',
      finding: 'No host firewall tool was detected.',
      evidence: lines.join('\n') || 'ufw, firewalld, nftables, and iptables were not found.',
      explanation: 'A host firewall is one layer of defense. A missing tool does not automatically mean the network is exposed, especially behind a hardware firewall.',
      nextStep: 'If this computer joins untrusted networks, enable the firewall provided by your distribution.'
    };
  }
  if (lines[0] && /inactive/i.test(lines[0]) && !enabled) {
    return {
      status: 'warn',
      finding: 'The detected host firewall is installed but not active.',
      evidence: lines.join('\n'),
      explanation: 'A firewall that is installed but stopped does not filter traffic.',
      nextStep: 'Enable the firewall with your distribution’s normal command, after confirming it will not block remote administration you need.'
    };
  }
  if (!enabled) {
    return {
      status: 'info',
      finding: 'Firewall state could not be fully verified without administrator rights.',
      evidence: lines.join('\n'),
      explanation: 'Feather AI does not elevate read-only checks automatically. The ruleset may still be active.',
      nextStep: 'Run the check as administrator if you need a definitive firewall state.'
    };
  }
  return {
    status: 'pass',
    finding: 'A host firewall is active.',
    evidence: lines.join('\n'),
    explanation: 'The check reads local firewall status. It does not test which ports are reachable from another computer.',
    nextStep: 'No action required.'
  };
}

async function checkUpdateRecency() {
  const release = parseOsRelease((await readText('/etc/os-release')) || '');
  const id = (release.ID || '').toLowerCase();
  if (['ubuntu', 'debian', 'linuxmint', 'pop', 'kali', 'raspbian'].some((d) => id.includes(d)) && commandExists('apt-get')) {
    const result = await sh('apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null', { timeout: 75000 });
    if (!result.stdout) {
      return { status: 'info', finding: 'Security update state could not be read from the local package cache.', evidence: result.stderr, explanation: 'The apt simulation returned no data. Feather AI does not use the internet to refresh package lists.', nextStep: 'Refresh package metadata in your normal update tool, then run this check again.' };
    }
    const lines = result.stdout.split(/\r?\n/).filter((l) => /^Inst\s/.test(l));
    const security = lines.filter((l) => /security/i.test(l));
    const status = security.length ? 'warn' : 'pass';
    return {
      status,
      finding: security.length ? `${security.length} security update${security.length === 1 ? '' : 's'} are known from the local package cache.` : 'No known security updates in the local package cache.',
      evidence: security.slice(0, 20).join('\n') || (lines.length ? `${lines.length} non-security updates are available.` : 'No upgradable packages are listed.'),
      explanation: 'This uses the package lists already stored on the computer. It does not contact the internet, so newer updates may exist. A warning is not proof of an active vulnerability.',
      nextStep: security.length ? 'Apply updates through your distribution’s normal update tool when you have connectivity.' : 'No action required.'
    };
  }
  if (['fedora', 'rhel', 'centos', 'rocky', 'almalinux'].some((d) => id.includes(d)) && commandExists('dnf')) {
    const result = await sh('dnf -q updateinfo list security 2>/dev/null', { timeout: 75000 });
    const lines = result.stdout.split(/\r?\n/).filter((l) => /\b(Security|Important|Moderate|Low|Critical)\b/i.test(l));
    return {
      status: lines.length ? 'warn' : result.ok ? 'pass' : 'info',
      finding: lines.length ? `${lines.length} security advisory entries are known from cached metadata.` : 'No cached security advisories were listed.',
      evidence: lines.slice(0, 20).join('\n') || result.stderr || 'dnf returned no security advisory data.',
      explanation: 'This reads cached advisory metadata only. Feather AI does not refresh repositories or use the internet.',
      nextStep: lines.length ? 'Apply security updates through dnf when connectivity is available.' : 'Refresh metadata with your update tool if the cache is empty.'
    };
  }
  if (id.includes('arch') || id.includes('manjaro')) {
    return {
      status: 'info',
      finding: 'Rolling-release distribution: security updates are included in normal package updates.',
      evidence: `Distribution ID: ${id}`,
      explanation: 'Arch-based systems do not use separate security advisories in the local package cache. Feather AI does not contact the internet to check for updates.',
      nextStep: 'Use your normal system update procedure when online. Review Arch security advisories if you need details.'
    };
  }
  return {
    status: 'info',
    finding: 'Security update state is not available for this distribution.',
    evidence: `Distribution ID: ${id || 'unknown'}\nNo supported offline update metadata was found.`,
    explanation: 'Feather AI supports offline update metadata for apt and dnf systems only. It will not invent an update count.',
    nextStep: 'Use the distribution’s own update tool to check for security updates.'
  };
}

async function checkSmbv1() {
  const conf = (await readText('/etc/samba/smb.conf')) || '';
  const protocolLines = conf.split(/\r?\n/).filter((l) => /server\s+(min|max)\s+protocol|client\s+(min|max)\s+protocol/i.test(l));
  const sambaActive = await isActive('smbd');
  const nt1 = protocolLines.some((l) => /NT1|SMB1/i.test(l));
  if (!conf && !commandExists('smbd')) {
    return { status: 'pass', finding: 'Samba is not installed; SMBv1 is not provided by this host.', evidence: 'No /etc/samba/smb.conf and no smbd binary.', explanation: 'SMBv1 is a legacy protocol with known weaknesses. If Samba is absent, this host does not expose Samba shares.', nextStep: 'No action required.' };
  }
  if (nt1) {
    return { status: 'fail', finding: 'Samba is configured to allow SMBv1/NT1.', evidence: protocolLines.join('\n'), explanation: 'SMBv1 has known security weaknesses and should not be enabled unless a legacy device requires it.', nextStep: 'Set the Samba minimum protocol to SMB2 or SMB3, then restart Samba. Verify legacy devices first.' };
  }
  return {
    status: sambaActive ? 'pass' : 'info',
    finding: sambaActive ? 'Samba is running without SMBv1 configured.' : 'Samba is installed but not running.',
    evidence: `${protocolLines.join('\n') || 'No explicit SMB protocol limits were found; modern Samba defaults to SMB2/3.'}\nsmbd active: ${sambaActive ? 'yes' : 'no'}`,
    explanation: 'SMBv1 is disabled by default on current Samba releases. This check reads the local configuration.',
    nextStep: 'No action required.'
  };
}

async function checkRdp() {
  const installed = commandExists('xrdp') || (await exists('/usr/sbin/xrdp'));
  const active = await isActive('xrdp');
  const listeners = parseSs((await sh('ss -ltnH 2>/dev/null')).stdout).filter((r) => r.port === 3389);
  if (!installed) {
    return { status: 'pass', finding: 'No Remote Desktop server (xrdp) is installed.', evidence: 'xrdp was not found.', explanation: 'If xrdp is absent, this host does not accept Remote Desktop connections.', nextStep: 'No action required.' };
  }
  return {
    status: active ? 'warn' : 'info',
    finding: active ? 'xrdp is active and accepting Remote Desktop connections.' : 'xrdp is installed but not active.',
    evidence: `xrdp: ${active ? 'active' : 'inactive'}\nPort 3389 listeners: ${listeners.length}`,
    explanation: 'Remote Desktop expands the remote attack surface. It may be intentional. A listening service is not evidence of compromise.',
    nextStep: active ? 'Confirm Remote Desktop is required. Restrict access with a firewall or VPN and use strong authentication.' : 'No action required.'
  };
}

async function checkGuestAccount() {
  const passwd = (await readText('/etc/passwd')) || '';
  const users = passwd.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, , uid, gid, gecos, home, shell] = line.split(':');
    return { name, uid: Number(uid), gid: Number(gid), home, shell };
  });
  const guest = users.find((u) => /^(guest|guestuser)$/i.test(u.name));
  const nonRootZero = users.filter((u) => u.uid === 0 && u.name !== 'root');
  let status = 'pass';
  const lines = [`UID 0 accounts: ${users.filter((u) => u.uid === 0).map((u) => u.name).join(', ') || 'none'}`];
  if (nonRootZero.length) {
    status = 'fail';
    lines.push(`Additional UID 0 accounts: ${nonRootZero.map((u) => u.name).join(', ')}`);
  }
  if (guest) {
    lines.push(`Guest account: ${guest.name}, shell ${guest.shell || '(none)'}`);
    if (!/nologin|false/i.test(guest.shell || '')) status = status === 'fail' ? 'fail' : 'warn';
  } else {
    lines.push('No guest account was found in /etc/passwd.');
  }
  return {
    status,
    finding:
      status === 'fail'
        ? 'An account other than root has UID 0 (full root identity).'
        : guest && status === 'warn'
          ? `Guest account "${guest.name}" has a login shell.`
          : 'No guest login account or extra root-equivalent account was found.',
    evidence: lines.join('\n'),
    explanation: 'UID 0 accounts have unlimited control. Guest accounts with a shell can be used to log in without a personal identity. This check reads /etc/passwd and does not verify the password hash.',
    nextStep: status === 'pass' ? 'No action required.' : 'Review the account with getent passwd and lock or remove it if it is not required.'
  };
}

async function checkAdminAccounts() {
  const group = (await readText('/etc/group')) || '';
  const members = new Map();
  for (const line of group.split(/\r?\n/)) {
    const parts = line.split(':');
    if (parts.length < 4) continue;
    if (!['sudo', 'wheel', 'admin'].includes(parts[0])) continue;
    for (const member of parts[3].split(',').filter(Boolean)) members.set(member, parts[0]);
  }
  const passwd = (await readText('/etc/passwd')) || '';
  for (const line of passwd.split(/\r?\n/)) {
    const parts = line.split(':');
    if (parts.length >= 4 && Number(parts[2]) === 0 && parts[0] !== 'root') members.set(parts[0], 'uid0');
  }
  return {
    status: 'info',
    finding: members.size ? `${members.size} account${members.size === 1 ? '' : 's'} can elevate to administrator.` : 'No named administrative group members were found.',
    evidence: members.size ? [...members.entries()].map(([name, groupName]) => `${name} (${groupName})`).join('\n') : 'No members in sudo, wheel, or admin groups.',
    explanation: 'Administrative accounts are normal, but every one is a high-value target. This list is informational; Feather AI does not judge whether each account is legitimate.',
    nextStep: 'Review the list and remove administrative rights that are not needed. Do not change accounts you do not recognize without verifying with the owner.'
  };
}

async function checkPasswordPolicy() {
  const loginDefs = (await readText('/etc/login.defs')) || '';
  const get = (key) => {
    const m = loginDefs.match(new RegExp(`^\\s*${key}\\s+(\\d+)`, 'm'));
    return m ? Number(m[1]) : null;
  };
  const maxDays = get('PASS_MAX_DAYS');
  const minLenLoginDefs = get('PASS_MIN_LEN');
  const pwquality = (await readText('/etc/security/pwquality.conf')) || '';
  const pwMin = Number((pwquality.match(/^\s*minlen\s*=\s*(\d+)/m) || [])[1] || NaN);
  const pam = (await readText('/etc/pam.d/common-password')) || '';
  const pamMin = Number((pam.match(/minlen=(\d+)/) || [])[1] || NaN);
  const minLen = [pwMin, pamMin, minLenLoginDefs].filter(Number.isFinite).sort((a, b) => b - a)[0] ?? null;
  let status = 'pass';
  if (maxDays === null && minLen === null) status = 'info';
  if (maxDays !== null && (maxDays > 365 || maxDays >= 99999)) status = 'warn';
  if (minLen !== null && minLen < 8) status = 'warn';
  return {
    status,
    finding: `Minimum length ${minLen ?? 'not set'}; maximum password age ${maxDays ?? 'not set'} days.`,
    evidence: [
      `PASS_MAX_DAYS: ${maxDays ?? 'not set'}`,
      `PASS_MIN_LEN: ${minLenLoginDefs ?? 'not set'}`,
      `pwquality minlen: ${Number.isFinite(pwMin) ? pwMin : 'not set'}`,
      `PAM minlen: ${Number.isFinite(pamMin) ? pamMin : 'not set'}`
    ].join('\n'),
    explanation: 'These are local policy values, not the strength of any individual password. A long maximum age is common on systems that rely on other controls.',
    nextStep: status === 'pass' ? 'No action required.' : 'Review the password policy with your organization’s requirements before changing it.'
  };
}

async function checkDiskEncryption() {
  const mountSource = (await sh('findmnt -n -o SOURCE / 2>/dev/null')).stdout.trim();
  const lsblk = mountSource ? await sh(`lsblk -s -o NAME,TYPE,FSTYPE ${JSON.stringify(mountSource)} 2>/dev/null`) : { stdout: '' };
  const chain = lsblk.stdout;
  const rootEncrypted = /\bcrypt\b|crypto_LUKS/i.test(chain);
  const anyLuks = (await sh('lsblk -o NAME,TYPE,FSTYPE 2>/dev/null')).stdout;
  const luksPresent = /crypto_LUKS|\bcrypt\b/i.test(anyLuks);
  if (rootEncrypted) {
    return {
      status: 'pass',
      finding: 'The root filesystem is on a LUKS-encrypted device.',
      evidence: `Root source: ${mountSource}\n${chain}`,
      explanation: 'LUKS protects data at rest when the computer is powered off. It does not protect a running, unlocked system.',
      nextStep: 'No action required. Keep recovery keys in a safe place.'
    };
  }
  return {
    status: luksPresent ? 'info' : 'warn',
    finding: luksPresent ? 'LUKS encryption exists, but the root filesystem does not appear to be encrypted.' : 'The root filesystem does not appear to be encrypted.',
    evidence: `Root source: ${mountSource || 'unknown'}\n${chain || anyLuks || 'lsblk returned no data.'}`,
    explanation: 'Unencrypted disks can be read if the computer or drive is lost. Many desktops intentionally omit encryption; this is an observation, not a malware finding.',
    nextStep: 'If this is a portable computer, consider full-disk encryption. Back up data before changing disk layout.'
  };
}

async function checkListeningPorts() {
  const ss = await sh('ss -tulpnH 2>/dev/null');
  const rows = parseSs(ss.stdout);
  const listeners = normalizeListeners(rows, 'linux');
  const summary = summarizeListeners(listeners);
  const riskyText = summary.risky.map((l) => `${l.risky} port ${l.port} (${l.address})`).join(', ');
  return {
    status: summary.risky.length ? 'warn' : listeners.length ? 'info' : 'pass',
    finding: summary.risky.length
      ? `${summary.risky.length} risky service port${summary.risky.length === 1 ? ' is' : 's are'} reachable on all interfaces.`
      : `${listeners.length} listening socket${listeners.length === 1 ? '' : 's'}; no listed high-risk ports are exposed on all interfaces.`,
    evidence: [
      riskyText ? `Potentially risky: ${riskyText}` : 'No high-risk ports from the built-in list are bound to all interfaces.',
      '',
      ...listeners.slice(0, 30).map((l) => `${l.proto} ${l.address}:${l.port}${l.process ? ` (${l.process})` : ''}${l.exposed ? ' [all interfaces]' : ''}`)
    ].join('\n'),
    explanation: 'An exposed service is not automatically vulnerable. This check flags commonly targeted ports so you can confirm they are intended and patched. The port list is built into Feather AI and can be reviewed in docs/checks.md.',
    nextStep: summary.risky.length ? 'Confirm each flagged service is required. Restrict it to localhost or a firewall if it is not.' : 'No action required.'
  };
}

async function checkAutoruns() {
  const items = [];
  const autostart = await readAutostart();
  for (const entry of autostart) items.push({ source: `autostart (${entry.scope})`, name: entry.name, command: entry.exec });
  if (commandExists('crontab')) {
    const crontab = await run('crontab', ['-l'], { timeout: 10000, signal: activeSignal });
    if (crontab.ok) {
      crontab.stdout.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).forEach((line, i) => items.push({ source: 'user crontab', name: `line ${i + 1}`, command: line.trim() }));
    }
  }
  try {
    const cronFiles = await fsp.readdir('/etc/cron.d');
    for (const name of cronFiles.slice(0, 50)) {
      const text = await readText(path.join('/etc/cron.d', name));
      if (!text) continue;
      text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).forEach((line, i) => items.push({ source: `/etc/cron.d/${name}`, name: `line ${i + 1}`, command: line.trim() }));
    }
  } catch {
    /* no cron.d */
  }
  try {
    const userUnits = await fsp.readdir(path.join(os.homedir(), '.config/systemd/user'));
    for (const name of userUnits.filter((n) => n.endsWith('.service')).slice(0, 50)) {
      const text = await readText(path.join(os.homedir(), '.config/systemd/user', name));
      const exec = (text || '').match(/^\s*ExecStart\s*=\s*(.+)$/m)?.[1]?.trim();
      if (exec) items.push({ source: 'user systemd', name, command: exec });
    }
  } catch {
    /* none */
  }
  let enabledUnits = [];
  if (commandExists('systemctl')) {
    const units = await systemctl(['list-unit-files', '--state=enabled', '--no-legend', '--no-pager']);
    enabledUnits = parseEnabledUnits(units.stdout);
  }
  const suspicious = findSuspiciousCommands(items.map((i) => i.command));
  return {
    status: suspicious.length ? 'warn' : 'pass',
    finding: `${items.length} user/scheduled startup command${items.length === 1 ? '' : 's'}; ${suspicious.length} suspicious path${suspicious.length === 1 ? '' : 's'} found.`,
    evidence: [
      `Enabled systemd unit files: ${enabledUnits.length}`,
      ...items.slice(0, 25).map((i) => `[${i.source}] ${i.name}: ${i.command}`),
      suspicious.length ? `\nSuspicious paths:\n${suspicious.join('\n')}` : ''
    ].filter(Boolean).join('\n'),
    explanation: 'Many startup items are legitimate. The suspicious path test looks for commands launched from temporary or shared-memory directories, which is a common malware location but not proof of malware.',
    nextStep: suspicious.length ? 'Review each flagged command and its file. Do not delete anything until you confirm what it belongs to.' : 'No action required.'
  };
}

async function checkFailedLogons() {
  const lines = [];
  let source = '';
  if (commandExists('lastb')) {
    const lastb = await run('lastb', ['-n', '100'], { timeout: 15000, signal: activeSignal });
    if (lastb.ok && lastb.stdout) {
      const parsed = parseLastb(lastb.stdout);
      if (parsed.count) {
        lines.push(`lastb entries: ${parsed.count}`);
        lines.push(...parsed.sources.map((s) => `Source ${s.name}: ${s.count}`));
        lines.push(...parsed.users.map((u) => `Account ${u.name}: ${u.count}`));
        source = 'lastb';
      }
    }
  }
  if (!source && commandExists('journalctl')) {
    const journal = await run('journalctl', ['--since', '24 hours ago', '-g', 'Failed password|authentication failure|Invalid user', '--no-pager', '-o', 'cat'], { timeout: 30000, signal: activeSignal });
    if (journal.ok && journal.stdout) {
      const matches = journal.stdout.split(/\r?\n/).filter((l) => /failed password|authentication failure|invalid user/i.test(l));
      const sources = new Map();
      for (const line of matches) {
        const ip = (line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/) || [])[0];
        if (ip) sources.set(ip, (sources.get(ip) || 0) + 1);
      }
      lines.push(`Journal authentication failures: ${matches.length}`);
      [...sources.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([ip, count]) => lines.push(`Source ${ip}: ${count}`));
      lines.push(...matches.slice(-10).map((l) => `Recent: ${l}`));
      source = 'journalctl';
    } else if (/permission|not seeing|access/i.test(journal.stderr || '')) {
      return {
        status: 'info',
        finding: 'Authentication logs are not readable by this user.',
        evidence: journal.stderr,
        explanation: 'Feather AI does not elevate read-only checks automatically. It will not guess how many failed logons occurred.',
        nextStep: 'Run this check as administrator, or add your user to the systemd-journal group if that is appropriate for your organization.'
      };
    }
  }
  if (!source) {
    return {
      status: 'info',
      finding: 'No readable failed-logon history was available.',
      evidence: 'Neither lastb nor the journal returned readable authentication failure records.',
      explanation: 'An empty result here means the records were unavailable, not that no failed logons occurred.',
      nextStep: 'Run the check as administrator or enable persistent authentication logging.'
    };
  }
  const count = Number((lines[0].match(/(\d+)/) || [])[1] || 0);
  const status = count >= 50 ? 'warn' : count >= 10 ? 'warn' : 'pass';
  return {
    status,
    finding: count ? `${count} failed authentication event${count === 1 ? '' : 's'} in the last 24 hours.` : 'No failed authentication events were found in the last 24 hours.',
    evidence: lines.join('\n'),
    explanation: 'Repeated failures can be a brute-force attempt, but they can also be a misconfigured device or a user typing the wrong password. This is not proof of compromise.',
    nextStep: count ? 'Check whether the source addresses are known. If they are not, restrict remote access and review the affected accounts.' : 'No action required.'
  };
}

async function checkSecurityExclusions() {
  const files = ['/etc/sudoers'];
  try {
    const extra = await fsp.readdir('/etc/sudoers.d');
    extra.forEach((name) => files.push(path.join('/etc/sudoers.d', name)));
  } catch {
    /* no drop-ins */
  }
  const unreadable = [];
  const nopasswd = [];
  for (const file of files) {
    const text = await readText(file);
    if (text === null) {
      unreadable.push(file);
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*#/.test(line)) continue;
      if (/NOPASSWD\s*:/i.test(line)) nopasswd.push(`${path.basename(file)}: ${line.trim()}`);
    }
  }
  if (unreadable.length && !nopasswd.length) {
    return {
      status: 'info',
      finding: 'Sudo policy could not be fully inspected without administrator rights.',
      evidence: `Unreadable: ${unreadable.join(', ')}`,
      explanation: 'Passwordless sudo rules weaken the protection around administrative actions. Feather AI does not guess their contents.',
      nextStep: 'Run this check as administrator if you need to verify sudo policy.'
    };
  }
  return {
    status: nopasswd.length ? 'warn' : 'pass',
    finding: nopasswd.length ? `${nopasswd.length} passwordless sudo rule${nopasswd.length === 1 ? '' : 's'} found.` : 'No passwordless sudo rules were found in readable policy files.',
    evidence: nopasswd.slice(0, 20).join('\n') || `Checked: ${files.join(', ')}`,
    explanation: 'NOPASSWD rules allow commands to elevate without re-entering a password. They can be intentional for automation, but they also remove a confirmation step.',
    nextStep: nopasswd.length ? 'Confirm each rule is required. Restrict it to the specific command and user that need it.' : 'No action required.'
  };
}

async function checkDnsConfig() {
  const resolv = parseResolvConf((await readText('/etc/resolv.conf')) || '');
  const stub = resolv.servers.some((s) => s === '127.0.0.53' || s === '127.0.0.1');
  const status = resolv.servers.length ? 'info' : 'warn';
  return {
    status,
    finding: resolv.servers.length ? `DNS servers: ${resolv.servers.join(', ')}${stub ? ' (local resolver)' : ''}` : 'No DNS servers were found in /etc/resolv.conf.',
    evidence: `Nameservers: ${resolv.servers.join(', ') || 'none'}\nSearch domains: ${resolv.search.join(', ') || 'none'}`,
    explanation: 'A local stub resolver (127.0.0.53) is normal with systemd-resolved. Feather AI does not contact these servers or test whether they are malicious.',
    nextStep: resolv.servers.length ? 'No action required.' : 'Check the network configuration. Without a resolver, many network applications will fail name lookups.'
  };
}

async function checkSshConfig() {
  const base = await readText('/etc/ssh/sshd_config');
  if (base === null) {
    return { status: 'pass', finding: 'No OpenSSH server configuration was found (server not installed).', evidence: '/etc/ssh/sshd_config is not readable or does not exist.', explanation: 'Without an SSH server, this host does not accept SSH logins.', nextStep: 'No action required.' };
  }
  let merged = base;
  try {
    const dropIns = (await fsp.readdir('/etc/ssh/sshd_config.d')).filter((n) => n.endsWith('.conf')).sort();
    for (const file of dropIns) merged += `\n${(await readText(path.join('/etc/ssh/sshd_config.d', file))) || ''}`;
  } catch {
    /* no drop-ins */
  }
  const cfg = parseSshdConfig(merged);
  let status = 'pass';
  const issues = [];
  if (cfg.permitEmptyPasswords === 'yes') {
    status = 'fail';
    issues.push('empty passwords are permitted');
  }
  if (cfg.permitRootLogin === 'yes') {
    status = 'fail';
    issues.push('direct root login is permitted');
  }
  if (cfg.passwordAuthentication === 'yes') {
    if (status !== 'fail') status = 'warn';
    issues.push('password authentication is enabled');
  }
  return {
    status,
    finding: issues.length ? `SSH configuration: ${issues.join('; ')}.` : 'SSH configuration uses the safer settings checked here.',
    evidence: cfg.lines.join('\n') || 'No explicit PermitRootLogin, PasswordAuthentication, PermitEmptyPasswords, or Port lines were found.',
    explanation: 'This reads sshd_config and drop-ins only. It does not test whether SSH is reachable from the network. Key-only authentication is generally preferred over passwords.',
    nextStep:
      status === 'fail'
        ? 'Set PermitRootLogin to prohibit-password (or no) and PermitEmptyPasswords to no, then reload sshd after verifying you can still log in.'
        : status === 'warn'
          ? 'If key-based login is configured, consider setting PasswordAuthentication to no after testing access.'
          : 'No action required.'
  };
}

async function runCheck(check, ctx = {}) {
  activeSignal = ctx.signal || null;
  const map = {
    'os-info': checkOsInfo,
    uptime: checkUptime,
    'cpu-memory': checkCpuMemory,
    'disk-space': checkDiskSpace,
    'time-sync': checkTimeSync,
    rights: checkRights,
    'pending-reboot': checkPendingReboot,
    'failed-services': checkFailedServices,
    battery: checkBattery,
    'secure-boot': checkSecureBoot,
    'startup-items': checkStartupItems,
    'network-adapters': checkNetworkAdapters,
    antivirus: checkAntivirus,
    firewall: checkFirewall,
    'update-recency': checkUpdateRecency,
    smbv1: checkSmbv1,
    rdp: checkRdp,
    'guest-account': checkGuestAccount,
    'admin-accounts': checkAdminAccounts,
    'password-policy': checkPasswordPolicy,
    'disk-encryption': checkDiskEncryption,
    'listening-ports': checkListeningPorts,
    autoruns: checkAutoruns,
    'failed-logons': checkFailedLogons,
    'security-exclusions': checkSecurityExclusions,
    'dns-config': checkDnsConfig,
    'ssh-config': checkSshConfig
  };
  const fn = map[check.id];
  if (!fn) {
    return { status: 'skip', finding: 'This check is not implemented on Linux.', evidence: `Check id: ${check.id}`, explanation: 'The catalog lists this check, but no Linux implementation exists.', nextStep: 'No action required.' };
  }
  try {
    return await fn();
  } finally {
    activeSignal = null;
  }
}

async function removeOldFiles(root, cutoff, signal, counter) {
  let removed = 0;
  let bytes = 0;
  let skipped = 0;
  const stack = [root];
  while (stack.length) {
    if (signal?.aborted) break;
    const dir = stack.pop();
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      skipped += 1;
      continue;
    }
    for (const entry of entries) {
      if (signal?.aborted) break;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        skipped += 1;
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = await fsp.lstat(full);
        if (stat.uid !== (typeof process.getuid === 'function' ? process.getuid() : -1)) {
          skipped += 1;
          continue;
        }
        if (stat.mtimeMs >= cutoff) continue;
        bytes += stat.size;
        await fsp.unlink(full);
        removed += 1;
        counter.count = (counter.count || 0) + 1;
      } catch {
        skipped += 1;
      }
    }
  }
  return { removed, bytes, skipped };
}

async function getRepairAvailability() {
  const availability = {};
  const set = (id, available, reason = '') => {
    availability[id] = { available, reason };
  };
  set('flush-dns', commandExists('resolvectl') || commandExists('systemd-resolve') || commandExists('nscd'), 'No supported DNS cache tool was found.');
  set('clear-temp', true);
  set('rebuild-icons', commandExists('gtk-update-icon-cache') || commandExists('update-desktop-database'), 'No icon cache update tool was found.');
  set('clear-print-queue', commandExists('cancel'), 'The CUPS cancel command was not found.');
  set('restart-audio', commandExists('systemctl'), 'systemd user services are not available.');
  set('flush-arp', commandExists('ip'), 'The ip command was not found.');
  const cups = commandExists('systemctl') ? (await systemctl(['cat', 'cups.service'])).ok : false;
  set('restart-spooler', cups, 'The CUPS service is not installed.');
  set('create-restore-point', commandExists('timeshift') || commandExists('snapper'), 'Timeshift or Snapper is not installed.');
  const networkUnit = commandExists('systemctl') ? ((await systemctl(['cat', 'NetworkManager.service'])).ok || (await systemctl(['cat', 'systemd-networkd.service'])).ok) : false;
  set('restart-network', networkUnit, 'NetworkManager or systemd-networkd was not found.');
  set('reset-failed-units', commandExists('systemctl'), 'systemd is not available.');
  set(
    'clear-package-cache',
    commandExists('apt-get') || commandExists('dnf') || commandExists('pacman'),
    'No supported package manager was found.'
  );
  return availability;
}

function repairResult(ok, summary, details = '', extra = {}) {
  return { ok, summary, details: String(details || '').trim().slice(0, 6000), ...extra };
}

async function runRepair(repair, ctx = {}) {
  const signal = ctx.signal;
  const id = repair.id;
  if (id === 'clear-temp') {
    const cutoff = Date.now() - 2 * 86400000;
    const counter = { count: 0 };
    const result = await removeOldFiles(os.tmpdir(), cutoff, signal, counter);
    if (signal?.aborted) return repairResult(false, 'Cancelled before completion.', `Removed ${result.removed} files before cancellation.`);
    return repairResult(
      true,
      `Removed ${result.removed} temporary file${result.removed === 1 ? '' : 's'} (${humanBytes(result.bytes)}).`,
      `Location: ${os.tmpdir()}\nSkipped: ${result.skipped} files owned by other users, in use, or not regular files.`,
      { rollback: 'Temporary files cannot be restored. This action only deletes files older than two days that belong to the current user.' }
    );
  }
  if (id === 'rebuild-icons') {
    const commands = [];
    const iconDir = path.join(os.homedir(), '.local/share/icons/hicolor');
    if (commandExists('gtk-update-icon-cache') && (await exists(iconDir))) {
      commands.push(['gtk-update-icon-cache', ['-f', '-t', iconDir]]);
    }
    const appsDir = path.join(os.homedir(), '.local/share/applications');
    if (commandExists('update-desktop-database') && (await exists(appsDir))) {
      commands.push(['update-desktop-database', [appsDir]]);
    }
    if (!commands.length) return repairResult(false, 'No icon cache tool is available.', 'Install gtk-update-icon-cache or update-desktop-database.');
    const details = [];
    for (const [cmd, args] of commands) {
      const result = await run(cmd, args, { timeout: 30000, signal });
      details.push(`${cmd}: ${result.ok ? 'completed' : result.stderr || 'failed'}`);
    }
    return repairResult(true, 'Icon and desktop caches were refreshed.', details.join('\n'), { rollback: 'Caches rebuild automatically; no rollback is needed.' });
  }
  let script = '';
  let elevation = false;
  if (id === 'flush-dns') {
    script = [
      'if command -v resolvectl >/dev/null 2>&1; then resolvectl flush-caches && echo "Flushed the systemd-resolved DNS cache.";',
      'elif command -v systemd-resolve >/dev/null 2>&1; then systemd-resolve --flush-caches && echo "Flushed the systemd-resolved DNS cache.";',
      'elif command -v nscd >/dev/null 2>&1; then nscd -i hosts && echo "Flushed the nscd hosts cache.";',
      'else echo "No supported DNS cache tool is available." >&2; exit 3; fi'
    ].join(' ');
  } else if (id === 'clear-print-queue') {
    const result = await run('cancel', ['-a'], { timeout: 20000, signal });
    return repairResult(result.ok, result.ok ? 'Current user’s print jobs were cancelled.' : 'The print queue could not be cleared.', result.stdout || result.stderr, {
      rollback: 'Cancelled print jobs must be submitted again.'
    });
  } else if (id === 'restart-audio') {
    const candidates = ['pipewire', 'pipewire-pulse', 'wireplumber'].filter(Boolean);
    const result = await run('systemctl', ['--user', 'try-restart', ...candidates], { timeout: 30000, signal });
    return repairResult(result.ok, result.ok ? 'User audio services were restarted.' : 'Audio services could not be restarted.', result.stdout || result.stderr, {
      rollback: 'Reopen the audio application if it lost the output device.'
    });
  } else if (id === 'flush-arp') {
    script = 'ip neigh flush all && echo "Flushed the ARP/neighbour cache."';
    elevation = true;
  } else if (id === 'restart-spooler') {
    script = 'systemctl restart cups && echo "CUPS print service restarted."';
    elevation = true;
  } else if (id === 'create-restore-point') {
    if (commandExists('timeshift')) {
      script = "timeshift --create --comments 'Feather AI restore point' --scripted";
    } else if (commandExists('snapper')) {
      script = "snapper create --description 'Feather AI restore point' --cleanup-algorithm number";
    } else {
      return repairResult(false, 'Timeshift or Snapper is not installed.', 'Install one of these snapshot tools before using this repair.');
    }
    elevation = true;
  } else if (id === 'restart-network') {
    script = [
      'if systemctl cat NetworkManager.service >/dev/null 2>&1; then systemctl restart NetworkManager && echo "NetworkManager restarted.";',
      'elif systemctl cat systemd-networkd.service >/dev/null 2>&1; then systemctl restart systemd-networkd && echo "systemd-networkd restarted.";',
      'else echo "No supported network service was found." >&2; exit 3; fi'
    ].join(' ');
    elevation = true;
  } else if (id === 'reset-failed-units') {
    script = 'systemctl reset-failed && echo "Failed systemd unit states were reset."';
    elevation = true;
  } else if (id === 'clear-package-cache') {
    script = [
      'if command -v apt-get >/dev/null 2>&1; then apt-get clean && echo "APT package cache cleared.";',
      'elif command -v dnf >/dev/null 2>&1; then dnf clean all && echo "DNF package cache cleared.";',
      'elif command -v pacman >/dev/null 2>&1; then pacman -Scc --noconfirm && echo "Pacman package cache cleared.";',
      'else echo "No supported package manager was found." >&2; exit 3; fi'
    ].join(' ');
    elevation = true;
  }
  if (!script) return repairResult(false, 'This repair is not implemented on Linux.', `Repair id: ${id}`);
  if (!elevation) {
    const result = await run('/bin/sh', ['-c', script], { timeout: repair.timeout, signal });
    return repairResult(result.ok, result.ok ? 'Repair completed.' : 'Repair failed.', result.stdout || result.stderr, {
      rollback: 'No automatic rollback is available for this action.'
    });
  }
  const elevated = await runElevatedShell(script, { timeout: repair.timeout, signal });
  const ok = elevated.ok && !elevated.userCancelled;
  return repairResult(ok, ok ? 'Repair completed with administrator rights.' : elevated.userCancelled ? 'Administrator approval was cancelled.' : 'Repair failed.', elevated.parsed ? JSON.stringify(elevated.parsed) : elevated.stdout || elevated.stderr || elevated.message, {
    rollback: id === 'create-restore-point' ? 'The new restore point can be used to return to the pre-repair state.' : 'No automatic rollback is available for this action.'
  });
}

module.exports = {
  platform: 'linux',
  getSystemInfo,
  runCheck,
  getRepairAvailability,
  runRepair,
  commandExists
};
