# Repair actions

Repairs change the computer. Nothing runs automatically. Every action requires:

1. A click on its own **Approve & Run** button.
2. A confirmation in the in-app dialog.
3. A single-use approval token issued by the main process (valid for 2 minutes).
4. The operating system approval prompt when the action needs administrator rights.

Risk levels describe the potential impact, not how likely a problem is. A
restore point or snapshot is recommended before Moderate or High actions.

Tables are generated from `src/shared/catalog.js`.

## Repair Tools

| Action | Risk | Admin | Restart | Platforms | Impact |
| --- | --- | --- | --- | --- | --- |
| Flush DNS cache | Low | No | No | Windows, Linux | Resets name resolution for new connections. Existing connections are not interrupted. |
| Clear temporary files | Low | No | No | Windows, Linux | Frees disk space. Files currently in use are skipped. Other users are not touched. |
| Rebuild icon cache | Low | No | No | Windows, Linux | Icons may briefly redraw. No documents or application data are changed. |
| Clear print queue | Low | No | No | Windows, Linux | Unfinished print jobs are discarded. Printing becomes available again afterwards. |
| Restart audio service | Low | No | No | Windows, Linux | Audio stops for a few seconds. Applications may need to reselect the audio device. |
| Flush ARP cache | Low | Yes | No | Windows, Linux | The network re-learns local addresses. Connectivity may pause for a second. |
| Restart print service | Low | Yes | No | Windows, Linux | Printing stops for a few seconds. The queue is not deleted. |
| Create restore point | Low | Yes | No | Windows, Linux | Uses disk space. No system behavior changes. |
| Renew network address | Moderate | Yes | No | Windows | Network access is interrupted for several seconds. Static configurations are not changed. |
| Reset network stack | High | Yes | Yes | Windows | All network connections drop. A restart is required. VPN and custom adapter settings may be affected. |
| Restart network service | Moderate | Yes | No | Linux | All network connections drop briefly. Remote sessions will disconnect. |
| Reset failed services | Low | Yes | No | Linux | Does not start services. It only clears failure counters and states. |
| Clear package cache | Low | Yes | No | Linux | Frees disk space. Installed software is not removed. Future installs may need to download again. |
| Verify Windows system files | Moderate | Yes | No | Windows | Can take 10 to 30 minutes. Some system files may be replaced. Do not power off during the scan. |
| Repair Windows component store | High | Yes | No | Windows | Can take 15 to 45 minutes and may change system components. Internet access can be required. |
| Reset Windows Update components | High | Yes | Yes | Windows | Windows Update history and downloaded updates are reset. Installed updates remain. Can take several minutes. |
| Scan system volume | Low | Yes | No | Windows | The system remains online. The scan can take several minutes. It does not repair by itself. |

## Notes

- **Cancel** stops an operation where the operating system allows it. An elevated helper may already be running.
- **No automatic rollback** exists for most repairs. Create a restore point or snapshot first.
- Failed and cancelled repairs are recorded in the audit log and the report.
- Repairs never run on a schedule, at startup, or without a fresh approval.
