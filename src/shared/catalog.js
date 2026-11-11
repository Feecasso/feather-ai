'use strict';

/**
 * Feather AI catalog.
 *
 * This file is intentionally dependency-free so it can be loaded by the main
 * process, the test suite, and (via IPC) the renderer. Every item shown in the
 * UI is defined here. Checks are read-only. Repairs always require a fresh
 * approval token in the main process before they can run.
 */

const ALL = ['win32', 'linux'];
const WIN = ['win32'];
const LINUX = ['linux'];

const tools = [
  {
    id: 'system',
    title: 'System Check',
    action: 'Start Check',
    icon: 'system',
    intro:
      'Verify the essentials: operating system, resources, time, updates, hardware health, and the state of core services. These checks only read information.',
    checks: [
      {
        id: 'os-info',
        name: 'Operating system',
        description: 'Name, version, build, architecture, and hardware model.',
        platforms: ALL,
        timeout: 20000
      },
      {
        id: 'uptime',
        name: 'Uptime and boot time',
        description: 'How long the computer has been running and when it last started.',
        platforms: ALL,
        timeout: 15000
      },
      {
        id: 'cpu-memory',
        name: 'Processor and memory',
        description: 'CPU model, core count, installed memory, and current memory pressure.',
        platforms: ALL,
        timeout: 15000
      },
      {
        id: 'disk-space',
        name: 'System drive space',
        description: 'Free space on the drive that holds the operating system.',
        platforms: ALL,
        timeout: 15000
      },
      {
        id: 'time-sync',
        name: 'Clock synchronization',
        description: 'Whether the system clock is synchronized with a reliable time source.',
        platforms: ALL,
        timeout: 20000
      },
      {
        id: 'rights',
        name: 'Current privileges',
        description: 'Whether Feather AI is running with administrator rights.',
        platforms: ALL,
        timeout: 10000
      },
      {
        id: 'pending-reboot',
        name: 'Pending restart',
        description: 'Whether an update or installer is waiting for a restart.',
        platforms: ALL,
        timeout: 12000
      },
      {
        id: 'failed-services',
        name: 'Automatic services',
        description: 'Services that should be running automatically but are not.',
        platforms: ALL,
        timeout: 25000
      },
      {
        id: 'battery',
        name: 'Battery health',
        description: 'Battery presence, charge level, and charging state (laptops only).',
        platforms: ALL,
        timeout: 12000
      },
      {
        id: 'secure-boot',
        name: 'Secure Boot',
        description: 'Whether firmware Secure Boot is enabled.',
        platforms: ALL,
        timeout: 15000
      },
      {
        id: 'startup-items',
        name: 'Startup programs',
        description: 'Programs configured to start with the computer or user session.',
        platforms: ALL,
        timeout: 25000
      },
      {
        id: 'network-adapters',
        name: 'Network adapters',
        description: 'Active network interfaces, addresses, gateways, and DNS servers.',
        platforms: ALL,
        timeout: 20000
      }
    ]
  },
  {
    id: 'security',
    title: 'Security Scan',
    action: 'Start Scan',
    icon: 'security',
    intro:
      'Look for common, verifiable security weaknesses: protection status, exposed services, weak authentication settings, suspicious startup entries, and recent failed logons. Findings are observations, not proof of compromise.',
    checks: [
      {
        id: 'antivirus',
        name: 'Malware protection',
        description: 'Real-time protection, signature age, registered antivirus, and recent threats.',
        platforms: ALL,
        timeout: 45000
      },
      {
        id: 'firewall',
        name: 'Host firewall',
        description: 'Whether the operating system firewall is enabled and how it treats inbound traffic.',
        platforms: ALL,
        timeout: 25000
      },
      {
        id: 'update-recency',
        name: 'Security update recency',
        description: 'Age of the latest installed update and locally known security updates.',
        platforms: ALL,
        timeout: 90000
      },
      {
        id: 'smbv1',
        name: 'Legacy SMBv1',
        description: 'Whether the obsolete SMB version 1 protocol is enabled or in use.',
        platforms: ALL,
        timeout: 30000
      },
      {
        id: 'rdp',
        name: 'Remote Desktop',
        description: 'Whether Remote Desktop is enabled and whether Network Level Authentication is required.',
        platforms: ALL,
        timeout: 25000
      },
      {
        id: 'guest-account',
        name: 'Guest and root-equivalent accounts',
        description: 'Guest accounts and extra accounts with full administrative identity.',
        platforms: ALL,
        timeout: 30000
      },
      {
        id: 'admin-accounts',
        name: 'Administrator group',
        description: 'Accounts that can elevate to administrator or root.',
        platforms: ALL,
        timeout: 30000
      },
      {
        id: 'password-policy',
        name: 'Password and lockout policy',
        description: 'Minimum length, maximum age, and account lockout thresholds.',
        platforms: ALL,
        timeout: 25000
      },
      {
        id: 'disk-encryption',
        name: 'Disk encryption',
        description: 'Whether the system volume is protected by BitLocker or LUKS.',
        platforms: ALL,
        timeout: 30000
      },
      {
        id: 'listening-ports',
        name: 'Listening network ports',
        description: 'Services accepting network connections and potentially risky exposed ports.',
        platforms: ALL,
        timeout: 30000
      },
      {
        id: 'autoruns',
        name: 'Startup and scheduled items',
        description: 'Programs, scripts, and services that start automatically, with suspicious path checks.',
        platforms: ALL,
        timeout: 45000
      },
      {
        id: 'failed-logons',
        name: 'Recent failed logons',
        description: 'Repeated authentication failures in the last 24 hours.',
        platforms: ALL,
        timeout: 45000
      },
      {
        id: 'security-exclusions',
        name: 'Security exclusions and sudo rules',
        description: 'Defender exclusions (Windows) or passwordless sudo rules (Linux) that weaken protection.',
        platforms: ALL,
        timeout: 30000
      },
      {
        id: 'dns-config',
        name: 'DNS configuration',
        description: 'DNS servers in use and whether a local resolver is active.',
        platforms: ALL,
        timeout: 20000
      },
      {
        id: 'ssh-config',
        name: 'SSH server configuration',
        description: 'Root login, password authentication, and empty-password settings.',
        platforms: LINUX,
        timeout: 25000
      }
    ]
  },
  {
    id: 'repair',
    title: 'Repair Tools',
    icon: 'repair',
    intro:
      'Repairs change the computer. Each action is listed with its impact and needs a separate approval. Windows may show a User Account Control prompt; Linux may show a PolicyKit password prompt. Nothing runs automatically.',
    repairs: [
      {
        id: 'flush-dns',
        name: 'Flush DNS cache',
        description: 'Clear cached DNS answers so stale or wrong addresses are looked up again.',
        impact: 'Resets name resolution for new connections. Existing connections are not interrupted.',
        risk: 'Low',
        admin: false,
        reboot: false,
        timeout: 30000,
        platforms: ALL
      },
      {
        id: 'clear-temp',
        name: 'Clear temporary files',
        description: 'Delete temporary files older than two days that belong to the current user.',
        impact: 'Frees disk space. Files currently in use are skipped. Other users are not touched.',
        risk: 'Low',
        admin: false,
        reboot: false,
        timeout: 120000,
        platforms: ALL
      },
      {
        id: 'rebuild-icons',
        name: 'Rebuild icon cache',
        description: 'Refresh the desktop icon and thumbnail cache.',
        impact: 'Icons may briefly redraw. No documents or application data are changed.',
        risk: 'Low',
        admin: false,
        reboot: false,
        timeout: 60000,
        platforms: ALL
      },
      {
        id: 'clear-print-queue',
        name: 'Clear print queue',
        description: 'Cancel stuck print jobs for the current user and restart the print service if needed.',
        impact: 'Unfinished print jobs are discarded. Printing becomes available again afterwards.',
        risk: 'Low',
        admin: false,
        reboot: false,
        timeout: 60000,
        platforms: ALL
      },
      {
        id: 'restart-audio',
        name: 'Restart audio service',
        description: 'Restart the service that controls sound output and recording.',
        impact: 'Audio stops for a few seconds. Applications may need to reselect the audio device.',
        risk: 'Low',
        admin: false,
        reboot: false,
        timeout: 60000,
        platforms: ALL
      },
      {
        id: 'flush-arp',
        name: 'Flush ARP cache',
        description: 'Clear cached local-network hardware addresses.',
        impact: 'The network re-learns local addresses. Connectivity may pause for a second.',
        risk: 'Low',
        admin: true,
        reboot: false,
        timeout: 30000,
        platforms: ALL
      },
      {
        id: 'restart-spooler',
        name: 'Restart print service',
        description: 'Restart the print spooler service.',
        impact: 'Printing stops for a few seconds. The queue is not deleted.',
        risk: 'Low',
        admin: true,
        reboot: false,
        timeout: 60000,
        platforms: ALL
      },
      {
        id: 'create-restore-point',
        name: 'Create restore point',
        description: 'Create a system restore point (Windows) or a Timeshift/Snapper snapshot (Linux) before further repairs.',
        impact: 'Uses disk space. No system behavior changes.',
        risk: 'Low',
        admin: true,
        reboot: false,
        timeout: 180000,
        platforms: ALL
      },
      {
        id: 'renew-ip',
        name: 'Renew network address',
        description: 'Release and request a new DHCP address.',
        impact: 'Network access is interrupted for several seconds. Static configurations are not changed.',
        risk: 'Moderate',
        admin: true,
        reboot: false,
        timeout: 90000,
        platforms: WIN
      },
      {
        id: 'reset-network',
        name: 'Reset network stack',
        description: 'Reset Winsock and the IP stack to repair persistent connection problems.',
        impact: 'All network connections drop. A restart is required. VPN and custom adapter settings may be affected.',
        risk: 'High',
        admin: true,
        reboot: true,
        timeout: 120000,
        platforms: WIN
      },
      {
        id: 'restart-network',
        name: 'Restart network service',
        description: 'Restart NetworkManager or systemd-networkd.',
        impact: 'All network connections drop briefly. Remote sessions will disconnect.',
        risk: 'Moderate',
        admin: true,
        reboot: false,
        timeout: 60000,
        platforms: LINUX
      },
      {
        id: 'reset-failed-units',
        name: 'Reset failed services',
        description: 'Clear the failed state of systemd units so they can start normally again.',
        impact: 'Does not start services. It only clears failure counters and states.',
        risk: 'Low',
        admin: true,
        reboot: false,
        timeout: 30000,
        platforms: LINUX
      },
      {
        id: 'clear-package-cache',
        name: 'Clear package cache',
        description: 'Remove downloaded package files from the local package manager cache.',
        impact: 'Frees disk space. Installed software is not removed. Future installs may need to download again.',
        risk: 'Low',
        admin: true,
        reboot: false,
        timeout: 180000,
        platforms: LINUX
      },
      {
        id: 'sfc-scan',
        name: 'Verify Windows system files',
        description: 'Run System File Checker (sfc /scannow). It repairs protected system files when possible.',
        impact: 'Can take 10 to 30 minutes. Some system files may be replaced. Do not power off during the scan.',
        risk: 'Moderate',
        admin: true,
        reboot: false,
        timeout: 2400000,
        platforms: WIN
      },
      {
        id: 'dism-restore',
        name: 'Repair Windows component store',
        description: 'Run DISM /RestoreHealth. May require Windows Update access or installation media.',
        impact: 'Can take 15 to 45 minutes and may change system components. Internet access can be required.',
        risk: 'High',
        admin: true,
        reboot: false,
        timeout: 3000000,
        platforms: WIN
      },
      {
        id: 'reset-update',
        name: 'Reset Windows Update components',
        description: 'Stop update services, rename the update cache, and restart the services.',
        impact: 'Windows Update history and downloaded updates are reset. Installed updates remain. Can take several minutes.',
        risk: 'High',
        admin: true,
        reboot: true,
        timeout: 300000,
        platforms: WIN
      },
      {
        id: 'chkdsk-scan',
        name: 'Scan system volume',
        description: 'Run an online read-only NTFS scan with chkdsk /scan.',
        impact: 'The system remains online. The scan can take several minutes. It does not repair by itself.',
        risk: 'Low',
        admin: true,
        reboot: false,
        timeout: 1800000,
        platforms: WIN
      }
    ]
  },
  {
    id: 'reports',
    title: 'Reports',
    icon: 'reports',
    intro:
      'Reports are written locally. They include the measured results, evidence, repair approvals, and the actions taken during this session. No information leaves this computer.',
    checks: []
  }
];

const toolMap = Object.fromEntries(tools.map((t) => [t.id, t]));

const allChecks = tools.flatMap((t) => (t.checks || []).map((c) => ({ ...c, tool: t.id })));
const allRepairs = tools.flatMap((t) => (t.repairs || []).map((r) => ({ ...r, tool: t.id })));

/**
 * Validate catalog integrity at startup. A broken catalog should fail loudly in
 * tests, not silently hide a check at runtime.
 */
function validateCatalog() {
  const errors = [];
  const checkIds = new Set();
  const repairIds = new Set();
  for (const tool of tools) {
    if (!tool.id || !tool.title || !tool.intro) errors.push(`tool missing fields: ${JSON.stringify(tool.id)}`);
    for (const check of tool.checks || []) {
      if (checkIds.has(check.id)) errors.push(`duplicate check id: ${check.id}`);
      checkIds.add(check.id);
      if (!Array.isArray(check.platforms) || !check.platforms.length) errors.push(`check ${check.id} has no platforms`);
      if (!(check.timeout > 0)) errors.push(`check ${check.id} has no timeout`);
    }
    for (const repair of tool.repairs || []) {
      if (repairIds.has(repair.id)) errors.push(`duplicate repair id: ${repair.id}`);
      repairIds.add(repair.id);
      if (!['Low', 'Moderate', 'High'].includes(repair.risk)) errors.push(`repair ${repair.id} has invalid risk`);
      if (typeof repair.admin !== 'boolean') errors.push(`repair ${repair.id} has invalid admin flag`);
      if (!(repair.timeout > 0)) errors.push(`repair ${repair.id} has no timeout`);
    }
  }
  return errors;
}

function checksForPlatform(platform, toolId) {
  return allChecks.filter((c) => c.platforms.includes(platform) && (!toolId || c.tool === toolId));
}

function repairsForPlatform(platform) {
  return allRepairs.filter((r) => r.platforms.includes(platform));
}

module.exports = {
  tools,
  toolMap,
  allChecks,
  allRepairs,
  validateCatalog,
  checksForPlatform,
  repairsForPlatform
};
