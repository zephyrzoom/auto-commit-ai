const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  syncNow: () => ipcRenderer.invoke('sync-now'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (data) => ipcRenderer.invoke('save-config', data),
  getStatus: () => ipcRenderer.invoke('get-status'),
  getLogs: () => ipcRenderer.invoke('get-logs'),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),
  onLog: (callback) => {
    ipcRenderer.on('log-entry', (_, entry) => callback(entry));
  },
  onSyncStatus: (callback) => {
    ipcRenderer.on('sync-status', (_, status) => callback(status));
  },
});
