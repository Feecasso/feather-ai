'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set([
  'run:start',
  'run:progress',
  'run:result',
  'run:done',
  'repair:start',
  'repair:progress',
  'repair:done',
  'window:maximized',
  'reports:changed',
  'status:message'
]);

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('feather', {
  platform: process.platform,
  bootstrap: () => invoke('app:bootstrap'),
  refreshSystem: () => invoke('app:refreshSystem'),
  runChecks: (payload) => invoke('checks:run', payload),
  cancel: () => invoke('app:cancel'),
  approveRepair: (payload) => invoke('repairs:approve', payload),
  runRepair: (payload) => invoke('repairs:run', payload),
  saveReport: (payload) => invoke('reports:save', payload),
  listReports: () => invoke('reports:list'),
  openReport: (filePath) => invoke('reports:open', filePath),
  revealReport: (filePath) => invoke('reports:reveal', filePath),
  deleteReport: (filePath) => invoke('reports:delete', filePath),
  openReportsFolder: () => invoke('app:openReportsFolder'),
  openDocs: () => invoke('app:openDocs'),
  window: {
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggleMaximize'),
    close: () => invoke('window:close'),
    getBounds: () => invoke('window:getBounds'),
    setBounds: (bounds) => invoke('window:setBounds', bounds)
  },
  on: (channel, callback) => {
    if (!EVENTS.has(channel) || typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('feather:event', (event, payload) => {
      if (!payload || payload.type !== channel) return;
      handler(event, payload);
    });
    return () => {
      /* The listener is attached to the shared event channel. */
    };
  }
});
