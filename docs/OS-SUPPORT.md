# Supported operating systems and launchers

Feather AI is packaged with its own runtime (Electron). The target computer does
**not** need Python, Node.js, a developer environment, or an internet connection.

## Windows

| Supported | Notes |
| --- | --- |
| Windows 11 x64 | Fully supported. |
| Windows 10 x64 (version 1809 or newer) | Fully supported. |
| Windows 10/11 ARM64 | Not built. The x64 build can run under emulation but is not tested. |
| Windows 7 / 8 / 8.1 | Not supported. Electron 45 does not run on them. |
| Windows Server | Not tested. Some checks may return informational results. |

### Launching

Use **`Feather AI.exe`** in the `FeatherAI-Windows-x64` folder, or the portable
`FeatherAI-<version>-Windows-x64.exe`. Double-clicking opens the application
window; no console window is created because the executable is a graphical
Windows subsystem program.

The build is not code-signed. SmartScreen may show a notice the first time the
file is run from a USB drive. Verify the file hash published with the release if
you need to confirm its origin.

### Elevation

Repairs marked **Administrator** trigger the standard UAC prompt after the
in-app approval. The main window stays open. Cancelling UAC is reported inside
the app; no repair runs.

## Linux

| Supported | Notes |
| --- | --- |
| Ubuntu 22.04+ / Debian 12+ | Fully supported. |
| Fedora 38+ / RHEL 9+ | Fully supported. |
| Arch Linux / Omarchy / Manjaro | Fully supported. |
| Linux Mint / Pop!_OS | Fully supported. |
| Other modern x64 desktops with glibc 2.31+ | Expected to work; not individually tested. |
| 32-bit x86, ARM, musl-only distributions | Not built. |

### Launching

Preferred: the AppImage.

```bash
chmod +x FeatherAI-1.0.0-Linux-x64.AppImage
./FeatherAI-1.0.0-Linux-x64.AppImage
```

Or double-click the AppImage in the file manager after enabling
**Allow executing file as a program**.

Fallback: the `.tar.gz` build.

```bash
tar -xzf FeatherAI-1.0.0-Linux-x64.tar.gz
chmod +x FeatherAI-1.0.0-Linux-x64/feather-ai
./FeatherAI-1.0.0-Linux-x64/feather-ai
```

### Why `chmod +x` is required

FAT32 and exFAT, the filesystems most USB drives use, do not store Unix execute
permissions. After copying the AppImage or the unpacked folder to such a drive,
the file loses its executable bit. Run `chmod +x` once after copying, or launch
from a filesystem that supports permissions (ext4, btrfs, xfs).

Some distributions mount USB drives with `noexec`. In that case, copy the
AppImage to your home directory before running it.

### Elevation

Repairs marked **Administrator** use PolicyKit through `pkexec`, which shows the
desktop's normal graphical authentication dialog. If `pkexec` is not installed,
Feather AI tries passwordless `sudo` (a cached or NOPASSWD rule). If neither is
available, the repair is refused with a clear message. The main application never
runs as root.

If your desktop has no PolicyKit authentication agent, install one for your
desktop environment (for example `polkit-gnome`, `polkit-kde-agent`, or the agent
shipped by GNOME/KDE).

## USB layout

```text
USB drive/
├── Feather AI (portable).exe        single-file Windows build
├── FeatherAI-Windows-x64/
│   ├── Feather AI.exe               visible application executable
│   ├── README.txt
│   ├── LICENSE.txt
│   ├── docs/
│   └── reports/                     created on first use
├── Feather AI 1.0.0.AppImage        optional Linux build
└── FeatherAI-Linux-x64/
    ├── Feather AI
    ├── feather-ai
    ├── README.txt
    ├── LICENSE.txt
    ├── docs/
    └── reports/                     created on first use
```

`npm run usb` stages these folders locally from the packaged builds. The same
files are attached to the GitHub release for direct copying to a USB drive.

Reports are written next to the executable when that folder is writable.
Otherwise they go to the user's Documents folder. The status bar always shows the
last saved location.

## Offline behaviour

Feather AI never performs network requests. Checks read local files, local
service state, and local operating-system APIs. Update-recency checks use
already-cached package metadata; they do not refresh repositories.
