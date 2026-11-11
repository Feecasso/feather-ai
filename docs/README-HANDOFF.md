# Feather AI — build and handoff notes

This file is for whoever maintains the project. End-user instructions live in
`README.md` and `README.txt`.

## Layout

```text
feather-ai/
├── src/
│   ├── main/           Electron main process, checks, repairs, reports
│   │   ├── platform/   windows.js and linux.js implementations
│   │   └── ...
│   ├── preload.js      Context-isolated IPC bridge
│   ├── renderer/       Win95-style interface (HTML/CSS/JS, no framework)
│   └── shared/         catalog.js — single source of truth for tools
├── assets/             PNG icon set used by the window
├── build/              icon.ico and Linux icon set for packaging
├── docs/               CHECKS.md, REPAIRS.md, OS-SUPPORT.md, this file
├── scripts/            icon generation, docs generation, packaging helpers
├── tests/              node:test unit tests
├── README.md           public README
├── README.txt          plain-text USB README
└── package.json        app metadata and electron-builder configuration
```

## Common commands

```bash
npm install            # development only
npm test               # unit tests, no display needed
npm start              # run the app
npm run docs           # regenerate CHECKS.md and REPAIRS.md
npm run icons          # regenerate icon PNG/ICO (needs Pillow)
npm run dist:linux     # AppImage + tar.gz in release/
npm run dist:win       # portable exe + zip in release/
npm run usb:linux      # stage usb/FeatherAI-Linux-x64
npm run usb:win        # stage usb/FeatherAI-Windows-x64
```

## Security model

- The renderer has no Node.js access (`contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`).
- All privileged work happens in the main process behind fixed IPC channels.
- Repairs require a token from `ApprovalStore`. Tokens are random, single-use,
  bound to one repair id, and expire after two minutes.
- Commands are executed with fixed executables and argument arrays. The only
  shell strings are fixed scripts in `platform/*.js`; user input never reaches a
  shell.
- Reports are escaped before being written as HTML.
- Report open/reveal/delete is limited to files that Feather AI created or listed
  inside its reports folder.
- The application makes no network requests. The renderer CSP blocks
  `connect-src`, and `will-navigate` is denied.

## Adding a check or repair

1. Add the entry to `src/shared/catalog.js` (id, name, description, platform,
   timeout; repairs also need risk, impact, admin, reboot).
2. Implement it in `src/main/platform/windows.js` and/or
   `src/main/platform/linux.js`.
3. Run `npm test`. The catalog tests fail if an implementation is missing.
4. Run `npm run docs` to update the generated tables.
5. Add a unit test for any new parser or decision rule.

## Release checklist

1. Bump the version in `package.json` and `README.txt`.
2. `npm test`
3. `npm run smoke` (captures `smoke.png` and exits).
4. `npm run dist:linux` and `npm run dist:win`.
5. `npm run usb`.
6. Verify the packaged app starts with no console window, shows the feather icon,
   and writes a report.
7. Publish `release/` artifacts and the `usb/` folder contents.
