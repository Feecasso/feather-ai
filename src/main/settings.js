'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { settingsDir } = require('./paths');

const DEFAULTS = {
  window: { width: 1000, height: 700, x: null, y: null, maximized: false },
  lastSaveDir: null
};

function loadSettings() {
  try {
    const raw = fs.readFileSync(path.join(settingsDir(), 'settings.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed, window: { ...DEFAULTS.window, ...(parsed.window || {}) } };
  } catch {
    return { ...DEFAULTS, window: { ...DEFAULTS.window } };
  }
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(path.join(settingsDir(), 'settings.json'), JSON.stringify(settings, null, 2), { mode: 0o600 });
  } catch {
    /* settings are best-effort; never block the app */
  }
}

module.exports = { loadSettings, saveSettings, DEFAULTS };
