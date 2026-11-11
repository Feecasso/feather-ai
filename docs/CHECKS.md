# Checks

Every check is read-only. If a check cannot read a protected source (for example
the Windows Security log), it reports **Info** with an explanation instead of
guessing. Tables are generated from `src/shared/catalog.js`.

## Status meanings

| Status | Meaning |
| --- | --- |
| Pass | The measured value is within the documented range. |
| Info | Information only. No problem was determined. |
| Warning | A weakness or unusual condition needs review. |
| Fail | A security-relevant condition failed the check. |
| Error | The check could not complete. |
| Skipped | The check does not apply or is unavailable. |

## Fixed thresholds

- System drive free space: **Fail** below 5%, **Warning** below 15%.
- Memory use at or above **90%**: **Warning**.
- Windows Defender signature age over **7 days**: **Warning**.
- Linux ClamAV signature age over **14 days**: **Warning**.
- Latest installed Windows update older than **90 days**: **Warning**.
- Uptime of **30 days or more**: informational next step to restart.
- Failed authentication events: **Warning** at 10 or more in 24 hours.
- Publicly bound high-risk ports: 21, 23, 135, 139, 445, 1433, 3306, 3389,
  5432, 5900, 6379, 27017.

These thresholds live in the platform modules and are intentionally simple so
the same measurement always produces the same status.

## System Check

Verify the essentials: operating system, resources, time, updates, hardware health, and the state of core services. These checks only read information.

| Check | Platforms | Typical time | What it reads |
| --- | --- | --- | --- |
| Operating system | Windows, Linux | ~20 s | Name, version, build, architecture, and hardware model. |
| Uptime and boot time | Windows, Linux | ~15 s | How long the computer has been running and when it last started. |
| Processor and memory | Windows, Linux | ~15 s | CPU model, core count, installed memory, and current memory pressure. |
| System drive space | Windows, Linux | ~15 s | Free space on the drive that holds the operating system. |
| Clock synchronization | Windows, Linux | ~20 s | Whether the system clock is synchronized with a reliable time source. |
| Current privileges | Windows, Linux | ~10 s | Whether Feather AI is running with administrator rights. |
| Pending restart | Windows, Linux | ~12 s | Whether an update or installer is waiting for a restart. |
| Automatic services | Windows, Linux | ~25 s | Services that should be running automatically but are not. |
| Battery health | Windows, Linux | ~12 s | Battery presence, charge level, and charging state (laptops only). |
| Secure Boot | Windows, Linux | ~15 s | Whether firmware Secure Boot is enabled. |
| Startup programs | Windows, Linux | ~25 s | Programs configured to start with the computer or user session. |
| Network adapters | Windows, Linux | ~20 s | Active network interfaces, addresses, gateways, and DNS servers. |

## Security Scan

Look for common, verifiable security weaknesses: protection status, exposed services, weak authentication settings, suspicious startup entries, and recent failed logons. Findings are observations, not proof of compromise.

| Check | Platforms | Typical time | What it reads |
| --- | --- | --- | --- |
| Malware protection | Windows, Linux | ~45 s | Real-time protection, signature age, registered antivirus, and recent threats. |
| Host firewall | Windows, Linux | ~25 s | Whether the operating system firewall is enabled and how it treats inbound traffic. |
| Security update recency | Windows, Linux | ~90 s | Age of the latest installed update and locally known security updates. |
| Legacy SMBv1 | Windows, Linux | ~30 s | Whether the obsolete SMB version 1 protocol is enabled or in use. |
| Remote Desktop | Windows, Linux | ~25 s | Whether Remote Desktop is enabled and whether Network Level Authentication is required. |
| Guest and root-equivalent accounts | Windows, Linux | ~30 s | Guest accounts and extra accounts with full administrative identity. |
| Administrator group | Windows, Linux | ~30 s | Accounts that can elevate to administrator or root. |
| Password and lockout policy | Windows, Linux | ~25 s | Minimum length, maximum age, and account lockout thresholds. |
| Disk encryption | Windows, Linux | ~30 s | Whether the system volume is protected by BitLocker or LUKS. |
| Listening network ports | Windows, Linux | ~30 s | Services accepting network connections and potentially risky exposed ports. |
| Startup and scheduled items | Windows, Linux | ~45 s | Programs, scripts, and services that start automatically, with suspicious path checks. |
| Recent failed logons | Windows, Linux | ~45 s | Repeated authentication failures in the last 24 hours. |
| Security exclusions and sudo rules | Windows, Linux | ~30 s | Defender exclusions (Windows) or passwordless sudo rules (Linux) that weaken protection. |
| DNS configuration | Windows, Linux | ~20 s | DNS servers in use and whether a local resolver is active. |
| SSH server configuration | Linux | ~25 s | Root login, password authentication, and empty-password settings. |

## Notes

- Timings are upper bounds. A check finishes as soon as the operating system answers.
- The Security Scan is an observation tool, not an antivirus engine and not proof of compromise.
- Update checks read cached metadata only. They never contact update servers.
- SSH configuration checks apply to Linux only and inspect `sshd_config` plus drop-ins.
