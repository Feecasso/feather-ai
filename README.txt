FEATHER AI 1.0.0
===============

Offline cybersecurity and IT repair toolkit for Windows and Linux.

QUICK START (Windows 10/11, 64-bit)
-----------------------------------
Double-click:  Feather AI.exe

No installation, no internet connection, and no Python or Node.js are required.
Windows may show a SmartScreen notice because this build is not code-signed.
Choose "More info" then "Run anyway" only if you trust this copy.

QUICK START (Linux, 64-bit)
---------------------------
AppImage:
  1. chmod +x FeatherAI-1.0.0-Linux-x64.AppImage
  2. Double-click the AppImage, or run it from your file manager.

Unpacked build:
  chmod +x feather-ai
  ./feather-ai

The "chmod +x" step is required on FAT32/exFAT USB drives because those
filesystems do not keep Unix execute permissions.

WHAT IT DOES
------------
- System Check: operating system, memory, disk, time, services, hardware.
- Security Scan: protection status, firewall, updates, accounts, open ports.
- Repair Tools: cleanups and repairs. Every repair needs separate approval.
- Reports: local HTML or text reports saved where you choose.

Administrator rights are requested through the normal Windows UAC prompt or the
Linux PolicyKit dialog, and only for a repair you approved. The main window is
never restarted as administrator.

PRIVACY
-------
Feather AI makes no network requests and sends no telemetry. Reports can contain
computer names, usernames, and configuration details. Store them appropriately.

LIMITATIONS
-----------
Feather AI is a diagnostic and repair aid. It ships no antivirus signatures and
is not a substitute for professional incident response. A warning is an observed
condition, not proof that the computer is compromised.

SUPPORTED SYSTEMS
-----------------
Windows 11 x64 and Windows 10 x64 (1809 or newer).
Modern x64 Linux desktops (Ubuntu 22.04+, Debian 12+, Fedora 38+, Arch/Omarchy).
Windows 7/8/8.1 and 32-bit systems are not supported.

Version 1.0.0 - MIT License - https://github.com/Feecasso/feather-ai
