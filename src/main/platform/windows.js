'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { run, runPowerShell, runElevatedPowerShell, parseJson } = require('../exec');

let activeSignal = null;
const { humanBytes, parseNetAccounts, normalizeListeners, summarizeListeners, findSuspiciousCommands } = require('../parsers');

async function ps(script, timeout = 30000) {
  const result = await runPowerShell(
    `$ErrorActionPreference = 'SilentlyContinue'\n$ProgressPreference = 'SilentlyContinue'\n${script}`,
    { timeout, signal: activeSignal }
  );
  return { ...result, json: parseJson(result.stdout) };
}

async function psElevated(script, timeout = 120000) {
  return runElevatedPowerShell(script, { timeout, signal: activeSignal });
}

async function readText(file, max = 512 * 1024) {
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile() || stat.size > max) return null;
    return await fsp.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function getSystemInfo() {
  const result = await ps(
    `$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($id)
[pscustomobject]@{
  computer = $cs.Name
  caption = $os.Caption
  version = $os.Version
  build = $os.BuildNumber
  arch = $os.OSArchitecture
  admin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  user = $id.Name
} | ConvertTo-Json -Compress`,
    20000
  );
  if (result.json) {
    return {
      computerName: result.json.computer || os.hostname(),
      osName: `${result.json.caption || 'Windows'} (build ${result.json.build || 'unknown'})`,
      osDetail: `${result.json.caption || 'Windows'} ${result.json.version || ''} ${result.json.arch || ''}`.trim(),
      admin: Boolean(result.json.admin),
      elevation: 'uac',
      mode: 'Offline - local only',
      user: result.json.user || os.userInfo().username,
      inAdminGroup: Boolean(result.json.admin)
    };
  }
  return {
    computerName: os.hostname(),
    osName: 'Windows',
    osDetail: 'Windows (version unavailable)',
    admin: false,
    elevation: 'uac',
    mode: 'Offline - local only',
    user: os.userInfo().username,
    inAdminGroup: false
  };
}

const STARTUP_SCRIPT = `
$items = @()
$paths = @(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
)
foreach ($p in $paths) {
  $k = Get-Item $p -ErrorAction SilentlyContinue
  if ($k) {
    foreach ($n in $k.GetValueNames()) {
      $items += [pscustomobject]@{ name = $n; command = [string]$k.GetValue($n); source = $p }
    }
  }
}
$startup = [Environment]::GetFolderPath('Startup')
Get-ChildItem -LiteralPath $startup -File -ErrorAction SilentlyContinue | ForEach-Object {
  $items += [pscustomobject]@{ name = $_.Name; command = $_.FullName; source = 'Startup folder' }
}
$items
`;

async function checkOsInfo() {
  const { json } = await ps(
    `$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
[pscustomobject]@{ caption = $os.Caption; version = $os.Version; build = $os.BuildNumber; arch = $os.OSArchitecture; computer = $cs.Name; model = "$($cs.Manufacturer) $($cs.Model)"; installed = $os.InstallDate } | ConvertTo-Json -Compress`,
    20000
  );
  if (!json) return failed('Operating system information could not be read.', 'PowerShell returned no usable data.');
  return {
    status: 'info',
    finding: `${json.caption || 'Windows'} build ${json.build || 'unknown'} (${json.arch || 'architecture unknown'})`,
    evidence: [`Edition: ${json.caption || 'unknown'}`, `Version: ${json.version || 'unknown'}`, `Build: ${json.build || 'unknown'}`, `Architecture: ${json.arch || 'unknown'}`, `Computer: ${json.computer || os.hostname()}`, `Model: ${json.model || 'unknown'}`].join('\n'),
    explanation: 'This identifies the Windows edition and build that the checks are running on. It is read from the local system.',
    nextStep: 'No action required. Keep Windows updated through Windows Update.'
  };
}

async function checkUptime() {
  const { json } = await ps(
    `$os = Get-CimInstance Win32_OperatingSystem
$up = (Get-Date) - $os.LastBootUpTime
[pscustomobject]@{ lastBoot = $os.LastBootUpTime.ToString('o'); days = [math]::Floor($up.TotalDays); hours = $up.Hours; minutes = $up.Minutes } | ConvertTo-Json -Compress`,
    20000
  );
  if (!json) return failed('Uptime could not be read.', 'Windows did not return the last boot time.');
  return {
    status: 'info',
    finding: `Running for ${json.days} day${json.days === 1 ? '' : 's'}, ${json.hours} hour${json.hours === 1 ? '' : 's'}`,
    evidence: `Last boot: ${json.lastBoot}`,
    explanation: 'A long uptime means installed updates may be waiting for a restart.',
    nextStep: json.days >= 30 ? 'Restart at a convenient time so updates can finish.' : 'No action required.'
  };
}

async function checkCpuMemory() {
  const { json } = await ps(
    `$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$os = Get-CimInstance Win32_OperatingSystem
[pscustomobject]@{
  cpu = $cpu.Name.Trim()
  cores = $cpu.NumberOfCores
  logical = $cpu.NumberOfLogicalProcessors
  totalKB = $os.TotalVisibleMemorySize
  freeKB = $os.FreePhysicalMemory
} | ConvertTo-Json -Compress`,
    20000
  );
  if (!json) return failed('Processor and memory information could not be read.', 'Windows returned no CPU or memory data.');
  const total = Number(json.totalKB) * 1024;
  const free = Number(json.freeKB) * 1024;
  const usedPct = total ? Math.round((1 - free / total) * 100) : 0;
  return {
    status: usedPct >= 90 ? 'warn' : 'pass',
    finding: `${json.cpu || 'Processor'} — ${json.cores} cores, ${humanBytes(total)} RAM (${usedPct}% used)`,
    evidence: [`CPU: ${json.cpu || 'unknown'} (${json.logical || json.cores} logical processors)`, `Memory: ${humanBytes(total - free)} used of ${humanBytes(total)} (${usedPct}%)`].join('\n'),
    explanation: 'Memory use at or above 90% can cause slowdowns and failed operations. The threshold is fixed in the source.',
    nextStep: usedPct >= 90 ? 'Close unused memory-heavy programs. If this is persistent, add memory.' : 'No action required.'
  };
}

async function checkDiskSpace() {
  const { json } = await ps(
    `$d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$env:SystemDrive'"
[pscustomobject]@{ drive = $d.DeviceID; size = $d.Size; free = $d.FreeSpace } | ConvertTo-Json -Compress`,
    20000
  );
  if (!json || !json.size) return failed('System drive space could not be read.', 'Windows returned no disk data.');
  const freePct = Math.round((Number(json.free) / Number(json.size)) * 100);
  const status = freePct < 5 ? 'fail' : freePct < 15 ? 'warn' : 'pass';
  return {
    status,
    finding: `${humanBytes(Number(json.free))} free on ${json.drive} (${freePct}% available)`,
    evidence: `Drive: ${json.drive}\nTotal: ${humanBytes(Number(json.size))}\nFree: ${humanBytes(Number(json.free))}`,
    explanation: 'Less than 15% free space can prevent updates and logging. Less than 5% is treated as a failure.',
    nextStep: status === 'pass' ? 'No action required.' : 'Remove unneeded files or move large files to external storage before installing updates.'
  };
}

async function checkTimeSync() {
  const { json } = await ps(
    `$svc = Get-Service w32time -ErrorAction SilentlyContinue
$out = (& w32tm /query /status 2>&1 | Out-String)
[pscustomobject]@{ service = if ($svc) { $svc.Status.ToString() } else { 'missing' }; startType = if ($svc) { $svc.StartType.ToString() } else { 'missing' }; status = $out } | ConvertTo-Json -Compress`,
    25000
  );
  if (!json) return failed('Clock synchronization could not be read.', 'w32tm returned no usable data.');
  const source = (String(json.status).match(/Source:\s*(.+)/i) || [])[1]?.trim() || '';
  const lastSync = (String(json.status).match(/Last Successful Sync Time:\s*(.+)/i) || [])[1]?.trim() || '';
  const localClock = /Local CMOS Clock/i.test(source);
  const status = localClock ? 'warn' : 'pass';
  return {
    status,
    finding: localClock ? 'The clock is using the local hardware clock, not an external time source.' : source ? `Clock source: ${source}` : 'Time service state could not be fully determined.',
    evidence: [`w32time service: ${json.service} (${json.startType})`, `Source: ${source || 'unknown'}`, `Last successful sync: ${lastSync || 'unknown'}`, '', String(json.status).trim()].join('\n'),
    explanation: 'Accurate time is required for certificate validation and log correlation. A standalone offline computer can legitimately use the local clock, but it can drift.',
    nextStep: localClock ? 'If this computer has network access, configure a reliable time source. Otherwise check the hardware clock periodically.' : 'No action required.'
  };
}

async function checkRights() {
  const { json } = await ps(
    `$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$p = New-Object Security.Principal.WindowsPrincipal($id)
[pscustomobject]@{ user = $id.Name; admin = $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } | ConvertTo-Json -Compress`,
    12000
  );
  if (!json) return failed('Privilege level could not be read.', 'Windows did not return the current identity.');
  return {
    status: json.admin ? 'pass' : 'info',
    finding: json.admin ? 'Feather AI is running with administrator rights.' : `Running as ${json.user} (standard user).`,
    evidence: `User: ${json.user}\nAdministrator: ${json.admin ? 'yes' : 'no'}`,
    explanation: 'The main window normally runs as a standard user. Repairs that need elevation request approval through the Windows UAC prompt.',
    nextStep: 'No action required. Elevation is requested only for a specific approved repair.'
  };
}

async function checkPendingReboot() {
  const { json } = await ps(
    `[pscustomobject]@{
  cbs = Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending'
  windowsUpdate = Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired'
  pendingRename = $null -ne (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue)
  updatePaused = $null -ne (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings' -Name PauseUpdatesExpiryTime -ErrorAction SilentlyContinue)
} | ConvertTo-Json -Compress`,
    15000
  );
  if (!json) return failed('Pending restart state could not be read.', 'Windows returned no registry data.');
  const pending = json.cbs || json.windowsUpdate || json.pendingRename;
  return {
    status: pending ? 'warn' : 'pass',
    finding: pending ? 'A restart is pending to finish installed updates.' : 'No pending restart was found.',
    evidence: `Component Based Servicing reboot pending: ${json.cbs}\nWindows Update reboot required: ${json.windowsUpdate}\nPending file rename: ${json.pendingRename}\nWindows Update paused: ${json.updatePaused}`,
    explanation: 'A pending restart can leave security updates inactive. Some installers also defer file replacement until restart.',
    nextStep: pending ? 'Save your work and restart at a convenient time.' : 'No action required.'
  };
}

async function checkFailedServices() {
  const { json } = await ps(
    `$bad = @(Get-CimInstance Win32_Service | Where-Object { $_.StartMode -eq 'Auto' -and $_.State -ne 'Running' })
[pscustomobject]@{ items = @($bad | Select-Object Name, DisplayName, State, StartMode) } | ConvertTo-Json -Depth 4 -Compress`,
    30000
  );
  if (!json) return failed('Automatic services could not be listed.', 'Windows returned no service data.');
  const items = json.items || [];
  return {
    status: items.length ? 'warn' : 'pass',
    finding: items.length ? `${items.length} automatic service${items.length === 1 ? '' : 's'} are not running.` : 'All automatic services are running.',
    evidence: items.slice(0, 12).map((s) => `${s.Name} (${s.DisplayName}): ${s.State}, start mode ${s.StartMode}`).join('\n') || 'No automatic service is stopped.',
    explanation: 'A stopped automatic service can indicate a failed component or update. It is not by itself evidence of an attack.',
    nextStep: items.length ? 'Review the service in Services (services.msc), or restart the specific failed service from Repair Tools.' : 'No action required.'
  };
}

async function checkBattery() {
  const { json } = await ps(
    `$b = Get-CimInstance Win32_Battery | Select-Object -First 1
if ($b) { [pscustomobject]@{ present = $true; charge = $b.EstimatedChargeRemaining; status = $b.BatteryStatus; name = $b.Name } | ConvertTo-Json -Compress } else { [pscustomobject]@{ present = $false } | ConvertTo-Json -Compress }`,
    15000
  );
  if (!json || !json.present) {
    return { status: 'skip', finding: 'No battery detected (desktop or virtual machine).', evidence: 'Win32_Battery returned no battery.', explanation: 'Battery checks apply to laptops.', nextStep: 'No action required.' };
  }
  const discharging = Number(json.status) === 2;
  const charge = Number(json.charge);
  const status = (discharging && charge <= 15) ? 'warn' : 'pass';
  return {
    status,
    finding: `${json.name || 'Battery'}: ${Number.isFinite(charge) ? `${charge}%` : 'charge unknown'}${discharging ? ', discharging' : ''}`,
    evidence: `Charge: ${json.charge ?? 'unknown'}%\nStatus code: ${json.status ?? 'unknown'}`,
    explanation: 'Very low charge can cause unexpected shutdowns. Charge readings are approximate.',
    nextStep: status === 'warn' ? 'Connect the charger and check the battery with the manufacturer’s diagnostic tool.' : 'No action required.'
  };
}

async function checkSecureBoot() {
  const { json } = await ps(
    `try { $sb = Confirm-SecureBootUEFI -ErrorAction Stop; [pscustomobject]@{ uefi = $true; secureBoot = $sb } | ConvertTo-Json -Compress } catch { [pscustomobject]@{ uefi = $false; secureBoot = $null; message = $_.Exception.Message } | ConvertTo-Json -Compress }`,
    15000
  );
  if (!json) return failed('Secure Boot state could not be read.', 'Firmware returned no data.');
  if (!json.uefi) {
    return hover('skip', 'Secure Boot state is not available (legacy BIOS or unsupported firmware).', String(json.message || 'UEFI Secure Boot is not available.'), 'Secure Boot requires UEFI firmware.', 'No action required unless you plan to use UEFI Secure Boot.');
  }
  return {
    status: json.secureBoot ? 'pass' : 'warn',
    finding: json.secureBoot ? 'Secure Boot is enabled.' : 'Secure Boot is disabled.',
    evidence: `Confirm-SecureBootUEFI: ${json.secureBoot}`,
    explanation: 'Secure Boot verifies the bootloader against trusted signatures. It is one layer of protection, not a guarantee.',
    nextStep: json.secureBoot ? 'No action required.' : 'Enable Secure Boot in firmware if your configuration supports it. Verify required drivers first.'
  };
}

async function checkStartupItems() {
  const { json } = await ps(`${STARTUP_SCRIPT}\n[pscustomobject]@{ items = @($items) } | ConvertTo-Json -Depth 4 -Compress`, 30000);
  if (!json) return failed('Startup programs could not be read.', 'Windows returned no startup data.');
  const items = json.items || [];
  return {
    status: 'info',
    finding: items.length ? `${items.length} startup program${items.length === 1 ? '' : 's'} configured.` : 'No startup programs were found in the usual locations.',
    evidence: items.slice(0, 25).map((i) => `[${i.source}] ${i.name}: ${i.command}`).join('\n') || 'No Run keys or Startup folder entries.',
    explanation: 'Startup entries are not inherently malicious. The Security Scan applies path checks to these and other autoruns.',
    nextStep: 'No action required.'
  };
}

async function checkNetworkAdapters() {
  const { json } = await ps(
    `$out = @(Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4Address } | ForEach-Object {
  [pscustomobject]@{
    name = $_.InterfaceAlias
    ip = (@($_.IPv4Address.IPAddress) -join ', ')
    gateway = (@($_.IPv4DefaultGateway.NextHop) -join ', ')
    dns = (@($_.DNSServer.ServerAddresses) -join ', ')
  }
})
[pscustomobject]@{ items = $out } | ConvertTo-Json -Depth 4 -Compress`,
    20000
  );
  if (!json) return failed('Network adapters could not be read.', 'Windows returned no IP configuration.');
  const items = json.items || [];
  return {
    status: 'info',
    finding: `${items.length} active IPv4 interface${items.length === 1 ? '' : 's'}.`,
    evidence: items.map((i) => `${i.name}: ${i.ip}; gateway ${i.gateway || 'none'}; DNS ${i.dns || 'none'}`).join('\n') || 'No active IPv4 configuration was found.',
    explanation: 'This lists local interface state. It does not contact the internet or test remote reachability.',
    nextStep: 'No action required.'
  };
}

async function checkAntivirus() {
  const { json } = await ps(
    `$mp = Get-MpComputerStatus -ErrorAction SilentlyContinue
$av = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue)
$threats = @()
if ($mp) { $threats = @(Get-MpThreatDetection -ErrorAction SilentlyContinue | Sort-Object InitialDetectionTime -Descending | Select-Object -First 10 ThreatID, ThreatName, InitialDetectionTime, ActionSuccess) }
[pscustomobject]@{
  defender = if ($mp) { [pscustomobject]@{ enabled = $mp.AMServiceEnabled; realtime = $mp.RealTimeProtectionEnabled; signatureAge = $mp.AntivirusSignatureAge; signatureVersion = $mp.AntivirusSignatureVersion } } else { $null }
  registered = $av
  threats = $threats
} | ConvertTo-Json -Depth 5 -Compress`,
    45000
  );
  if (!json) return failed('Malware protection state could not be read.', 'Windows Defender did not return status data.');
  const defender = json.defender;
  const registered = json.registered || [];
  const threats = json.threats || [];
  const lines = [];
  let status = 'pass';
  if (defender) {
    lines.push(`Defender service: ${defender.enabled ? 'enabled' : 'disabled'}`);
    lines.push(`Real-time protection: ${defender.realtime ? 'enabled' : 'disabled'}`);
    lines.push(`Signature age: ${defender.signatureAge ?? 'unknown'} days (version ${defender.signatureVersion || 'unknown'})`);
    if (defender.realtime === false) status = 'warn';
    if (Number(defender.signatureAge) > 7) status = status === 'pass' ? 'warn' : status;
  } else {
    lines.push('Windows Defender status is not available.');
  }
  lines.push(`Registered antivirus products: ${registered.length}`);
  for (const av of registered) lines.push(`- ${av.displayName || av.instanceGuid || 'registered product'}`);
  if (threats.length) {
    lines.push(`Recent threat detection entries: ${threats.length}`);
    for (const t of threats.slice(0, 5)) lines.push(`- ${t.ThreatName || t.ThreatID || 'threat'} at ${t.InitialDetectionTime || 'unknown'}, action success: ${t.ActionSuccess}`);
  }
  if (!defender && !registered.length) status = 'warn';
  if (threats.length && status === 'pass') status = 'warn';
  return {
    status,
    finding:
      threats.length
        ? `${threats.length} recent Defender threat detection entr${threats.length === 1 ? 'y' : 'ies'} recorded.`
        : defender && defender.realtime
          ? 'Antivirus real-time protection is enabled.'
          : registered.length
            ? 'A third-party antivirus product is registered.'
            : 'Antivirus protection could not be confirmed.',
    evidence: lines.join('\n'),
    explanation: 'A threat detection entry records what Defender observed and attempted. It does not by itself prove that malware is still present. Signature age over 7 days is flagged because new malware may be missed.',
    nextStep:
      status === 'warn'
        ? 'Review recent detections in Windows Security and update signatures. If a threat was not remediated, isolate the computer from untrusted networks and get help.'
        : 'No action required.'
  };
}

async function checkFirewall() {
  const { json } = await ps(
    `$p = @(Get-NetFirewallProfile -ErrorAction SilentlyContinue | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction)
[pscustomobject]@{ items = $p } | ConvertTo-Json -Depth 4 -Compress`,
    25000
  );
  if (!json) return failed('Firewall state could not be read.', 'Windows returned no firewall profile data.');
  const items = json.items || [];
  const disabled = items.filter((p) => !p.Enabled);
  return {
    status: disabled.length ? 'warn' : items.length ? 'pass' : 'info',
    finding: disabled.length ? `${disabled.map((p) => p.Name).join(', ')} firewall profile${disabled.length === 1 ? ' is' : 's are'} disabled.` : items.length ? 'All Windows firewall profiles are enabled.' : 'Firewall profiles could not be listed.',
    evidence: items.map((p) => `${p.Name}: ${p.Enabled ? 'enabled' : 'disabled'}, inbound ${p.DefaultInboundAction}`).join('\n') || 'No profiles returned.',
    explanation: 'Windows Firewall applies a separate policy per network profile. A disabled profile can expose services on that type of network.',
    nextStep: disabled.length ? 'Turn on the disabled profile in Windows Security unless a managed policy explicitly requires it off.' : 'No action required.'
  };
}

async function checkUpdateRecency() {
  const { json } = await ps(
    `$hf = Get-HotFix -ErrorAction SilentlyContinue | Sort-Object InstalledOn -Descending | Select-Object -First 1
$count = @(Get-HotFix -ErrorAction SilentlyContinue).Count
$paused = $null -ne (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings' -Name PauseUpdatesExpiryTime -ErrorAction SilentlyContinue)
[pscustomobject]@{
  latest = if ($hf) { $hf.HotFixID } else { $null }
  installed = if ($hf -and $hf.InstalledOn) { $hf.InstalledOn.ToString('yyyy-MM-dd') } else { $null }
  count = $count
  paused = $paused
} | ConvertTo-Json -Compress`,
    45000
  );
  if (!json) return failed('Installed update history could not be read.', 'Get-HotFix returned no data.');
  let ageDays = null;
  if (json.installed) {
    const date = new Date(json.installed);
    if (!Number.isNaN(date.getTime())) ageDays = Math.floor((Date.now() - date.getTime()) / 86400000);
  }
  let status = 'info';
  if (ageDays !== null) status = ageDays > 90 ? 'warn' : 'pass';
  if (json.paused) status = 'warn';
  return {
    status,
    finding:
      ageDays === null
        ? 'The latest installed update date could not be determined.'
        : `Latest installed update is ${ageDays} day${ageDays === 1 ? '' : 's'} old${json.paused ? '; Windows Update is paused' : ''}.`,
    evidence: `Latest update: ${json.latest || 'unknown'}\nInstalled: ${json.installed || 'unknown'}\nHotfix entries: ${json.count ?? 'unknown'}\nWindows Update paused: ${json.paused}`,
    explanation: 'This measures the age of installed updates from local records. It cannot see updates that are available online, and it does not install anything.',
    nextStep: status === 'warn' ? 'Check Windows Update when connectivity is available. Offline computers need a separate update process.' : 'No action required.'
  };
}

async function checkSmbv1() {
  const { json } = await ps(
    `$srv = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters' -ErrorAction SilentlyContinue
$feature = Get-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -ErrorAction SilentlyContinue
$config = Get-SmbServerConfiguration -ErrorAction SilentlyContinue
[pscustomobject]@{
  serverSMB1 = if ($null -ne $srv.SMB1) { $srv.SMB1 } else { $null }
  feature = if ($feature) { $feature.State.ToString() } else { $null }
  config = if ($config) { $config.EnableSMB1Protocol } else { $null }
} | ConvertTo-Json -Compress`,
    30000
  );
  if (!json) return failed('SMBv1 state could not be read.', 'Windows returned no SMB data.');
  const enabled = json.feature === 'Enabled' || json.serverSMB1 === 1 || json.config === true;
  return {
    status: enabled ? 'fail' : json.feature || json.serverSMB1 !== null ? 'pass' : 'info',
    finding: enabled ? 'SMBv1 is enabled.' : json.feature || json.serverSMB1 !== null ? 'SMBv1 is not enabled.' : 'SMBv1 state could not be confirmed without administrator rights.',
    evidence: `Optional feature SMB1Protocol: ${json.feature || 'unknown'}\nLanmanServer SMB1 registry value: ${json.serverSMB1 ?? 'not set'}\nGet-SmbServerConfiguration EnableSMB1Protocol: ${json.config ?? 'unknown'}`,
    explanation: 'SMBv1 is an obsolete protocol with known weaknesses. It is disabled by default on current Windows versions.',
    nextStep: enabled ? 'Disable the SMB1Protocol optional feature and remove any device that requires it. Test legacy devices first.' : 'No action required.'
  };
}

async function checkRdp() {
  const { json } = await ps(
    `$ts = Get-Service TermService -ErrorAction SilentlyContinue
$deny = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -ErrorAction SilentlyContinue).fDenyTSConnections
$nla = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp' -Name UserAuthentication -ErrorAction SilentlyContinue).UserAuthentication
[pscustomobject]@{ service = if ($ts) { $ts.Status.ToString() } else { 'missing' }; deny = $deny; nla = $nla } | ConvertTo-Json -Compress`,
    20000
  );
  if (!json) return failed('Remote Desktop state could not be read.', 'Windows returned no RDP registry data.');
  const enabled = json.deny === 0;
  return {
    status: enabled && json.nla !== 1 ? 'warn' : enabled ? 'info' : 'pass',
    finding: enabled ? `Remote Desktop is enabled${json.nla === 1 ? ' with Network Level Authentication' : ' without Network Level Authentication'}.` : 'Remote Desktop is disabled.',
    evidence: `TermService: ${json.service}\nfDenyTSConnections: ${json.deny ?? 'not set'}\nUserAuthentication (NLA): ${json.nla ?? 'not set'}`,
    explanation: 'Remote Desktop increases the remote attack surface. NLA requires authentication before a session is created and is safer than RDP without NLA.',
    nextStep: enabled ? (json.nla !== 1 ? 'Enable Network Level Authentication in System Properties, or disable Remote Desktop if it is not required.' : 'Confirm Remote Desktop is required and restrict it with a firewall or VPN.') : 'No action required.'
  };
}

async function checkGuestAccount() {
  const { json } = await ps(
    `$g = Get-LocalUser -Name Guest -ErrorAction SilentlyContinue
$users = @(Get-LocalUser -ErrorAction SilentlyContinue | Select-Object Name, Enabled, LastLogon)
[pscustomobject]@{ exists = $null -ne $g; enabled = if ($g) { $g.Enabled } else { $false }; users = $users } | ConvertTo-Json -Depth 4 -Compress`,
    30000
  );
  if (!json) return failed('Local accounts could not be read.', 'Get-LocalUser returned no data.');
  return {
    status: json.enabled ? 'fail' : 'pass',
    finding: json.exists ? (json.enabled ? 'The Guest account is enabled.' : 'The Guest account exists but is disabled.') : 'No Guest account was found.',
    evidence: (json.users || []).map((u) => `${u.Name}: ${u.Enabled ? 'enabled' : 'disabled'}, last logon ${u.LastLogon || 'never'}`).join('\n') || 'No local users returned.',
    explanation: 'An enabled Guest account allows unidentified local access. Disabled Guest is the normal default on current Windows.',
    nextStep: json.enabled ? 'Disable the Guest account in Local Users and Groups.' : 'No action required.'
  };
}

async function checkAdminAccounts() {
  const { json } = await ps(
    `try { $m = @(Get-LocalGroupMember -Group Administrators -ErrorAction Stop | Select-Object Name, ObjectClass, PrincipalSource); [pscustomobject]@{ ok = $true; members = $m } | ConvertTo-Json -Depth 4 -Compress } catch { [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }`,
    30000
  );
  if (!json || !json.ok) {
    return {
      status: 'info',
      finding: 'The administrator group could not be read without administrator rights.',
      evidence: json?.error || 'Access denied.',
      explanation: 'Feather AI does not elevate read-only checks automatically. It will not guess the administrator membership.',
      nextStep: 'Run this check as administrator if you need to review local administrator accounts.'
    };
  }
  const members = json.members || [];
  return {
    status: 'info',
    finding: `${members.length} account${members.length === 1 ? '' : 's'} in the local Administrators group.`,
    evidence: members.map((m) => `${m.Name} (${m.ObjectClass}, ${m.PrincipalSource || 'local'})`).join('\n') || 'No members returned.',
    explanation: 'Administrative accounts are normal, but every one is a high-value target. Domain groups may be shown as a single principal. Feather AI does not judge whether each account is legitimate.',
    nextStep: 'Review the list and remove local administrator rights that are not required. Verify unknown accounts before changing them.'
  };
}

async function checkPasswordPolicy() {
  const { json } = await ps(
    `$out = (& net accounts 2>&1 | Out-String)
[pscustomobject]@{ raw = $out } | ConvertTo-Json -Compress`,
    25000
  );
  if (!json) return failed('Password policy could not be read.', 'net accounts returned no data.');
  const policy = parseNetAccounts(json.raw);
  const issues = [];
  if (policy.minimumLength !== null && policy.minimumLength < 8) issues.push('minimum length below 8');
  if (policy.maximumAgeDays !== null && policy.maximumAgeDays > 365) issues.push('maximum age over 365 days');
  if (policy.lockoutThreshold === 0) issues.push('account lockout disabled');
  return {
    status: issues.length ? 'warn' : policy.minimumLength === null ? 'info' : 'pass',
    finding:
      policy.minimumLength === null
        ? 'Local password policy could not be parsed.'
        : `Minimum length ${policy.minimumLength}; maximum age ${policy.maximumAgeDays ?? 'not set'} days; lockout threshold ${policy.lockoutThreshold ?? 'not set'}.`,
    evidence: policy.raw,
    explanation: 'These are local policy values. A domain policy can override them. They do not measure the strength of any individual password.',
    nextStep: issues.length ? `Review the flagged policy: ${issues.join(', ')}. Align it with your organization’s requirements before changing it.` : 'No action required.'
  };
}

async function checkDiskEncryption() {
  const { json } = await ps(
    `try { $v = @(Get-BitLockerVolume -ErrorAction Stop | Select-Object MountPoint, VolumeStatus, ProtectionStatus, EncryptionPercentage); [pscustomobject]@{ ok = $true; volumes = $v } | ConvertTo-Json -Depth 5 -Compress } catch { [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }`,
    30000
  );
  if (!json || !json.ok) {
    return {
      status: 'info',
      finding: 'BitLocker status could not be read without administrator rights.',
      evidence: json?.error || 'Get-BitLockerVolume did not return data.',
      explanation: 'Feather AI does not elevate read-only checks automatically. It will not guess whether the disk is encrypted.',
      nextStep: 'Run this check as administrator or open BitLocker Drive Encryption in Control Panel.'
    };
  }
  const volumes = json.volumes || [];
  const system = volumes.find((v) => /^[A-Z]:\\?$/i.test(v.MountPoint || '')) || volumes[0];
  if (!system) {
    return { status: 'info', finding: 'No BitLocker volumes were returned.', evidence: 'Get-BitLockerVolume returned an empty list.', explanation: 'BitLocker may not be enabled or may be managed by another product.', nextStep: 'Check BitLocker Drive Encryption in Control Panel.' };
  }
  const protectedVolume = /on/i.test(system.ProtectionStatus || '') || /fully/i.test(system.VolumeStatus || '');
  return {
    status: protectedVolume ? 'pass' : 'warn',
    finding: protectedVolume ? `BitLocker protection is on for ${system.MountPoint}.` : `BitLocker protection is not fully enabled for ${system.MountPoint}.`,
    evidence: volumes.map((v) => `${v.MountPoint}: status ${v.VolumeStatus}, protection ${v.ProtectionStatus}, ${v.EncryptionPercentage ?? 'unknown'}% encrypted`).join('\n'),
    explanation: 'BitLocker protects data at rest when the computer is powered off. It does not protect a running, unlocked system.',
    nextStep: protectedVolume ? 'No action required. Keep recovery keys safe.' : 'If this is a portable computer, enable BitLocker and store the recovery key safely. Back up data first.'
  };
}

async function checkListeningPorts() {
  const { json } = await ps(
    `$out = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  [pscustomobject]@{ address = $_.LocalAddress; port = $_.LocalPort; process = $p.ProcessName }
})
[pscustomobject]@{ items = $out } | ConvertTo-Json -Depth 4 -Compress`,
    45000
  );
  if (!json) return failed('Listening ports could not be read.', 'Get-NetTCPConnection returned no data.');
  const listeners = normalizeListeners(json.items || [], 'win32');
  const summary = summarizeListeners(listeners);
  const riskyText = summary.risky.map((l) => `${l.risky} port ${l.port} (${l.address})`).join(', ');
  return {
    status: summary.risky.length ? 'warn' : listeners.length ? 'info' : 'pass',
    finding: summary.risky.length
      ? `${summary.risky.length} risky service port${summary.risky.length === 1 ? ' is' : 's are'} listening on all interfaces.`
      : `${listeners.length} listening socket${listeners.length === 1 ? '' : 's'}; no listed high-risk ports are exposed on all interfaces.`,
    evidence: [riskyText ? `Potentially risky: ${riskyText}` : 'No high-risk ports from the built-in list are bound to all interfaces.', '', ...listeners.slice(0, 40).map((l) => `tcp ${l.address}:${l.port}${l.process ? ` (${l.process})` : ''}${l.exposed ? ' [all interfaces]' : ''}`)].join('\n'),
    explanation: 'An exposed service is not automatically vulnerable. This flags commonly targeted ports so you can confirm they are intended and patched.',
    nextStep: summary.risky.length ? 'Confirm each flagged service is required. Restrict it to localhost or a firewall if it is not.' : 'No action required.'
  };
}

async function checkAutoruns() {
  const { json } = await ps(
    `${STARTUP_SCRIPT}
$tasks = @()
Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskPath -notlike '\\Microsoft\\*' } | ForEach-Object {
  $task = $_
  foreach ($action in @($task.Actions)) {
    if ($action.Execute) {
      $tasks += [pscustomobject]@{ name = $task.TaskName; command = "$($action.Execute) $($action.Arguments)"; source = "Scheduled task $($task.TaskPath)" }
    }
  }
}
[pscustomobject]@{ items = @($items); tasks = @($tasks) } | ConvertTo-Json -Depth 5 -Compress`,
    45000
  );
  if (!json) return failed('Startup and scheduled items could not be read.', 'Windows returned no autorun data.');
  const items = json.items || [];
  const tasks = json.tasks || [];
  const all = [...items, ...tasks];
  const suspicious = findSuspiciousCommands(all.map((i) => i.command));
  return {
    status: suspicious.length ? 'warn' : 'pass',
    finding: `${all.length} startup/scheduled command${all.length === 1 ? '' : 's'}; ${suspicious.length} suspicious path${suspicious.length === 1 ? '' : 's'} found.`,
    evidence: [`Startup entries: ${items.length}`, `Non-Microsoft scheduled tasks: ${tasks.length}`, ...all.slice(0, 30).map((i) => `[${i.source}] ${i.name}: ${i.command}`), suspicious.length ? `\nSuspicious paths:\n${suspicious.join('\n')}` : ''].filter(Boolean).join('\n'),
    explanation: 'Many autoruns are legitimate. Commands launched from temporary or user-writable paths are flagged because that is a common malware location, not because they are proven malicious.',
    nextStep: suspicious.length ? 'Review each flagged command and its file. Do not delete anything until you confirm what it belongs to.' : 'No action required.'
  };
}

async function checkFailedLogons() {
  const { json } = await ps(
    `try {
  $events = @(Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4625; StartTime = (Get-Date).AddHours(-24) } -MaxEvents 200 -ErrorAction Stop)
  $out = @()
  foreach ($e in $events) {
    $xml = [xml]$e.ToXml()
    $data = @{}
    foreach ($d in $xml.Event.EventData.Data) { $data[$d.Name] = $d.'#text' }
    $out += [pscustomobject]@{
      time = $e.TimeCreated.ToString('o')
      user = $data['TargetUserName']
      ip = $data['IpAddress']
      status = $data['Status']
      logonType = $data['LogonType']
    }
  }
  [pscustomobject]@{ ok = $true; events = $out } | ConvertTo-Json -Depth 5 -Compress
} catch {
  [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}`,
    45000
  );
  if (!json) return failed('Failed logon events could not be read.', 'Get-WinEvent returned no data.');
  if (!json.ok) {
    return {
      status: 'info',
      finding: 'Security log failed-logon events are not readable without administrator rights.',
      evidence: json.error,
      explanation: 'The Security log is protected. Feather AI does not elevate read-only checks automatically and will not invent an event count.',
      nextStep: 'Run this check as administrator if you need to review failed logons.'
    };
  }
  const events = json.events || [];
  const sources = new Map();
  const users = new Map();
  for (const e of events) {
    if (e.ip && e.ip !== '-') sources.set(e.ip, (sources.get(e.ip) || 0) + 1);
    if (e.user) users.set(e.user, (users.get(e.user) || 0) + 1);
  }
  const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => `${name}: ${count}`);
  const status = events.length >= 10 ? 'warn' : 'pass';
  return {
    status,
    finding: events.length ? `${events.length} failed logon event${events.length === 1 ? '' : 's'} in the last 24 hours.` : 'No failed logon events were found in the last 24 hours.',
    evidence: [`Events: ${events.length}`, `Top source addresses: ${top(sources).join('; ') || 'none recorded'}`, `Top accounts: ${top(users).join('; ') || 'none recorded'}`, '', ...events.slice(0, 5).map((e) => `${e.time} user ${e.user || 'unknown'} from ${e.ip || 'unknown'} (status ${e.status || 'unknown'})`)].join('\n'),
    explanation: 'Repeated failures can be a brute-force attempt, but they can also be a misconfigured device or a user typing the wrong password. This is not proof of compromise.',
    nextStep: events.length ? 'Check whether the source addresses are known. If they are not, restrict remote access and review the affected accounts.' : 'No action required.'
  };
}

async function checkSecurityExclusions() {
  const { json } = await ps(
    `$p = Get-MpPreference -ErrorAction SilentlyContinue
[pscustomobject]@{
  available = $null -ne $p
  paths = @($p.ExclusionPath)
  extensions = @($p.ExclusionExtension)
  processes = @($p.ExclusionProcess)
} | ConvertTo-Json -Depth 4 -Compress`,
    30000
  );
  if (!json || !json.available) {
    return { status: 'info', finding: 'Windows Defender exclusions could not be read.', evidence: 'Get-MpPreference returned no data.', explanation: 'Feather AI will not guess Defender configuration.', nextStep: 'Run this check as administrator or review Windows Security.' };
  }
  const paths = (json.paths || []).filter(Boolean);
  const extensions = (json.extensions || []).filter(Boolean);
  const processes = (json.processes || []).filter(Boolean);
  const count = paths.length + extensions.length + processes.length;
  return {
    status: count ? 'warn' : 'pass',
    finding: count ? `${count} Windows Defender exclusion${count === 1 ? '' : 's'} configured.` : 'No Windows Defender exclusions are configured.',
    evidence: [paths.length ? `Paths: ${paths.join(', ')}` : '', extensions.length ? `Extensions: ${extensions.join(', ')}` : '', processes.length ? `Processes: ${processes.join(', ')}` : ''].filter(Boolean).join('\n') || 'No exclusions were returned.',
    explanation: 'Exclusions tell Defender to ignore files or processes. They can be legitimate for performance or developer tools, but malware also creates them to avoid scanning. Review each one.',
    nextStep: count ? 'Confirm each exclusion is required. Remove exclusions you cannot explain, especially paths in temporary folders.' : 'No action required.'
  };
}

async function checkDnsConfig() {
  const { json } = await ps(
    `$out = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.ServerAddresses } | Select-Object InterfaceAlias, ServerAddresses)
[pscustomobject]@{ items = $out } | ConvertTo-Json -Depth 4 -Compress`,
    20000
  );
  if (!json) return failed('DNS configuration could not be read.', 'Windows returned no DNS data.');
  const items = json.items || [];
  const servers = [...new Set(items.flatMap((i) => i.ServerAddresses || []))];
  return {
    status: servers.length ? 'info' : 'warn',
    finding: servers.length ? `DNS servers: ${servers.join(', ')}` : 'No IPv4 DNS servers were found.',
    evidence: items.map((i) => `${i.InterfaceAlias}: ${(i.ServerAddresses || []).join(', ')}`).join('\n') || 'No DNS servers returned.',
    explanation: 'This lists configured DNS servers. It does not contact them or test whether they are trustworthy.',
    nextStep: servers.length ? 'No action required.' : 'Check the network adapter configuration. Without a DNS server, name lookups will fail.'
  };
}

function failed(finding, evidence) {
  return {
    status: 'error',
    finding,
    evidence: evidence || 'No data was returned.',
    explanation: 'The check could not complete, so Feather AI is not reporting a pass or a problem.',
    nextStep: 'Run the check again. If it still fails, run Feather AI as administrator or review the component named above.'
  };
}

function hover(status, finding, evidence, explanation, nextStep) {
  return { status, finding, evidence, explanation, nextStep };
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
    'dns-config': checkDnsConfig
  };
  const fn = map[check.id];
  if (!fn) {
    return { status: 'skip', finding: 'This check is not implemented on Windows.', evidence: `Check id: ${check.id}`, explanation: 'The catalog lists this check, but no Windows implementation exists.', nextStep: 'No action required.' };
  }
  try {
    return await fn();
  } finally {
    activeSignal = null;
  }
}

async function removeOldFiles(root, cutoff, signal) {
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
        if (stat.mtimeMs >= cutoff) continue;
        bytes += stat.size;
        await fsp.unlink(full);
        removed += 1;
      } catch {
        skipped += 1;
      }
    }
  }
  return { removed, bytes, skipped };
}

async function getRepairAvailability() {
  const ids = [
    'flush-dns',
    'clear-temp',
    'rebuild-icons',
    'clear-print-queue',
    'restart-audio',
    'flush-arp',
    'restart-spooler',
    'create-restore-point',
    'renew-ip',
    'reset-network',
    'sfc-scan',
    'dism-restore',
    'reset-update',
    'chkdsk-scan'
  ];
  const availability = {};
  for (const id of ids) availability[id] = { available: true, reason: '' };
  return availability;
}

async function runRepair(repair, ctx = {}) {
  activeSignal = ctx.signal || null;
  const signal = ctx.signal;
  try {
  const id = repair.id;
  const elevated = async (script, timeout = repair.timeout) => {
    const result = await psElevated(script, timeout);
    if (result.userCancelled) return { ok: false, summary: 'Administrator approval was cancelled. The action did not run.', details: '' };
    if (!result.parsed) return { ok: false, summary: 'The repair did not return a result.', details: result.message || result.stderr || '' };
    const data = result.parsed.data;
    const text = Array.isArray(data) ? data.join('\n') : typeof data === 'string' ? data : data ? JSON.stringify(data, null, 2) : result.stdout;
    return { ok: result.ok && result.parsed.ok !== false, summary: result.ok && result.parsed.ok !== false ? 'Repair completed with administrator rights.' : 'The repair failed.', details: text || result.message || '' };
  };

  if (id === 'flush-dns') {
    const result = await run('ipconfig', ['/flushdns'], { timeout: 30000, signal });
    return { ok: result.ok, summary: result.ok ? 'DNS resolver cache flushed.' : 'The DNS cache could not be flushed.', details: result.stdout || result.stderr, rollback: 'No rollback is needed; the cache repopulates automatically.' };
  }
  if (id === 'clear-temp') {
    const result = await removeOldFiles(os.tmpdir(), Date.now() - 2 * 86400000, signal);
    return {
      ok: true,
      summary: `Removed ${result.removed} temporary file${result.removed === 1 ? '' : 's'} (${humanBytes(result.bytes)}).`,
      details: `Location: ${os.tmpdir()}\nSkipped: ${result.skipped} files in use or not accessible.`,
      rollback: 'Temporary files cannot be restored. Only files older than two days were removed.'
    };
  }
  if (id === 'rebuild-icons') {
    const result = await run('ie4uinit.exe', ['-show'], { timeout: 30000, signal });
    return {
      ok: result.ok,
      summary: result.ok ? 'Icon cache refresh requested.' : 'The icon cache refresh command failed.',
      details: (result.stdout || result.stderr) + '\nIf icons still look wrong, sign out and back in. Feather AI does not restart Explorer automatically.',
      rollback: 'No rollback is needed; icon caches rebuild automatically.'
    };
  }
  if (id === 'clear-print-queue') {
    const result = await ps(
      `$jobs = @()
Get-Printer -ErrorAction SilentlyContinue | ForEach-Object {
  $name = $_.Name
  Get-PrintJob -PrinterName $name -ErrorAction SilentlyContinue | ForEach-Object { $jobs += $_ }
}
$count = @($jobs).Count
$jobs | Remove-PrintJob -ErrorAction SilentlyContinue
"Removed $count print job(s) belonging to the current user."`,
      45000
    );
    return { ok: result.ok, summary: result.ok ? 'Current user’s print jobs were cancelled.' : 'The print queue could not be cleared.', details: result.stdout || result.stderr, rollback: 'Cancelled print jobs must be submitted again.' };
  }
  if (id === 'restart-audio') {
    const result = await elevated(
      `Restart-Service -Name Audiosrv, AudioEndpointBuilder -Force -ErrorAction Stop
Write-Output "Windows audio services restarted.` + '`' + `nIf sound is still missing, reselect the output device in Settings."`
    );
    return { ...result, rollback: 'No rollback is needed. Reopen the audio application if it lost its device.' };
  }
  if (id === 'flush-arp') {
    const result = await elevated(`& netsh interface ip delete arpcache | Out-String`);
    return { ...result, rollback: 'No rollback is needed; the ARP cache rebuilds automatically.' };
  }
  if (id === 'restart-spooler') {
    const result = await elevated(`Restart-Service -Name Spooler -Force -ErrorAction Stop; Write-Output "Print Spooler restarted."`);
    return { ...result, rollback: 'No rollback is needed. The print queue is preserved.' };
  }
  if (id === 'create-restore-point') {
    const result = await elevated(
      `Checkpoint-Computer -Description 'Feather AI repair point' -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop
Write-Output "Restore point created. Use System Restore to return to it if a later repair causes a problem."`,
      180000
    );
    if (!result.ok) {
      result.details += '\nIf System Restore is disabled, enable protection for the system drive first. Feather AI does not turn it on automatically.';
    }
    return { ...result, rollback: 'This action creates the rollback point itself.' };
  }
  if (id === 'renew-ip') {
    const result = await elevated(
      `$out = & ipconfig /release 2>&1 | Out-String
$out += & ipconfig /renew 2>&1 | Out-String
$out`,
      90000
    );
    return { ...result, rollback: 'If the computer does not receive an address, reconnect the network cable or Wi-Fi, or restart the computer.' };
  }
  if (id === 'reset-network') {
    const result = await elevated(
      `$out = & netsh winsock reset 2>&1 | Out-String
$out += & netsh int ip reset 2>&1 | Out-String
$out += & ipconfig /flushdns 2>&1 | Out-String
$out + "` + '`' + `nA restart is required to finish the network reset."`,
      120000
    );
    return { ...result, rollback: 'A reboot is required. No automatic rollback is available for a network stack reset.' };
  }
  if (id === 'sfc-scan') {
    const result = await elevated(`$out = & sfc /scannow 2>&1 | Out-String; $out`, 2400000);
    const text = String(result.details || '');
    if (/did not find any integrity violations/i.test(text)) result.summary = 'System File Checker found no integrity violations.';
    else if (/successfully repaired/i.test(text)) result.summary = 'System File Checker found and repaired corrupt files.';
    else if (/unable to fix|could not perform/i.test(text)) result.summary = 'System File Checker found problems it could not repair.';
    return { ...result, rollback: 'System File Checker repairs protected files. Use the restore point if a later problem appears.' };
  }
  if (id === 'dism-restore') {
    const result = await elevated(`$out = & DISM /Online /Cleanup-Image /RestoreHealth 2>&1 | Out-String; $out`, 3000000);
    const text = String(result.details || '');
    if (/The restore operation completed successfully/i.test(text)) result.summary = 'The Windows component store was repaired successfully.';
    else if (/The operation completed successfully/i.test(text)) result.summary = 'DISM completed successfully.';
    return { ...result, rollback: 'No automatic rollback is available for component store repairs. Create a restore point first when possible.' };
  }
  if (id === 'reset-update') {
    const result = await elevated(
      `Stop-Service -Name wuauserv, bits, cryptsvc -Force -ErrorAction SilentlyContinue
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
if (Test-Path "$env:SystemRoot\\SoftwareDistribution") { Rename-Item "$env:SystemRoot\\SoftwareDistribution" "SoftwareDistribution.feather-$stamp" -ErrorAction SilentlyContinue }
if (Test-Path "$env:SystemRoot\\System32\\catroot2") { Rename-Item "$env:SystemRoot\\System32\\catroot2" "catroot2.feather-$stamp" -ErrorAction SilentlyContinue }
Start-Service -Name cryptsvc, bits, wuauserv -ErrorAction SilentlyContinue
Write-Output "Windows Update services were stopped, the update cache was renamed, and the services were started."
Write-Output "Restart Windows before checking for updates again."`,
      300000
    );
    return { ...result, rollback: 'The renamed SoftwareDistribution and catroot2 folders remain on disk. Rename them back only with expert guidance.' };
  }
  if (id === 'chkdsk-scan') {
    const result = await elevated(`$out = & chkdsk $env:SystemDrive /scan 2>&1 | Out-String; $out`, 1800000);
    const text = String(result.details || '');
    if (/Windows has scanned the file system and found no problems/i.test(text)) result.summary = 'The volume scan found no file system problems.';
    else if (/found problems/i.test(text)) result.summary = 'The volume scan found file system problems. No repair was performed.';
    return { ...result, rollback: 'This is a read-only scan. No changes were made.' };
  }
  return { ok: false, summary: 'This repair is not implemented on Windows.', details: `Repair id: ${id}` };
  } finally {
    activeSignal = null;
  }
}

module.exports = {
  platform: 'win32',
  getSystemInfo,
  runCheck,
  getRepairAvailability,
  runRepair
};
