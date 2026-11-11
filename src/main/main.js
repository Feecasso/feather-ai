'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, screen } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { tools, toolMap, allRepairs } = require('../shared/catalog');
const platform = process.platform === 'win32' ? require('./platform/windows') : require('./platform/linux');
const { CheckRunner } = require('./runner');
const { ApprovalStore } = require('./approval');
const { createAudit } = require('./audit');
const { reportsDir, settingsDir, docsRoot, getPortableRoot } = require('./paths');
const { loadSettings, saveSettings } = require('./settings');
const { buildReport, buildTextReport, reportFilename, isInsideDirectory, formatDate } = require('./reports');

app.disableHardwareAcceleration();
app.setAppUserModelId('org.feecasso.featherai');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  bootstrap();
}

let win = null;
let settings = null;
let audit = null;
let runner = null;
let systemInfoCache = null;
let repairAvailability = {};
const approvalStore = new ApprovalStore({ ttlMs: 120000 });
const lastRuns = new Map();
const repairHistory = [];
const knownReportPaths = new Set();
let busy = false;
let activeRun = null;
let consoleWindow = null;

function bootstrap() {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    settings = loadSettings();
    audit = createAudit();
    runner = new CheckRunner({ platform, onEvent: sendEvent, audit });
    repairAvailability = await platform.getRepairAvailability();
    registerIpc();
    Menu.setApplicationMenu(null);
    createWindow();
    audit('app-start', `Feather AI ${app.getVersion()} on ${process.platform}; portable root ${getPortableRoot()}`);
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

function createWindow() {
  const saved = settings.window || {};
  const width = Math.max(880, Number(saved.width) || 1000);
  const height = Math.max(620, Number(saved.height) || 700);
  const options = {
    width,
    height,
    minWidth: 880,
    minHeight: 620,
    show: false,
    frame: false,
    resizable: true,
    maximizable: true,
    minimizable: true,
    backgroundColor: '#c0c0c0',
    title: 'Feather AI',
    icon: path.join(__dirname, '../../assets/feather-ai-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  };
  if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const displays = screen.getAllDisplays();
    const visible = displays.some((d) => {
      const b = d.workArea;
      return saved.x >= b.x - 50 && saved.y >= b.y - 50 && saved.x < b.x + b.width - 100 && saved.y < b.y + b.height - 100;
    });
    if (visible) {
      options.x = saved.x;
      options.y = saved.y;
    }
  }

  win = new BrowserWindow(options);
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  win.once('ready-to-show', () => {
    if (saved.maximized) win.maximize();
    win.show();
  });

  win.on('maximize', () => sendEvent({ type: 'window:maximized', maximized: true }));
  win.on('unmaximize', () => sendEvent({ type: 'window:maximized', maximized: false }));
  win.on('resize', saveWindowSettings);
  win.on('move', saveWindowSettings);
  win.on('close', saveWindowSettings);
  win.webContents.on('did-finish-load', () => {
    sendEvent({ type: 'window:maximized', maximized: win?.isMaximized() === true });
    if (process.argv.includes('--smoke-test')) runSmokeTest();
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  win.on('closed', () => {
    win = null;
  });
}

let saveTimer = null;
function saveWindowSettings() {
  if (!win || !settings) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const bounds = win.getBounds();
      settings.window = { ...bounds, maximized: win.isMaximized() };
      saveSettings(settings);
    } catch {
      /* window may be closing */
    }
  }, 400);
}

function sendEvent(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('feather:event', payload);
}

async function getSystemInfo(force = false) {
  if (!systemInfoCache || force) {
    systemInfoCache = await platform
      .getSystemInfo()
      .catch((error) => ({
        computerName: 'Unknown',
        osName: process.platform === 'win32' ? 'Windows' : 'Linux',
        osDetail: 'System information unavailable',
        admin: false,
        elevation: process.platform === 'win32' ? 'uac' : 'none',
        mode: 'Offline - local only',
        user: 'unknown',
        inAdminGroup: false,
        error: error.message
      }));
  }
  return systemInfoCache;
}

function filteredCatalog() {
  return tools.map((tool) => ({
    ...tool,
    checks: (tool.checks || []).filter((c) => c.platforms.includes(platform.platform)),
    repairs: (tool.repairs || [])
      .filter((r) => r.platforms.includes(platform.platform))
      .map((r) => ({
        ...r,
        available: repairAvailability[r.id] ? repairAvailability[r.id].available : true,
        unavailableReason: repairAvailability[r.id] ? repairAvailability[r.id].reason : ''
      }))
  }));
}

async function listReports() {
  const dir = reportsDir();
  const entries = [];
  let names = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return entries;
  }
  for (const name of names) {
    if (!/\.(html|txt)$/i.test(name)) continue;
    const full = path.join(dir, name);
    try {
      const stat = await fsp.stat(full);
      if (!stat.isFile()) continue;
      knownReportPaths.add(full);
      entries.push({ name, path: full, size: stat.size, modified: stat.mtime.toISOString() });
    } catch {
      /* skip unreadable files */
    }
  }
  return entries.sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

function latestRun() {
  let latest = null;
  for (const run of lastRuns.values()) {
    if (!latest || new Date(run.finishedAt) > new Date(latest.finishedAt)) latest = run;
  }
  return latest;
}

function validateRepair(repairId) {
  const repair = allRepairs.find((r) => r.id === repairId && r.platforms.includes(platform.platform));
  if (!repair) throw new Error('Unknown repair action.');
  const availability = repairAvailability[repair.id];
  if (availability && !availability.available) throw new Error(availability.reason || 'This repair is not available on this system.');
  return repair;
}

function registerIpc() {
  ipcMain.handle('app:bootstrap', async () => {
    const systemInfo = await getSystemInfo();
    const reports = await listReports();
    return {
      platform: platform.platform,
      version: app.getVersion(),
      catalog: filteredCatalog(),
      systemInfo,
      reports,
      repairHistory,
      lastRuns: Object.fromEntries([...lastRuns.entries()]),
      reportsDir: reportsDir(),
      settingsDir: settingsDir(),
      portableRoot: getPortableRoot(),
      docsDir: docsRoot(),
      isPackaged: app.isPackaged
    };
  });

  ipcMain.handle('app:refreshSystem', async () => {
    systemInfoCache = null;
    repairAvailability = await platform.getRepairAvailability();
    return { systemInfo: await getSystemInfo(true), catalog: filteredCatalog(), reports: await listReports() };
  });

  ipcMain.handle('checks:run', async (_event, payload = {}) => {
    if (busy) throw new Error('Another operation is already running.');
    if (typeof payload.tool !== 'string' || !Array.isArray(payload.checkIds)) throw new Error('Invalid check request.');
    if (payload.checkIds.length > 40 || payload.checkIds.some((id) => typeof id !== 'string')) throw new Error('Invalid check list.');
    busy = true;
    const controller = new AbortController();
    activeRun = { kind: 'checks', controller };
    try {
      const run = await runner.run({ tool: payload.tool, checkIds: payload.checkIds, signal: controller.signal });
      lastRuns.set(payload.tool, run);
      return { ok: true, run };
    } finally {
      busy = false;
      activeRun = null;
    }
  });

  ipcMain.handle('app:cancel', async () => {
    if (!activeRun) return { ok: false, message: 'No operation is running.' };
    activeRun.controller.abort();
    audit('cancel-requested', `${activeRun.kind} cancellation requested by the user`);
    return { ok: true, message: 'Cancellation requested.' };
  });

  ipcMain.handle('repairs:approve', async (_event, payload = {}) => {
    if (busy) throw new Error('Another operation is already running.');
    const repair = validateRepair(payload.repairId);
    const approval = approvalStore.approve(repair.id, { name: repair.name });
    audit('repair-approved', `${repair.name} (${repair.risk} risk); approval expires in 2 minutes`);
    return { ...approval, repair: { id: repair.id, name: repair.name, risk: repair.risk } };
  });

  ipcMain.handle('repairs:run', async (_event, payload = {}) => {
    if (busy) throw new Error('Another operation is already running.');
    const repair = validateRepair(payload.repairId);
    approvalStore.consume(payload.token, repair.id);
    busy = true;
    const controller = new AbortController();
    activeRun = { kind: 'repair', controller };
    const startedAt = new Date().toISOString();
    sendEvent({ type: 'repair:start', repair, startedAt });
    audit('repair-start', `${repair.name}; administrator required: ${repair.admin}; risk ${repair.risk}`);
    let result;
    try {
      result = await platform.runRepair(repair, { signal: controller.signal });
    } catch (error) {
      result = { ok: false, summary: 'The repair stopped with an error.', details: error.message || String(error) };
    }
    const record = {
      repairId: repair.id,
      name: repair.name,
      risk: repair.risk,
      admin: repair.admin,
      startedAt,
      finishedAt: new Date().toISOString(),
      outcome: controller.signal.aborted ? 'cancelled' : result.ok ? 'success' : 'failed',
      summary: result.summary || '',
      details: result.details || '',
      rollback: result.rollback || '',
      cancelled: controller.signal.aborted
    };
    repairHistory.push(record);
    if (repairHistory.length > 100) repairHistory.shift();
    audit('repair-finish', `${repair.name}: ${record.outcome} - ${record.summary}`);
    sendEvent({ type: 'repair:done', record });
    busy = false;
    activeRun = null;
    return { ok: result.ok, record };
  });

  ipcMain.handle('reports:save', async (_event, payload = {}) => {
    const format = payload.format === 'txt' ? 'txt' : 'html';
    const run = payload.tool && lastRuns.get(payload.tool) ? lastRuns.get(payload.tool) : latestRun();
    if (!run) throw new Error('Run a check or scan before saving a report.');
    const tool = toolMap[run.tool] || { title: 'Report' };
    const systemInfo = await getSystemInfo();
    const filename = `${reportFilename(tool)}.${format}`;
    const baseDir = settings.lastSaveDir && fs.existsSync(settings.lastSaveDir) ? settings.lastSaveDir : reportsDir();
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Feather AI Report',
      defaultPath: path.join(baseDir, filename),
      filters:
        format === 'txt'
          ? [{ name: 'Text report', extensions: ['txt'] }]
          : [{ name: 'HTML report', extensions: ['html'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    let target = result.filePath;
    if (!path.extname(target)) target += `.${format}`;
    const reportHtml =
      format === 'txt'
        ? buildTextReport({ tool, run, repairs: repairHistory, systemInfo, version: app.getVersion(), generatedAt: new Date().toISOString() })
        : buildReport({
            tool,
            run,
            repairs: repairHistory,
            systemInfo,
            version: app.getVersion(),
            generatedAt: new Date().toISOString(),
            audit: audit.recent(200)
          });
    await fsp.writeFile(target, reportHtml, { encoding: 'utf8', mode: 0o644 });
    knownReportPaths.add(target);
    settings.lastSaveDir = path.dirname(target);
    saveSettings(settings);
    audit('report-saved', path.basename(target));
    return { ok: true, path: target, name: path.basename(target), reports: await listReports() };
  });

  ipcMain.handle('reports:list', async () => listReports());

  ipcMain.handle('reports:open', async (_event, filePath) => {
    if (!isKnownReport(filePath)) throw new Error('Only reports created or listed by Feather AI can be opened here.');
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
    return { ok: true };
  });

  ipcMain.handle('reports:reveal', async (_event, filePath) => {
    if (!isKnownReport(filePath)) throw new Error('Only reports created or listed by Feather AI can be shown here.');
    shell.showItemInFolder(filePath);
    return { ok: true };
  });

  ipcMain.handle('reports:delete', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !isInsideDirectory(reportsDir(), filePath)) {
      throw new Error('Only reports in the Feather AI reports folder can be deleted from this screen.');
    }
    if (!/\.(html|txt)$/i.test(filePath)) throw new Error('Only report files can be deleted.');
    await fsp.unlink(filePath);
    knownReportPaths.delete(filePath);
    audit('report-deleted', path.basename(filePath));
    return { ok: true, reports: await listReports() };
  });

  ipcMain.handle('app:openReportsFolder', async () => {
    const error = await shell.openPath(reportsDir());
    if (error) throw new Error(error);
    return { ok: true };
  });

  ipcMain.handle('app:openDocs', async () => {
    const target = path.join(docsRoot(), 'README-HANDOFF.md');
    const fallback = path.join(getPortableRoot(), 'README.txt');
    const file = fs.existsSync(target) ? target : fallback;
    const error = await shell.openPath(file);
    if (error) throw new Error(error);
    return { ok: true };
  });

  ipcMain.handle('window:minimize', () => win?.minimize());
  ipcMain.handle('window:toggleMaximize', () => {
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle('window:close', () => win?.close());
  ipcMain.handle('window:getBounds', () => (win ? win.getBounds() : null));
  ipcMain.handle('window:setBounds', (_event, bounds = {}) => {
    if (!win || win.isMaximized()) return null;
    const current = win.getBounds();
    const width = Math.max(880, Math.min(4000, Number(bounds.width) || current.width));
    const height = Math.max(620, Math.min(3000, Number(bounds.height) || current.height));
    const x = Number.isFinite(Number(bounds.x)) ? Number(bounds.x) : current.x;
    const y = Number.isFinite(Number(bounds.y)) ? Number(bounds.y) : current.y;
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }, false);
    return win.getBounds();
  });
}

function isKnownReport(filePath) {
  if (typeof filePath !== 'string') return false;
  const resolved = path.resolve(filePath);
  if (!/\.(html|txt)$/i.test(resolved)) return false;
  if (knownReportPaths.has(resolved)) return true;
  if (isInsideDirectory(reportsDir(), resolved) && fs.existsSync(resolved)) {
    knownReportPaths.add(resolved);
    return true;
  }
  return false;
}

function runSmokeTest() {
  const target = path.join(__dirname, '../../smoke.png');
  const delay = Number(process.env.FEATHER_SMOKE_DELAY_MS) > 0 ? Number(process.env.FEATHER_SMOKE_DELAY_MS) : 2500;
  const requested = String(process.env.FEATHER_SMOKE_SIZE || '').match(/^(\d{3,4})x(\d{3,4})$/);
  setTimeout(async () => {
    try {
      if (!win) throw new Error('The application window was closed before the smoke capture.');
      if (requested) {
        win.unmaximize();
        win.setContentSize(Number(requested[1]), Number(requested[2]));
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const image = await win.webContents.capturePage();
      fs.writeFileSync(target, image.toPNG());
      const metrics = await win.webContents.executeJavaScript(`(() => {
        const pick = (selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 60) };
        };
        return {
          viewport: { w: window.innerWidth, h: window.innerHeight },
          titlebar: pick('#titlebar'),
          nav: pick('#nav'),
          toolContent: pick('#tool-content'),
          actionRow: pick('.action-row'),
          start: pick('#btn-start'),
          cancel: pick('#btn-cancel'),
          save: pick('#btn-save'),
          progress: pick('#progress-area'),
          results: pick('#results-wrap'),
          detail: pick('#detail-pane'),
          statusbar: pick('.statusbar')
        };
      })()`);
      console.log(`SMOKE_LAYOUT ${JSON.stringify(metrics)}`);
      console.log(`SMOKE_SCREENSHOT ${target}`);
      audit('smoke-test', 'UI rendered and screenshot captured');
    } catch (error) {
      console.error('SMOKE_ERROR', error.message);
    } finally {
      app.quit();
    }
  }, delay);
}
