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
      const listener = (event, maximized) => callback(maximized);
      ipcRenderer.on('window:maximize-change', listener);
      return () => ipcRenderer.removeListener('window:maximize-change', listener);
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

    // ---- Directory scan (React batch ingest) ----------------------------------
            listWavs: (dir) => ipcRenderer.invoke('fs:listWavs', dir),

    // ---- Shell helpers ----------------------------------------------------------
            pathForFile: (file) => {
              try { return require('electron').webUtils.getPathForFile(file); } catch (e) { return ''; }
            },

  // ---- Export Pipeline -----------------------------------------------------
  exportStart: (config) => ipcRenderer.invoke('export:start', config),
  exportCancel: () => ipcRenderer.invoke('export:cancel'),
  onExportProgress: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('export:progress', listener);
      return () => ipcRenderer.removeListener('export:progress', listener);
    },
    onExportComplete: (callback) => {
      const listener = (event, result) => callback(result);
      ipcRenderer.on('export:complete', listener);
      return () => ipcRenderer.removeListener('export:complete', listener);
    },
    onExportError: (callback) => {
      const listener = (event, error) => callback(error);
      ipcRenderer.on('export:error', listener);
      return () => ipcRenderer.removeListener('export:error', listener);
    },
    onExportCancelled: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('export:cancelled', listener);
      return () => ipcRenderer.removeListener('export:cancelled', listener);
    },
  });