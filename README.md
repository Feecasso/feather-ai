# Feather AI

Feather AI is an offline cybersecurity and IT repair toolkit for Windows and Linux.
It opens in its own window with a classic Windows 95/98 interface, reads local
system information, explains what it finds, and changes the computer only after
you approve a specific repair.

- **No installation.** The packaged builds include their own runtime.
- **No internet.** No telemetry, no cloud accounts, no remote lookups.
- **No terminal.** The application starts directly from its executable.
- **Evidence first.** Every result shows the observed data, an explanation, and a
  suggested next step. Warnings are conditions, not proof of compromise.
- **Explicit repairs.** Each repair requires a separate confirmation and a
  single-use approval inside the app. Administrator rights are requested through
  the operating system only when the approved repair needs them.

## Download and launch

Prebuilt packages are attached to the
[GitHub releases](https://github.com/Feecasso/feather-ai/releases) page. The
build workflow produces the Windows and Linux packages on their native runners,
so no build tools are needed on the computer that uses Feather AI.

### Windows 10 and 11 (x64)

1. Copy the `FeatherAI-Windows-x64` folder (or the portable `.exe`) to the USB
   drive.
2. Double-click **`Feather AI.exe`**. The feather "F" icon marks the file.
3. Windows may show a SmartScreen notice for an unsigned build. Choose
   **More info → Run anyway** only if you trust the copy you are running.

The portable executable keeps its `reports` folder next to the executable when
the location is writable. If it is not writable (for example, a read-only USB
stick), reports go to `Documents\Feather AI Reports`.

### Linux (x64)

1. Copy **`FeatherAI-1.0.0-Linux-x64.AppImage`** to the USB drive.
2. Make it executable once:

   ```bash
   chmod +x FeatherAI-1.0.0-Linux-x64.AppImage
   ```

   Or right-click the file → **Properties → Permissions → Allow executing file
   as a program**.
3. Double-click the AppImage.

If your distribution blocks AppImage/FUSE, use the `.tar.gz` build instead:

```bash
tar -xzf FeatherAI-1.0.0-Linux-x64.tar.gz
cd FeatherAI-1.0.0-Linux-x64
chmod +x feather-ai
./feather-ai
```

The `chmod +x` step is required after copying to a FAT/exFAT USB drive because
those filesystems do not preserve Unix permission bits. See
[docs/OS-SUPPORT.md](docs/OS-SUPPORT.md) for details.

## What it does

| Tool | What it does |
| --- | --- |
| **System Check** | Operating system, uptime, CPU and memory, disk space, time sync, privileges, pending restart, failed services, battery, Secure Boot, startup items, network adapters. |
| **Security Scan** | Malware protection, firewall, patch recency, SMBv1, Remote Desktop, guest/root accounts, administrator group, password policy, disk encryption, listening ports, autoruns, failed logons, security exclusions, DNS, SSH (Linux). |
| **Repair Tools** | Low-risk cleanups (DNS cache, temporary files, icon cache, print queue, audio) and approval-gated repairs (network stack, Windows Update cache, SFC, DISM, restore point, and Linux service/package maintenance). |
| **Reports** | Local HTML or text reports with results, evidence, repair actions, and an audit trail. |

Every check and repair is documented in:

- [docs/CHECKS.md](docs/CHECKS.md)
- [docs/REPAIRS.md](docs/REPAIRS.md)
- [docs/OS-SUPPORT.md](docs/OS-SUPPORT.md)

## Administrator rights

Feather AI starts as a normal user. Read-only checks never elevate silently: if a
check cannot read a protected source, it says so instead of guessing.

When you approve a repair that needs administrator rights:

- **Windows** shows the standard User Account Control prompt.
- **Linux** uses PolicyKit (`pkexec`) or, when PolicyKit is unavailable,
  passwordless `sudo`. If neither is available, the repair is refused with an
  explanation. The main window does not restart as root.

## Build from source

Requirements for building (not for normal use): Node.js 20 or newer and npm.

```bash
npm install
npm test
npm start
```

Create packaged builds:

```bash
npm run dist:linux   # AppImage + tar.gz
npm run dist:win     # portable .exe + zip folder
npm run dist         # both, where the host supports it
npm run usb:linux    # stage a USB folder under usb/
npm run usb:win      # stage a USB folder under usb/
```

Windows builds are produced with electron-builder. Building Windows artifacts on
Linux may require Wine for executable resource editing; the release workflow runs
on Windows and Linux runners instead.

## Privacy and limitations

- Feather AI does not connect to the internet. Reports and the audit log stay in
  the local `reports` folder.
- Reports can contain computer names, usernames, and configuration details. Store
  them appropriately.
- Feather AI is a diagnostic and repair aid, not an antivirus engine and not a
  substitute for professional incident response. It ships no malware signatures.
- A warning means a measured condition deserves review. It is not proof that the
  computer is compromised.

## License

MIT. See [LICENSE](LICENSE).
