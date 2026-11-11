#!/usr/bin/env node
'use strict';

/**
 * Stage a USB-ready folder from a packaged build.
 *
 *   node scripts/make_usb.js win
 *   node scripts/make_usb.js linux
 *   node scripts/make_usb.js all
 *
 * The staged folder contains the visible executable, README.txt, LICENSE.txt,
 * docs/, and an empty reports/ folder. Nothing is uploaded anywhere.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const release = path.join(root, 'release');
const usbRoot = path.join(root, 'usb');
const version = require(path.join(root, 'package.json')).version;

function log(message) {
  console.log(`usb: ${message}`);
}

function exists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function freshDir(target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
}

function copyFileIfPresent(from, to) {
  if (!exists(from)) return false;
  fs.copyFileSync(from, to);
  return true;
}

function copyOptionalDir(from, to) {
  if (!exists(from)) return;
  fs.cpSync(from, to, { recursive: true });
}

function commonFiles(target) {
  copyFileIfPresent(path.join(root, 'README.txt'), path.join(target, 'README.txt'));
  copyFileIfPresent(path.join(root, 'LICENSE'), path.join(target, 'LICENSE.txt'));
  copyOptionalDir(path.join(root, 'docs'), path.join(target, 'docs'));
  const reports = path.join(target, 'reports');
  fs.mkdirSync(reports, { recursive: true });
  fs.writeFileSync(
    path.join(reports, 'README.txt'),
    'Feather AI writes reports and the audit log here when the folder is writable.\n'
  );
}

function win() {
  const source = path.join(release, 'win-unpacked');
  if (!exists(source)) {
    log('release/win-unpacked not found. Run "npm run dist:win" first.');
    return false;
  }
  const target = path.join(usbRoot, `FeatherAI-Windows-x64`);
  freshDir(target);
  fs.cpSync(source, target, { recursive: true });
  commonFiles(target);

  const exe = path.join(target, 'Feather AI.exe');
  if (!exists(exe)) {
    log('warning: "Feather AI.exe" was not found in the packaged output.');
  }
  // Put the single-file portable build beside the folder as well.
  const portable = fs
    .readdirSync(release)
    .find((name) => /^FeatherAI-.*Windows-.*-portable\.exe$/i.test(name));
  if (portable) {
    fs.copyFileSync(path.join(release, portable), path.join(usbRoot, 'Feather AI (portable).exe'));
    log(`copied ${portable} to usb/Feather AI (portable).exe`);
  }
  log(`staged ${path.relative(root, target)}`);
  return true;
}

function linux() {
  const target = path.join(usbRoot, 'FeatherAI-Linux-x64');
  const unpacked = path.join(release, 'linux-unpacked');
  if (exists(unpacked)) {
    freshDir(target);
    fs.cpSync(unpacked, target, { recursive: true });
    commonFiles(target);
    const binary = path.join(target, 'feather-ai');
    if (exists(binary)) {
      try {
        fs.chmodSync(binary, 0o755);
      } catch {
        /* best effort */
      }
    }
    // A copy with the product name is easier to spot on a USB drive. It is a
    // hard link when the filesystem supports it, otherwise a small shell shim.
    const visible = path.join(target, 'Feather AI');
    if (exists(binary) && !exists(visible)) {
      try {
        fs.linkSync(binary, visible);
      } catch {
        fs.writeFileSync(visible, '#!/bin/sh\nexec "$(dirname "$0")/feather-ai" "$@"\n', { mode: 0o755 });
      }
    }
    log(`staged ${path.relative(root, target)}`);
  } else {
    log('release/linux-unpacked not found. Run "npm run dist:linux" first.');
    return false;
  }

  const appimage = fs.readdirSync(release).find((name) => /^FeatherAI-.*Linux-.*\.AppImage$/i.test(name));
  if (appimage) {
    const dest = path.join(usbRoot, `Feather AI ${version}.AppImage`);
    fs.copyFileSync(path.join(release, appimage), dest);
    try {
      fs.chmodSync(dest, 0o755);
    } catch {
      /* best effort */
    }
    log(`copied ${appimage} to usb/Feather AI ${version}.AppImage`);
  }
  return true;
}

const which = (process.argv[2] || 'all').toLowerCase();
let ok = true;
if (which === 'win' || which === 'windows' || which === 'all') ok = win() && ok;
if (which === 'linux' || which === 'all') ok = linux() && ok;
if (!['win', 'windows', 'linux', 'all'].includes(which)) {
  console.error('Usage: node scripts/make_usb.js [win|linux|all]');
  process.exit(2);
}
// Keep the drive root self-describing: a visible README, the license, the full
// documentation, and a reports folder next to the platform folders.
fs.mkdirSync(usbRoot, { recursive: true });
commonFiles(usbRoot);
log('added README.txt, LICENSE.txt, docs/, and reports/ to the USB root');
process.exit(ok ? 0 : 1);
