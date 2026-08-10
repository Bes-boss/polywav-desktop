const { contextBridge, ipcRenderer } = require('electron');

// ============================================================
// Polywav Desktop — Preload Bridge
// v1.1. Context-isolated IPC channels for the renderer.
// ============================================================

contextBridge.exposeInMainWorld('electronAPI', {
  // ---- Window Controls -----------------------------------------------------
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  onMaximizeChange: (callback) => {
    ipcRenderer.on('window:maximize-change', (event, maximized) => callback(maximized));
  },

  // ---- Window State --------------------------------------------------------
  getWindowState: () => ipcRenderer.invoke('window:getState'),
  saveWindowState: () => ipcRenderer.send('window:saveState'),

  // ---- File Dialogs --------------------------------------------------------
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  openDirectoryWithDefault: (defaultPath) => ipcRenderer.invoke('dialog:openDirectoryWithDefault', defaultPath),
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
    openPath: (filePath) => ipcRenderer.invoke('shell:openPath', filePath),

    // ---- File Metadata --------------------------------------------------------
        probeFile: (filePath) => ipcRenderer.invoke('file:probe', filePath),
        readFileHeader: (filePath) => ipcRenderer.invoke('file:readFileHeader', filePath),

    // ---- Canvas / Lifecycle --------------------------------------------------
  onVisibilityChange: (callback) => {
    ipcRenderer.on('window:visibility-change', (event, visible) => callback(visible));
  },

  // ---- Export Pipeline -----------------------------------------------------
  exportStart: (config) => ipcRenderer.invoke('export:start', config),
  exportCancel: () => ipcRenderer.invoke('export:cancel'),
  onExportProgress: (callback) => {
    ipcRenderer.on('export:progress', (event, data) => callback(data));
  },
  onExportComplete: (callback) => {
    ipcRenderer.on('export:complete', (event, result) => callback(result));
  },
  onExportError: (callback) => {
    ipcRenderer.on('export:error', (event, error) => callback(error));
  },
});