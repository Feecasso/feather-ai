'use strict';

/* global feather */

const ICONS = {
  system: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="14" height="10" fill="#fff" stroke="#000"/><rect x="2" y="2" width="12" height="7" fill="#d4d0c8" stroke="#808080"/><path d="M5 12h6v2H5z" fill="#808080" stroke="#000"/><path d="M4 6l2 2 4-4" fill="none" stroke="#008000" stroke-width="2"/></svg>`,
  security: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1l6 2v5c0 3.5-2.6 6.2-6 7-3.4-.8-6-3.5-6-7V3z" fill="#fff" stroke="#000"/><path d="M8 3l4 1.4v3.4C12 10.4 10.2 12.3 8 13c-2.2-.7-4-2.6-4-5.2V4.4z" fill="#000080"/><path d="M6 8l1.5 1.5L10.5 6" fill="none" stroke="#fff" stroke-width="1.4"/></svg>`,
  repair: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 1.5a3.8 3.8 0 00-3.4 5.6L1.4 11.8l2.8 2.8 4.7-4.7a3.8 3.8 0 005.6-3.4l-2.3 2.3-2.1-2.1z" fill="#d4d0c8" stroke="#000"/><path d="M2 13l1 1" stroke="#000"/></svg>`,
  reports: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1h7l3 3v11H3z" fill="#fff" stroke="#000"/><path d="M10 1v3h3" fill="#d4d0c8" stroke="#000"/><path d="M5 6h6M5 8h6M5 10h4" stroke="#000080"/></svg>`
};

const STATUS = {
  pass: 'Pass',
  info: 'Info',
  warn: 'Warning',
  fail: 'Fail',
  error: 'Error',
  skip: 'Skipped'
};

const state = {
  platform: 'linux',
  version: '1.0.0',
  catalog: [],
  catalogMap: new Map(),
  systemInfo: {},
  reports: [],
  repairHistory: [],
  reportsDir: '',
  selections: new Map(),
  runs: new Map(),
  selected: new Map(),
  currentTool: 'system',
  running: false,
  runningKind: null,
  runningTool: null,
  liveResults: [],
  progress: { percent: 0, indeterminate: false },
  maximized: false,
  lastReportPath: null
};

const $ = (selector) => document.querySelector(selector);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function toolDefinition(id = state.currentTool) {
  return state.catalogMap.get(id);
}

function toolChecks(id = state.currentTool) {
  const tool = toolDefinition(id);
  return tool?.checks || [];
}

function toolRepairs(id = state.currentTool) {
  const tool = toolDefinition(id);
  return tool?.repairs || [];
}

function selectionFor(toolId) {
  if (!state.selections.has(toolId)) state.selections.set(toolId, new Set());
  return state.selections.get(toolId);
}

function hasAnyRun() {
  return state.runs.size > 0;
}

function currentRun() {
  return state.runs.get(state.currentTool) || null;
}

function currentResults() {
  if (state.currentTool === 'repair') return repairResults();
  if (state.running && state.runningTool === state.currentTool) return state.liveResults;
  return currentRun()?.results || [];
}

function repairResults() {
  return state.repairHistory
    .slice()
    .reverse()
    .map((record, index) => {
      const status = record.outcome === 'success' ? 'pass' : record.outcome === 'cancelled' ? 'skip' : 'fail';
      return {
        id: `repair-${index}-${record.startedAt}`,
        name: record.name,
        status,
        finding: record.summary || record.outcome,
        evidence: [record.details, record.rollback ? `Rollback: ${record.rollback}` : ''].filter(Boolean).join('\n\n') || 'No extra detail was returned.',
        explanation:
          'This repair ran only after a separate approval in the main process. The approval token was single-use and expired after two minutes. Administrator rights, when required, were requested by the operating system.',
        nextStep: record.rollback || 'No automatic rollback is available for this action.',
        durationMs: Math.max(0, new Date(record.finishedAt).getTime() - new Date(record.startedAt).getTime()),
        measuredAt: record.finishedAt,
        risk: record.risk
      };
    });
}

function timeoutLabel(ms) {
  if (!ms) return '';
  if (ms >= 60000) return `up to ${Math.round(ms / 60000)} min`;
  return `~${Math.max(5, Math.round(ms / 1000))} s`;
}

function sizeLabel(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function setStatus(message) {
  $('#status-main').textContent = message;
  $('#status-main').title = message;
}

function setReportStatus(filePath) {
  const cell = $('#status-report');
  const text = filePath ? `Report: ${filePath}` : 'Report: not saved';
  cell.textContent = text;
  cell.title = filePath || 'No report has been saved in this session.';
  state.lastReportPath = filePath || null;
}

function setActionNote(message) {
  const node = $('#action-note');
  node.textContent = message || '';
  node.title = message || '';
}

/* ---------------- Bootstrap ---------------- */

async function init() {
  buildMenus();
  bindStaticControls();
  setProgress(null, 'Loading local system information...', '');
  try {
    const data = await feather.bootstrap();
    state.platform = data.platform;
    state.version = data.version;
    state.catalog = data.catalog;
    state.catalogMap = new Map(data.catalog.map((tool) => [tool.id, tool]));
    state.systemInfo = data.systemInfo;
    state.reports = data.reports;
    state.repairHistory = data.repairHistory || [];
    state.reportsDir = data.reportsDir;
    for (const tool of data.catalog) {
      if (!state.selections.has(tool.id)) state.selections.set(tool.id, new Set());
    }
    for (const [toolId, run] of Object.entries(data.lastRuns || {})) {
      state.runs.set(toolId, run);
    }
    $('#status-version').textContent = `Feather AI ${state.version}`;
    $('#status-version').title = `Feather AI ${state.version} — offline toolkit`;
    renderInfoStrip();
    renderAll();
    setStatus('Ready');
    setReportStatus(null);
    setProgress(null, 'Ready. Choose a check to begin.', '');
  } catch (error) {
    setStatus('Startup error');
    setProgress(null, 'The application could not load its local data.', '');
    openMessage('Feather AI could not start', error?.message || String(error), 'error');
  }
}

function renderInfoStrip() {
  const info = state.systemInfo || {};
  $('#info-computer').textContent = info.computerName || 'Unknown';
  $('#info-computer').title = info.computerName || '';
  $('#info-os-label').textContent = state.platform === 'win32' ? 'Windows version' : 'Linux distribution';
  $('#info-os').textContent = info.osName || (state.platform === 'win32' ? 'Windows' : 'Linux');
  $('#info-os').title = info.osDetail || info.osName || '';
  if (info.admin) {
    $('#info-admin').textContent = 'Yes (elevated)';
    $('#info-admin').title = 'Feather AI is running with administrator rights.';
  } else if (state.platform === 'win32') {
    $('#info-admin').textContent = 'No (UAC on demand)';
    $('#info-admin').title = 'Standard user. A UAC prompt is shown only when an approved repair needs elevation.';
  } else if (info.elevation === 'pkexec') {
    $('#info-admin').textContent = 'No (PolicyKit on demand)';
    $('#info-admin').title = 'Standard user. A PolicyKit password prompt is shown only when an approved repair needs elevation.';
  } else {
    $('#info-admin').textContent = 'No';
    $('#info-admin').title = 'Standard user. Some repairs may be unavailable without administrator rights.';
  }
  $('#info-offline').textContent = 'Offline — local only';
  $('#info-offline').title = 'Feather AI does not contact the internet. All checks run on this computer.';
}

/* ---------------- Menus ---------------- */

function buildMenus() {
  const bar = $('#menubar');
  clear(bar);
  const defs = [
    {
      label: 'File',
      items: [
        { label: 'Save Report...', shortcut: 'Ctrl+S', action: saveReport, enabled: () => hasAnyRun() },
        { label: 'Open Reports Folder', action: openReportsFolder },
        { separator: true },
        { label: 'Exit', action: () => feather.window.close() }
      ]
    },
    {
      label: 'Tools',
      items: [
        { label: 'System Check', action: () => selectTool('system') },
        { label: 'Security Scan', action: () => selectTool('security') },
        { label: 'Repair Tools', action: () => selectTool('repair') },
        { label: 'Reports', action: () => selectTool('reports') },
        { separator: true },
        { label: 'Refresh System Information', shortcut: 'F5', action: refreshSystem }
      ]
    },
    {
      label: 'Help',
      items: [
        { label: 'Quick Guide', action: showQuickGuide },
        { label: 'About Feather AI', action: showAbout }
      ]
    }
  ];

  for (const def of defs) {
    const item = el('div', 'menu-item');
    const button = el('button', 'menu-button', def.label);
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.setAttribute('aria-haspopup', 'true');
    const dropdown = el('div', 'menu-dropdown');
    for (const command of def.items) {
      if (command.separator) {
        dropdown.appendChild(el('div', 'menu-separator'));
        continue;
      }
      const cmd = el('button', 'menu-command');
      cmd.type = 'button';
      cmd.dataset.command = command.label;
      const label = el('span', '', command.label);
      cmd.appendChild(label);
      if (command.shortcut) cmd.appendChild(el('span', 'shortcut', command.shortcut));
      cmd.addEventListener('click', () => {
        closeMenus();
        if (cmd.disabled) return;
        Promise.resolve(command.action()).catch((error) => openMessage('Command failed', error?.message || String(error), 'error'));
      });
      dropdown.appendChild(cmd);
    }
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const wasOpen = item.classList.contains('open');
      closeMenus();
      if (!wasOpen) {
        item.classList.add('open');
        button.setAttribute('aria-expanded', 'true');
        updateMenuStates();
      }
    });
    item.appendChild(button);
    item.appendChild(dropdown);
    bar.appendChild(item);
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('#menubar')) closeMenus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenus();
      closeModal();
    }
  });
}

function updateMenuStates() {
  for (const item of document.querySelectorAll('.menu-item')) {
    for (const command of item.querySelectorAll('.menu-command')) {
      if (command.dataset.command === 'Save Report...') command.disabled = !hasAnyRun();
    }
  }
}

function closeMenus() {
  for (const item of document.querySelectorAll('.menu-item.open')) {
    item.classList.remove('open');
    item.querySelector('.menu-button')?.setAttribute('aria-expanded', 'false');
  }
}

/* ---------------- Static controls ---------------- */

function bindStaticControls() {
  $('#btn-minimize').addEventListener('click', () => feather.window.minimize());
  $('#btn-maximize').addEventListener('click', () => toggleMaximize());
  $('#btn-close').addEventListener('click', () => feather.window.close());
  $('#titlebar').addEventListener('dblclick', () => toggleMaximize());

  $('#btn-start').addEventListener('click', startSelectedChecks);
  $('#btn-cancel').addEventListener('click', requestCancel);
  $('#btn-save').addEventListener('click', saveReport);

  for (const button of document.querySelectorAll('.nav-button')) {
    button.addEventListener('click', () => {
      if (state.running) return;
      selectTool(button.dataset.tool);
    });
  }

  for (const icon of document.querySelectorAll('[data-icon]')) {
    icon.innerHTML = ICONS[icon.dataset.icon] || '';
  }

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (hasAnyRun()) saveReport();
      return;
    }
    if (event.key === 'F5') {
      event.preventDefault();
      refreshSystem();
    }
  });

  setupResizeHandles();
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-backdrop').addEventListener('click', (event) => {
    if (event.target === $('#modal-backdrop')) closeModal();
  });

  // Handle events from the main process.
  feather.on('run:start', (payload) => {
    if (payload.tool !== state.currentTool) return;
    state.running = true;
    state.runningKind = 'checks';
    state.runningTool = payload.tool;
    state.liveResults = [];
    state.selected.delete(payload.tool);
    setProgress(0, `Starting ${toolDefinition(payload.tool)?.title || 'check'}...`, '0%');
    setStatus(`Running ${toolDefinition(payload.tool)?.title || 'check'}`);
    setActionNote(`${payload.total} selected`);
    renderControls();
    renderResults();
  });

  feather.on('run:progress', (payload) => {
    if (payload.tool !== state.currentTool || !state.running) return;
    const progressText = `${payload.name} (${payload.index}/${payload.total})`;
    setProgress(payload.percent, progressText, `${payload.percent}%`);
    setStatus(progressText);
  });

  feather.on('run:result', (payload) => {
    if (payload.tool !== state.currentTool) return;
    state.liveResults.push(payload.result);
    renderResults();
  });

  feather.on('run:done', (payload) => {
    state.runs.set(payload.tool, payload.run);
    const wasRunning = state.running && state.runningKind === 'checks';
    if (state.runningTool === payload.tool) {
      state.running = false;
      state.runningKind = null;
      state.runningTool = null;
      state.liveResults = [];
    }
    const s = payload.run.summary;
    const text = payload.run.cancelled
      ? `Cancelled after ${payload.run.completed} of ${payload.run.requested} checks.`
      : `Complete: ${s.pass} pass, ${s.info} info, ${s.warn} warning${s.warn === 1 ? '' : 's'}, ${s.fail + s.error} problem${s.fail + s.error === 1 ? '' : 's'} in ${formatDuration(payload.run.durationMs)}.`;
    if (payload.tool === state.currentTool) {
      selectMostImportant(payload.run.results);
      setProgress(payload.run.cancelled ? Math.round((payload.run.completed / Math.max(1, payload.run.requested)) * 100) : 100, text, payload.run.cancelled ? 'Cancelled' : '100%');
      setStatus(payload.run.cancelled ? 'Check cancelled' : 'Check complete');
    } else if (wasRunning) {
      setStatus(`${payload.run.toolTitle} finished in the background`);
    }
    renderAll();
  });

  feather.on('repair:start', (payload) => {
    state.running = true;
    state.runningKind = 'repair';
    state.runningTool = 'repair';
    setProgress(null, `Preparing ${payload.repair.name}...${payload.repair.admin ? ' Windows may ask for administrator approval.' : ''}`, 'Activity in progress');
    setStatus(`Repair: ${payload.repair.name}`);
    renderControls();
  });

  feather.on('repair:done', (payload) => {
    const record = payload.record;
    if (!state.repairHistory.some((r) => r.startedAt === record.startedAt && r.repairId === record.repairId)) {
      state.repairHistory.push(record);
    }
    state.running = false;
    state.runningKind = null;
    state.runningTool = null;
    const ok = record.outcome === 'success';
    setProgress(100, `${record.name}: ${record.summary}`, record.outcome === 'cancelled' ? 'Cancelled' : ok ? '100%' : 'Failed');
    setStatus(ok ? 'Repair complete' : record.outcome === 'cancelled' ? 'Repair cancelled' : 'Repair failed');
    if (state.currentTool === 'repair') {
      const results = repairResults();
      state.selected.set('repair', 0);
      renderAll();
      if (!ok && !record.cancelled) {
        // Keep the explanation inside the window; the detail pane is selected.
        setStatus(`Repair failed: ${record.summary}`);
      }
    } else {
      renderAll();
    }
  });

  feather.on('window:maximized', (payload) => {
    state.maximized = Boolean(payload.maximized);
    $('#btn-maximize').textContent = state.maximized ? '\u2750' : '\u25A1';
    $('#btn-maximize').title = state.maximized ? 'Restore' : 'Maximize';
    if (state.maximized) document.body.classList.add('maximized');
    else document.body.classList.remove('maximized');
  });
}

function toggleMaximize() {
  feather.window.toggleMaximize().catch(() => {});
}

/* ---------------- Tool switching and workspace ---------------- */

function selectTool(toolId) {
  if (!state.catalogMap.has(toolId)) return;
  state.currentTool = toolId;
  closeMenus();
  renderAll();
  if (toolId === 'reports') {
    setProgress(null, 'Reports are stored locally. Use Save Report after a check.', '');
    setStatus('Ready');
  } else if (!state.running) {
    const hasRun = state.runs.has(toolId);
    setProgress(hasRun ? 100 : null, hasRun ? lastRunSummary(toolId) : toolId === 'repair' ? 'Ready. Repairs are never automatic.' : 'Ready. Choose a check to begin.', hasRun ? '100%' : '');
    setStatus('Ready');
  }
}

function lastRunSummary(toolId) {
  const run = state.runs.get(toolId);
  if (!run) return 'Ready.';
  const s = run.summary;
  return `Last run: ${s.pass} pass, ${s.info} info, ${s.warn} warning${s.warn === 1 ? '' : 's'}, ${s.fail + s.error} problem${s.fail + s.error === 1 ? '' : 's'}.`;
}

function renderAll() {
  renderNav();
  renderWorkspace();
  renderControls();
  renderResults();
  renderReportStatus();
  updateMenuStates();
}

function renderNav() {
  for (const button of document.querySelectorAll('.nav-button')) {
    const selected = button.dataset.tool === state.currentTool;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-current', selected ? 'page' : 'false');
    button.disabled = state.running && button.dataset.tool !== state.runningTool;
  }
}

function renderWorkspace() {
  const tool = toolDefinition();
  if (!tool) return;
  $('#tool-title').textContent = tool.title;
  $('#tool-intro').textContent = tool.intro;
  const heading = $('#heading-actions');
  clear(heading);

  const content = $('#tool-content');
  clear(content);
  content.classList.remove('fill');

  if (tool.id === 'system' || tool.id === 'security') {
    const selectAll = el('button', 'text-button', 'Select all');
    selectAll.type = 'button';
    selectAll.disabled = state.running;
    selectAll.addEventListener('click', () => {
      const set = selectionFor(tool.id);
      for (const check of tool.checks) set.add(check.id);
      renderWorkspace();
      renderControls();
    });
    const clearAll = el('button', 'text-button', 'Clear');
    clearAll.type = 'button';
    clearAll.disabled = state.running;
    clearAll.addEventListener('click', () => {
      selectionFor(tool.id).clear();
      renderWorkspace();
      renderControls();
    });
    heading.appendChild(selectAll);
    heading.appendChild(clearAll);
    renderCheckList(content, tool);
  } else if (tool.id === 'repair') {
    renderRepairList(content, tool);
  } else if (tool.id === 'reports') {
    content.classList.add('fill');
    renderReports(content);
  }
}

function renderCheckList(container, tool) {
  if (!tool.checks.length) {
    container.appendChild(el('p', 'reports-empty', 'No checks are available for this platform.'));
    return;
  }
  const note = el('p', 'tool-note');
  note.textContent =
    tool.id === 'security'
      ? 'Read-only scan. A warning is an observed weakness, not proof of compromise. Some checks need administrator or journal access and will say so instead of guessing.'
      : 'Read-only checks. Nothing is changed and no files are removed.';
  container.appendChild(note);
  const selected = selectionFor(tool.id);
  for (const check of tool.checks) {
    const row = el('div', 'check-row');
    const label = el('label', 'check-label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = selected.has(check.id);
    input.dataset.check = check.id;
    input.disabled = state.running;
    input.addEventListener('change', () => {
      if (input.checked) selected.add(check.id);
      else selected.delete(check.id);
      renderControls();
    });
    label.appendChild(input);
    label.appendChild(el('span', 'checkbox-box'));
    label.appendChild(el('span', 'check-name', check.name));
    row.appendChild(label);
    row.appendChild(el('span', 'check-meta', timeoutLabel(check.timeout)));
    row.appendChild(el('div', 'check-desc', check.description));
    container.appendChild(row);
  }
}

function renderRepairList(container, tool) {
  const note = el('p', 'tool-note');
  note.textContent =
    'Repairs change this computer. Each button opens a confirmation and requires a fresh single-use approval. Administrator rights are requested only after you approve, and only when the selected action needs them.';
  container.appendChild(note);
  if (!tool.repairs.length) {
    container.appendChild(el('p', 'reports-empty', 'No repair actions are available for this platform.'));
    return;
  }
  for (const repair of tool.repairs) {
    const row = el('div', 'repair-row');
    const main = el('div', 'repair-main');
    const title = el('div', 'repair-title-line');
    title.appendChild(el('span', 'repair-name', repair.name));
    title.appendChild(el('span', `badge risk-${repair.risk.toLowerCase()}`, `${repair.risk} risk`));
    if (repair.admin) title.appendChild(el('span', 'badge requires-admin', 'Administrator'));
    if (repair.reboot) title.appendChild(el('span', 'badge', 'Restart needed'));
    main.appendChild(title);
    main.appendChild(el('p', 'repair-desc', repair.description));
    main.appendChild(el('div', 'repair-foot', `Impact: ${repair.impact}`));
    const action = el('div', 'repair-action');
    const button = el('button', 'button', 'Approve & Run...');
    button.type = 'button';
    button.disabled = Boolean(state.running) || repair.available === false;
    button.title = repair.available === false ? repair.unavailableReason : `Approve and run ${repair.name}`;
    button.addEventListener('click', () => openRepairApproval(repair));
    action.appendChild(button);
    if (repair.available === false) {
      action.appendChild(el('span', 'repair-unavailable', repair.unavailableReason || 'Not available on this system.'));
    } else if (repair.admin) {
      action.appendChild(el('span', 'repair-unavailable', 'The operating system will request approval.'));
    }
    row.appendChild(main);
    row.appendChild(action);
    container.appendChild(row);
  }
}

function renderReports(container) {
  const toolbar = el('div', 'reports-toolbar');
  const refresh = el('button', 'button', 'Refresh');
  refresh.type = 'button';
  refresh.disabled = state.running;
  refresh.addEventListener('click', refreshReports);
  const folder = el('button', 'button', 'Open Folder');
  folder.type = 'button';
  folder.addEventListener('click', openReportsFolder);
  const path = el('span', 'reports-path', state.reportsDir || 'Reports folder');
  path.title = state.reportsDir || '';
  toolbar.appendChild(refresh);
  toolbar.appendChild(folder);
  toolbar.appendChild(path);
  container.appendChild(toolbar);

  if (!state.reports.length) {
    container.appendChild(el('div', 'reports-empty', 'No reports have been saved yet. Run a check, then choose Save Report.'));
    return;
  }

  const header = el('div', 'report-row');
  header.appendChild(el('span', '', 'Name'));
  header.appendChild(el('span', '', 'Saved'));
  header.appendChild(el('span', '', 'Size'));
  header.appendChild(el('span', '', 'Actions'));
  container.appendChild(header);

  for (const report of state.reports) {
    const row = el('div', 'report-row');
    const name = el('span', 'report-name', report.name);
    name.title = report.path;
    row.appendChild(name);
    row.appendChild(el('span', '', shortDate(report.modified)));
    row.appendChild(el('span', '', sizeLabel(report.size)));
    const actions = el('div', 'report-actions');
    const open = el('button', 'button', 'Open');
    open.type = 'button';
    open.addEventListener('click', () => openReport(report.path));
    const show = el('button', 'button', 'Show');
    show.type = 'button';
    show.title = 'Show the report in its folder';
    show.addEventListener('click', () => revealReport(report.path));
    const remove = el('button', 'button', 'Delete');
    remove.type = 'button';
    remove.disabled = state.running;
    remove.addEventListener('click', () => confirmDeleteReport(report));
    actions.appendChild(open);
    actions.appendChild(show);
    actions.appendChild(remove);
    row.appendChild(actions);
    container.appendChild(row);
  }
}

function renderControls() {
  const tool = toolDefinition();
  if (!tool) return;
  const start = $('#btn-start');
  const cancel = $('#btn-cancel');
  const save = $('#btn-save');

  const checking = tool.id === 'system' || tool.id === 'security';
  start.classList.toggle('hidden', !checking);
  if (checking) {
    start.textContent = tool.action || 'Start Check';
    const count = selectionFor(tool.id).size;
    start.disabled = state.running || count === 0;
    start.title = count === 0 ? 'Select at least one check first.' : `${tool.action} (${count} selected)`;
    setActionNote(count ? `${count} of ${tool.checks.length} selected` : 'Choose a check to begin.');
  } else if (tool.id === 'repair') {
    start.classList.add('hidden');
    setActionNote('Each repair has its own approval button.');
  } else {
    start.classList.add('hidden');
    setActionNote(state.reports.length ? `${state.reports.length} report${state.reports.length === 1 ? '' : 's'} in the reports folder.` : 'No saved reports yet.');
  }

  cancel.disabled = !state.running;
  save.disabled = state.running || !hasAnyRun();
  save.title = hasAnyRun() ? 'Save the latest check results as a report' : 'Run a check before saving a report.';
  for (const button of document.querySelectorAll('.nav-button')) {
    button.disabled = state.running && button.dataset.tool !== state.runningTool;
  }
}

/* ---------------- Results ---------------- */

function renderResults() {
  const tool = toolDefinition();
  const wrap = $('#results-wrap');
  if (!tool || tool.id === 'reports') {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  const results = currentResults();
  const summary = $('#results-summary');
  const list = $('#results-list');
  const empty = $('#results-empty');
  clear(list);

  if (!results.length) {
    empty.classList.remove('hidden');
    empty.textContent =
      tool.id === 'repair'
        ? 'No repairs have been run in this session.'
        : 'No results yet. Ready. Choose a check to begin.';
    summary.textContent = 'No results';
    $('#results-title').textContent = tool.id === 'repair' ? 'Repair log' : 'Results';
    renderDetail(null);
    return;
  }

  empty.classList.add('hidden');
  const selectedIndex = state.selected.has(tool.id) ? state.selected.get(tool.id) : -1;
  if (selectedIndex >= results.length) state.selected.set(tool.id, results.length - 1);

  const counts = { pass: 0, info: 0, warn: 0, fail: 0, error: 0, skip: 0 };
  for (const result of results) counts[result.status] = (counts[result.status] || 0) + 1;
  summary.textContent = `${results.length} item${results.length === 1 ? '' : 's'} · ${counts.pass} pass · ${counts.warn} warning${counts.warn === 1 ? '' : 's'} · ${counts.fail + counts.error} problem${counts.fail + counts.error === 1 ? '' : 's'}`;
  $('#results-title').textContent = tool.id === 'repair' ? 'Repair log' : 'Results';

  results.forEach((result, index) => {
    const row = el('div', 'result-row');
    row.setAttribute('role', 'row');
    row.tabIndex = 0;
    row.dataset.index = String(index);
    if (index === selectedIndex) row.classList.add('selected');
    row.appendChild(el('span', 'result-cell result-check', result.name));
    const statusCell = el('span', 'result-cell status-cell');
    statusCell.appendChild(el('span', `status-dot ${result.status}`));
    statusCell.appendChild(el('span', 'status-label', STATUS[result.status] || result.status));
    row.appendChild(statusCell);
    row.appendChild(el('span', 'result-cell result-finding', result.finding));
    const choose = () => {
      state.selected.set(tool.id, index);
      for (const other of list.querySelectorAll('.result-row.selected')) other.classList.remove('selected');
      row.classList.add('selected');
      renderDetail(result);
    };
    row.addEventListener('click', choose);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose();
      }
    });
    list.appendChild(row);
  });

  const currentIndex = state.selected.get(tool.id);
  renderDetail(currentIndex !== undefined && currentIndex >= 0 ? results[currentIndex] : null);
}

function renderDetail(result) {
  const empty = document.querySelector('.detail-empty');
  const content = $('#detail-content');
  if (!result) {
    empty.classList.remove('hidden');
    content.hidden = true;
    return;
  }
  empty.classList.add('hidden');
  content.hidden = false;
  clear(content);

  const title = el('div', 'detail-title', `${result.name} — ${STATUS[result.status] || result.status}`);
  content.appendChild(title);

  const evidence = el('div', 'detail-section');
  evidence.appendChild(el('h3', '', 'Evidence (observed data)'));
  const pre = el('pre');
  pre.textContent = result.evidence || 'No evidence was returned.';
  evidence.appendChild(pre);
  content.appendChild(evidence);

  const explanation = el('div', 'detail-section');
  explanation.appendChild(el('h3', '', 'Explanation'));
  explanation.appendChild(el('p', '', result.explanation || ''));
  content.appendChild(explanation);

  const next = el('div', 'detail-section');
  next.appendChild(el('h3', '', 'Suggested next step'));
  next.appendChild(el('p', '', result.nextStep || ''));
  content.appendChild(next);

  if (result.measuredAt) {
    const measured = el('div', 'detail-section');
    measured.appendChild(el('p', '', `Measured: ${shortDate(result.measuredAt)}${result.durationMs ? ` · ${formatDuration(result.durationMs)}` : ''}`));
    content.appendChild(measured);
  }
}

function selectMostImportant(results) {
  if (!results.length) {
    state.selected.delete(state.currentTool);
    return;
  }
  const rank = { fail: 0, error: 0, warn: 1, info: 2, pass: 3, skip: 4 };
  let best = 0;
  results.forEach((result, index) => {
    if ((rank[result.status] ?? 9) < (rank[results[best].status] ?? 9)) best = index;
  });
  state.selected.set(state.currentTool, best);
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown time';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes} min ${seconds} s`;
}

/* ---------------- Progress ---------------- */

function setProgress(percent, text, percentLabel) {
  const track = $('#progress-bar');
  const textNode = $('#progress-text');
  const label = $('#progress-percent');
  textNode.textContent = text || '';
  textNode.title = text || '';
  label.textContent = percentLabel || '';
  track.classList.remove('indeterminate');
  track.classList.toggle('indeterminate', percent === null);
  if (percent === null) {
    track.removeAttribute('aria-valuenow');
    for (const [index, segment] of [...track.children].entries()) {
      segment.classList.toggle('filled', false);
      segment.classList.toggle('dummy', index < 0);
    }
    return;
  }
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  track.setAttribute('aria-valuenow', String(Math.round(value)));
  const filled = Math.round((value / 100) * 20);
  [...track.children].forEach((segment, index) => {
    segment.classList.toggle('filled', index < filled);
  });
}

function buildProgressSegments() {
  const track = $('#progress-bar');
  clear(track);
  for (let i = 0; i < 20; i += 1) {
    track.appendChild(el('span', 'progress-seg'));
  }
}

/* ---------------- Running checks ---------------- */

async function startSelectedChecks() {
  const tool = toolDefinition();
  if (!tool || (tool.id !== 'system' && tool.id !== 'security') || state.running) return;
  const selected = [...selectionFor(tool.id)];
  if (!selected.length) {
    setActionNote('Select at least one check.');
    return;
  }
  state.running = true;
  state.runningKind = 'checks';
  state.runningTool = tool.id;
  state.liveResults = [];
  state.selected.delete(tool.id);
  state.runs.delete(tool.id);
  setProgress(0, `Starting ${tool.title}...`, '0%');
  setStatus(`Running ${tool.title}`);
  renderControls();
  renderResults();
  try {
    const response = await feather.runChecks({ tool: tool.id, checkIds: selected });
    if (response?.run && !state.runs.has(tool.id)) {
      state.runs.set(tool.id, response.run);
      state.running = false;
      state.runningKind = null;
      state.runningTool = null;
      renderAll();
    }
  } catch (error) {
    state.running = false;
    state.runningKind = null;
    state.runningTool = null;
    state.liveResults = [];
    setProgress(null, 'The check could not run.', '');
    setStatus('Check failed to start');
    openMessage('Check could not start', error?.message || String(error), 'error');
    renderAll();
  }
}

async function requestCancel() {
  if (!state.running) return;
  const kind = state.runningKind;
  const proceed = await openConfirm({
    title: 'Cancel operation',
    message:
      kind === 'repair'
        ? 'Stopping a repair may leave changes incomplete. If an administrator helper is already running, the operating system may not let Feather AI stop it.'
        : 'The check that is currently running will be stopped. Results already collected are kept.',
    confirmLabel: 'Cancel Operation',
    cancelLabel: 'Keep Running'
  });
  if (!proceed) return;
  setStatus('Cancellation requested');
  setProgress(null, 'Cancellation requested...', 'Activity in progress');
  try {
    await feather.cancel();
  } catch (error) {
    openMessage('Cancel failed', error?.message || String(error), 'error');
  }
}

/* ---------------- Repairs ---------------- */

function openRepairApproval(repair) {
  if (state.running) return;
  const body = el('div');
  const callout = el('div', `modal-callout${repair.risk === 'High' ? ' warning' : ''}`);
  callout.appendChild(el('div', 'modal-icon', '!'));
  const intro = el('div');
  intro.appendChild(el('p', '', `You are about to run: ${repair.name}.`));
  intro.appendChild(el('p', '', 'Nothing has run yet. Review the impact and approve only if this is what you want.'));
  callout.appendChild(intro);
  body.appendChild(callout);

  const details = el('div', 'modal-details');
  const dl = el('dl');
  const add = (term, value) => {
    dl.appendChild(el('dt', '', term));
    dl.appendChild(el('dd', '', value));
  };
  add('Risk', repair.risk);
  add('Administrator', repair.admin ? 'Required (the operating system will prompt)' : 'Not required');
  add('Restart', repair.reboot ? 'Recommended or required' : 'Not required');
  add('Impact', repair.impact);
  add('Rollback', repair.id === 'create-restore-point' ? 'This creates the rollback point.' : 'No automatic rollback for this action.');
  details.appendChild(dl);
  body.appendChild(details);

  const label = el('label', 'confirm-check');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = 'repair-confirm';
  label.appendChild(checkbox);
  label.appendChild(el('span', 'checkbox-box'));
  label.appendChild(el('span', '', 'I understand this changes the computer and I want Feather AI to run it now.'));
  body.appendChild(label);

  const note = el('p', '', '');
  note.className = 'action-note';
  body.appendChild(note);

  openModal({
    title: `Approve: ${repair.name}`,
    body,
    buttons: [
      { label: 'Cancel', onClick: closeModal },
      {
        label: 'Approve and Run',
        default: true,
        onClick: async () => {
          if (!checkbox.checked) {
            note.textContent = 'Check the confirmation box before approving.';
            checkbox.focus();
            return;
          }
          closeModal();
          await executeRepair(repair);
        }
      }
    ]
  });
}

async function executeRepair(repair) {
  state.running = true;
  state.runningKind = 'repair';
  state.runningTool = 'repair';
  setProgress(null, `Requesting approval for ${repair.name}...`, 'Activity in progress');
  setStatus(`Repair: ${repair.name}`);
  renderAll();
  try {
    const approval = await feather.approveRepair({ repairId: repair.id });
    setProgress(null, repair.admin ? 'Waiting for administrator approval...' : 'Running repair...', 'Activity in progress');
    const response = await feather.runRepair({ repairId: repair.id, token: approval.token });
    if (response?.record) {
      if (!state.repairHistory.some((r) => r.startedAt === response.record.startedAt && r.repairId === response.record.repairId)) {
        state.repairHistory.push(response.record);
      }
      if (response.record.cancelled) {
        setStatus('Repair cancelled');
      } else if (response.record.outcome !== 'success') {
        setStatus(`Repair failed: ${response.record.summary}`);
      }
    }
  } catch (error) {
    state.running = false;
    state.runningKind = null;
    state.runningTool = null;
    setProgress(null, 'The repair did not start.', '');
    setStatus('Repair did not start');
    openMessage('Repair did not start', error?.message || String(error), 'error');
  } finally {
    state.running = false;
    state.runningKind = null;
    state.runningTool = null;
    renderAll();
  }
}

/* ---------------- Reports ---------------- */

async function saveReport() {
  if (!hasAnyRun()) {
    openMessage('No results to report', 'Run at least one check first. Feather AI only saves measured results.', 'info');
    return;
  }
  if (state.running) return;
  try {
    const result = await feather.saveReport({ tool: state.currentTool });
    if (!result || result.canceled || !result.ok) return;
    state.reports = result.reports || state.reports;
    setReportStatus(result.path);
    setStatus('Report saved');
    if (state.currentTool === 'reports') renderWorkspace();
    setActionNote('Report saved.');
    openMessage('Report saved', `The report was written to:\n${result.path}`, 'info', [
      { label: 'Open Folder', onClick: () => revealReport(result.path) },
      { label: 'OK', default: true, onClick: closeModal }
    ]);
  } catch (error) {
    openMessage('Report could not be saved', error?.message || String(error), 'error');
  }
}

async function refreshReports() {
  try {
    state.reports = await feather.listReports();
    renderWorkspace();
    renderControls();
    setStatus('Report list refreshed');
  } catch (error) {
    openMessage('Could not list reports', error?.message || String(error), 'error');
  }
}

async function openReportsFolder() {
  try {
    await feather.openReportsFolder();
  } catch (error) {
    openMessage('Could not open the reports folder', error?.message || String(error), 'error');
  }
}

async function openReport(filePath) {
  try {
    await feather.openReport(filePath);
  } catch (error) {
    openMessage('Could not open the report', error?.message || String(error), 'error');
  }
}

async function revealReport(filePath) {
  try {
    await feather.revealReport(filePath);
  } catch (error) {
    openMessage('Could not show the report', error?.message || String(error), 'error');
  }
}

function confirmDeleteReport(report) {
  openConfirm({
    title: 'Delete report',
    message: `Delete "${report.name}"? This removes the report file from disk and cannot be undone.`,
    confirmLabel: 'Delete Report',
    dangerous: true
  }).then(async (ok) => {
    if (!ok) return;
    try {
      const result = await feather.deleteReport(report.path);
      state.reports = result.reports || [];
      if (state.lastReportPath === report.path) setReportStatus(null);
      renderWorkspace();
      renderControls();
      setStatus('Report deleted');
    } catch (error) {
      openMessage('Report could not be deleted', error?.message || String(error), 'error');
    }
  });
}

function renderReportStatus() {
  if (!state.lastReportPath) setReportStatus(null);
  else setReportStatus(state.lastReportPath);
}

/* ---------------- System refresh ---------------- */

async function refreshSystem() {
  if (state.running) return;
  setStatus('Refreshing system information');
  try {
    const data = await feather.refreshSystem();
    state.systemInfo = data.systemInfo;
    state.catalog = data.catalog;
    state.catalogMap = new Map(data.catalog.map((tool) => [tool.id, tool]));
    state.reports = data.reports;
    for (const tool of data.catalog) {
      if (!state.selections.has(tool.id)) state.selections.set(tool.id, new Set());
    }
    renderInfoStrip();
    renderAll();
    setStatus('System information refreshed');
  } catch (error) {
    setStatus('Refresh failed');
    openMessage('Could not refresh system information', error?.message || String(error), 'error');
  }
}

/* ---------------- Modal dialogs ---------------- */

let modalCloseHandler = null;

function openModal({ title, body, buttons = [], small = false, onClose = null }) {
  const backdrop = $('#modal-backdrop');
  const modal = $('#modal');
  $('#modal-title').textContent = title;
  const bodyNode = $('#modal-body');
  clear(bodyNode);
  bodyNode.appendChild(body);
  const footer = $('#modal-footer');
  clear(footer);
  modal.classList.toggle('modal-small', Boolean(small));
  modalCloseHandler = onClose;

  for (const buttonDef of buttons) {
    const button = el('button', `button${buttonDef.default ? ' default' : ''}`, buttonDef.label);
    button.type = 'button';
    button.addEventListener('click', () => {
      Promise.resolve(buttonDef.onClick?.()).catch((error) => {
        openMessage('Command failed', error?.message || String(error), 'error');
      });
    });
    footer.appendChild(button);
  }
  backdrop.hidden = false;
  const focusTarget = footer.querySelector('.button.default') || footer.querySelector('.button');
  focusTarget?.focus();
}

function closeModal() {
  const backdrop = $('#modal-backdrop');
  if (backdrop.hidden) return;
  backdrop.hidden = true;
  const handler = modalCloseHandler;
  modalCloseHandler = null;
  if (handler) handler();
  $('#modal-body').scrollTop = 0;
}

function openMessage(title, message, kind = 'info', extraButtons = []) {
  const body = el('div');
  const callout = el('div', `modal-callout${kind === 'error' ? ' warning' : ''}`);
  callout.appendChild(el('div', 'modal-icon', kind === 'error' ? '!' : 'i'));
  const text = el('div');
  const paragraph = el('p');
  paragraph.textContent = message;
  paragraph.style.whiteSpace = 'pre-wrap';
  text.appendChild(paragraph);
  callout.appendChild(text);
  body.appendChild(callout);
  const buttons = extraButtons.length
    ? extraButtons
    : [{ label: 'OK', default: true, onClick: closeModal }];
  openModal({ title, body, buttons, small: true });
}

function openConfirm({ title, message, confirmLabel, cancelLabel = 'Cancel', dangerous = false }) {
  return new Promise((resolve) => {
    const body = el('div');
    const callout = el('div', `modal-callout${dangerous ? ' warning' : ''}`);
    callout.appendChild(el('div', 'modal-icon', dangerous ? '!' : '?'));
    const text = el('div');
    const p = el('p');
    p.textContent = message;
    p.style.whiteSpace = 'pre-wrap';
    text.appendChild(p);
    callout.appendChild(text);
    body.appendChild(callout);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(value);
    };
    openModal({
      title,
      body,
      small: true,
      onClose: () => finish(false),
      buttons: [
        { label: cancelLabel, onClick: () => finish(false) },
        { label: confirmLabel, default: true, onClick: () => finish(true) }
      ]
    });
  });
}

function showQuickGuide() {
  const body = el('div');
  const p = (text) => body.appendChild(el('p', '', text));
  p('Feather AI is an offline toolkit. It reads local information and never contacts the internet or uploads telemetry.');
  p('System Check and Security Scan are read-only. They collect the evidence shown in the Results panel and do not change settings.');
  p('Repair Tools change the computer. Every repair requires a separate confirmation in this window. The main process issues a short-lived, single-use approval token. Nothing is repaired automatically.');
  p('On Windows, repairs that need elevation show a User Account Control prompt. On Linux, they use PolicyKit (pkexec) or passwordless sudo when available. The main Feather AI window stays open.');
  p('If a check needs administrator or journal access, it says so instead of guessing. A warning is an observed condition, not proof of compromise.');
  p('Save Report writes an HTML or text file to the location you choose. The status bar shows the last saved location. Reports can contain local system information, so store them appropriately.');
  const tag = el('p');
  tag.style.marginTop = '10px';
  tag.appendChild(el('strong', '', 'Supported platforms: '));
  tag.appendChild(document.createTextNode('Windows 10/11 (x64) and mainstream Linux x64 desktops. This build is packaged with its own runtime; no Python, Node.js, or internet connection is needed.'));
  body.appendChild(tag);
  openModal({ title: 'Quick Guide', body, buttons: [{ label: 'Close', default: true, onClick: closeModal }] });
}

function showAbout() {
  const body = el('div');
  const callout = el('div', 'modal-callout');
  callout.appendChild(el('div', 'modal-icon', 'F'));
  const text = el('div');
  text.appendChild(el('p', '', `Feather AI ${state.version}`));
  text.appendChild(el('p', '', 'An offline cybersecurity and IT repair toolkit for Windows and Linux.'));
  callout.appendChild(text);
  body.appendChild(callout);
  body.appendChild(el('p', '', 'Local checks, evidence-based results, explicit repair approval, and local reports. No accounts, cloud services, or telemetry.'));
  body.appendChild(el('p', '', 'License: MIT. Feather AI is not a substitute for professional incident response or full antivirus protection.'));
  body.appendChild(el('p', '', 'The application is packaged with its runtime so it can run from a USB drive. Normal use does not require installation or an internet connection.'));
  openModal({ title: 'About Feather AI', body, buttons: [{ label: 'OK', default: true, onClick: closeModal }] });
}

/* ---------------- Window resizing ---------------- */

function setupResizeHandles() {
  let drag = null;
  let lastFrame = 0;

  for (const handle of document.querySelectorAll('[data-resize]')) {
    handle.addEventListener('pointerdown', async (event) => {
      if (state.maximized || event.button !== 0) return;
      event.preventDefault();
      const bounds = await feather.window.getBounds();
      if (!bounds) return;
      drag = {
        dir: handle.dataset.resize,
        startX: event.screenX,
        startY: event.screenY,
        bounds
      };
      handle.setPointerCapture?.(event.pointerId);
    });
  }

  window.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const now = performance.now();
    if (now - lastFrame < 16) return;
    lastFrame = now;
    const dx = event.screenX - drag.startX;
    const dy = event.screenY - drag.startY;
    const b = drag.bounds;
    let x = b.x;
    let y = b.y;
    let width = b.width;
    let height = b.height;
    if (drag.dir.includes('e')) width = b.width + dx;
    if (drag.dir.includes('s')) height = b.height + dy;
    if (drag.dir.includes('w')) {
      width = b.width - dx;
      x = b.x + dx;
    }
    if (drag.dir.includes('n')) {
      height = b.height - dy;
      y = b.y + dy;
    }
    if (width < 880) {
      if (drag.dir.includes('w')) x = b.x + b.width - 880;
      width = 880;
    }
    if (height < 620) {
      if (drag.dir.includes('n')) y = b.y + b.height - 620;
      height = 620;
    }
    feather.window.setBounds({ x, y, width, height }).catch(() => {});
  });

  window.addEventListener('pointerup', () => {
    drag = null;
  });
  window.addEventListener('blur', () => {
    drag = null;
  });
}

/* ---------------- Start ---------------- */

buildProgressSegments();
document.addEventListener('DOMContentLoaded', init);
