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

  // ---- File Dialogs --------------------------------------------------------
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  openDirectoryWithDefault: (defaultPath) => ipcRenderer.invoke('dialog:openDirectoryWithDefault', defaultPath),
  openFile: () => ipcRenderer.invoke('dialog:openFile'),

    // ---- Preset Library -------------------------------------------------------
  presetsList: () => ipcRenderer.invoke('presets:list'),
  presetsRead: (name) => ipcRenderer.invoke('presets:read', name),
  presetsSave: (payload) => ipcRenderer.invoke('presets:save', payload),
  presetsDelete: (name) => ipcRenderer.invoke('presets:delete', name),
  presetsExport: (payload) => ipcRenderer.invoke('presets:export', payload),
  presetsImportOpen: () => ipcRenderer.invoke('presets:importOpen'),

  // ---- File Metadata --------------------------------------------------------
        probeFile: (filePath) => ipcRenderer.invoke('file:probe', filePath),
        readFileHeader: (filePath) => ipcRenderer.invoke('file:readFileHeader', filePath),

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
  onExportCancelled: (callback) => {
    ipcRenderer.on('export:cancelled', (event, data) => callback(data));
  },
});