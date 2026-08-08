const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // File dialogs
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),

  // File probing
  probeFile: (filePath) => ipcRenderer.invoke('file:probe', filePath),

  // Shell
  openFolder: (folderPath) => ipcRenderer.invoke('shell:openFolder', folderPath),

  // Export
  startExport: (config) => ipcRenderer.invoke('export:start', config),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),

  // Export progress (main → renderer)
  onExportProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('export:progress', handler);
    return () => ipcRenderer.removeListener('export:progress', handler);
  },

  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizeChange: (callback) => {
    const handler = (event, maximized) => callback(maximized);
    ipcRenderer.on('window:maximizeChange', handler);
    return () => ipcRenderer.removeListener('window:maximizeChange', handler);
  },
  onVisibilityChange: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('window:visibilityChange', handler);
    return () => ipcRenderer.removeListener('window:visibilityChange', handler);
  },
});