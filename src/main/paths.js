'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

function projectRoot() {
  return path.resolve(__dirname, '..', '..');
}

/**
 * Prefer the folder that holds the portable executable (USB root), then the
 * AppImage/executable directory, then the project folder during development.
 */
function getPortableRoot() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.env.APPIMAGE) return path.dirname(process.env.APPIMAGE);
  if (!app.isPackaged) return projectRoot();
  return path.dirname(process.execPath);
}

function isWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function reportsDir() {
  const portable = path.join(getPortableRoot(), 'reports');
  if (isWritable(portable)) return portable;
  const documents = app.getPath('documents');
  const fallback = path.join(documents, 'Feather AI Reports');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

function settingsDir() {
  const dir = path.join(app.getPath('userData'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function auditPath() {
  return path.join(reportsDir(), 'audit-log.jsonl');
}

function docsRoot() {
  if (!app.isPackaged) return path.join(projectRoot(), 'docs');
  const candidates = [
    path.join(getPortableRoot(), 'docs'),
    path.join(process.resourcesPath, 'docs'),
    path.join(app.getAppPath(), 'docs')
  ];
  return candidates.find((dir) => fs.existsSync(dir)) || candidates[candidates.length - 1];
}

module.exports = { getPortableRoot, reportsDir, settingsDir, auditPath, docsRoot, isWritable };
