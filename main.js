const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// ============================================================
// Polywav Desktop — Electron Core
// v1.0. Clean frameless window. No layout changes to the HTML.
// ============================================================

let mainWindow = null;
let isMaximized = false;
let winStatePath = null;

// ---- Window State Persistence -----------------------------------------------
const WINDOW_STATE_FILE = 'win-state.json';

function getWinStatePath() {
  if (!winStatePath) {
    winStatePath = path.join(app.getPath('userData'), WINDOW_STATE_FILE);
  }
  return winStatePath;
}

function loadWindowState() {
  try {
    var data = fs.readFileSync(getWinStatePath(), 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return { width: 1280, height: 820 };
  }
}

function saveWindowState() {
  if (!mainWindow) return;
  try {
    var bounds = mainWindow.getBounds();
    var state = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: mainWindow.isMaximized(),
    };
    fs.writeFileSync(getWinStatePath(), JSON.stringify(state, null, 2));
  } catch (e) {
    // Silently fail — not critical
  }
}

// ---- BrowserWindow ---------------------------------------------------------
function createWindow() {
  var state = loadWindowState();
  mainWindow = new BrowserWindow({
    width: state.width || 1280,
    height: state.height || 820,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1f1c19',
    title: 'Polywav — Ingest Pipeline',
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile('index.html');

  // Restore maximized state
  if (state.maximized) {
    mainWindow.maximize();
  }

  // Show once ready to avoid flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Track maximize state for button toggling + auto-save
  mainWindow.on('maximize', () => {
    isMaximized = true;
    mainWindow.webContents.send('window:maximize-change', true);
    saveWindowState();
  });
  mainWindow.on('unmaximize', () => {
    isMaximized = false;
    mainWindow.webContents.send('window:maximize-change', false);
    saveWindowState();
  });

  // Save state on resize/move (debounced)
  var saveTimer = null;
  var debounceSave = function() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWindowState, 500);
  };
  mainWindow.on('resize', debounceSave);
  mainWindow.on('move', debounceSave);

  // Save state before closing
  mainWindow.on('close', function() {
    saveWindowState();
  });

  // Crash diagnostics
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Render process gone:', details.reason);
    dialog.showErrorBox('Renderer Crash',
      `The renderer process crashed (${details.reason}).\nPlease restart the application.`);
  });
  mainWindow.webContents.on('crashed', () => {
    console.error('Renderer crashed');
    dialog.showErrorBox('Renderer Crash',
      'The renderer process crashed unexpectedly.\nPlease restart the application.');
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---- IPC: Window Controls ---------------------------------------------------
ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  if (isMaximized) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window:getState', () => {
  return loadWindowState();
});

ipcMain.on('window:saveState', () => {
  saveWindowState();
});

// ---- IPC: File Dialogs ------------------------------------------------------
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:openDirectoryWithDefault', async (event, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath: defaultPath || undefined,
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Polywav / WAV', extensions: ['wav'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('shell:openPath', async (event, filePath) => {
  return shell.openPath(filePath);
});

// ---- IPC: File Probe --------------------------------------------------------
ipcMain.handle('file:probe', async (event, filePath) => {
  return new Promise((resolve) => {
    const child = spawn(VENV_PYTHON, ['-m', 'polywav.cli', 'probe', '-i', filePath], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ error: 'Probe failed', stderr: stderr.trim(), stdout: stdout.trim() });
        return;
      }

      const result = { file: filePath, channels: 0, sampleRate: 0, frames: 0, format: '', channelNames: [], bitDepth: 24 };
      const lines = stdout.split('\n');

      lines.forEach((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('Channels:')) {
          result.channels = parseInt(trimmed.split(':')[1].trim(), 10) || 0;
        } else if (trimmed.startsWith('Rate:')) {
          const match = trimmed.match(/(\d+)/);
          result.sampleRate = match ? parseInt(match[1], 10) : 0;
        } else if (trimmed.startsWith('Frames:')) {
          const match = trimmed.match(/(\d+)/);
          result.frames = match ? parseInt(match[1], 10) : 0;
        } else if (trimmed.startsWith('Format:')) {
          result.format = trimmed.split(':')[1].trim();
        } else if (trimmed.startsWith('Description:')) {
          const desc = trimmed.split(':').slice(1).join(':').trim();
          if (desc) {
            result.channelNames = desc.split(',').map((n) => n.trim());
          }
        }
      });

      const bdMatch = result.format.match(/PCM_(\d+)/);
      result.bitDepth = bdMatch ? parseInt(bdMatch[1], 10) : 24;
      resolve(result);
    });

    child.on('error', (err) => {
          resolve({ error: err.message });
        });
      });
    });

    // ---- IPC: Read WAV File Header (first 4KB, parse fmt in main process) --------
    ipcMain.handle('file:readFileHeader', async (event, filePath) => {
      try {
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(4096);
        const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
        fs.closeSync(fd);

        if (bytesRead < 44) return { error: 'File too small for WAV header' };

        // Check RIFF/WAVE magic
        if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
          return { error: 'Not a WAV file' };
        }

        // Walk chunks to find fmt and data
        let pos = 12;
        let fmt = null;
        let dataSize = 0;
        while (pos + 8 <= bytesRead) {
          const ckID = buf.toString('ascii', pos, pos + 4);
          const ckSize = buf.readUInt32LE(pos + 4);
          if (ckID === 'fmt ') {
            fmt = {
              channels: buf.readUInt16LE(pos + 10),
              sampleRate: buf.readUInt32LE(pos + 12),
              bitsPerSample: buf.readUInt16LE(pos + 22),
            };
          } else if (ckID === 'data') {
            dataSize = ckSize;
          }
          pos += 8 + ckSize + (ckSize % 2);
          if (pos >= bytesRead) break;
        }

        if (!fmt) return { error: 'No fmt chunk found' };

        const frames = (dataSize > 0 && fmt.channels > 0 && fmt.bitsPerSample > 0)
          ? Math.floor(dataSize / (fmt.channels * fmt.bitsPerSample / 8))
          : 0;

        return {
          channels: fmt.channels,
          sampleRate: fmt.sampleRate,
          bitsPerSample: fmt.bitsPerSample,
          frames: frames,
          format: 'WAV / PCM_' + fmt.bitsPerSample,
        };
      } catch (err) {
        return { error: err.message };
      }
    });

// ---- IPC: Canvas / Lifecycle ------------------------------------------------
ipcMain.on('window:visibility-change', (event, visible) => {
  // The renderer pauses/resumes its canvas animation via this signal
  // visible=false when minimized, visible=true when restored
});

// ---- IPC: Export Pipeline ---------------------------------------------------
const VENV_PYTHON = 'C:\\Users\\Liam\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\python.exe';

let currentExportJob = null;

ipcMain.handle('export:start', async (event, config) => {
  if (currentExportJob) {
    return { error: 'An export is already running' };
  }

  // Build CLI arguments
    const args = ['-m', 'polywav.cli', 'embed-aaf', '-i', config.inputPath, '-o', config.outputPath];
    if (config.clipName) args.push('--name', config.clipName);
    if (config.routing) args.push('--routing', config.routing);
    if (config.mode && config.mode !== 'group') args.push('--mode', config.mode);
    if (config.sampleRate) args.push('--samplerate', String(config.sampleRate));
    if (config.subtype) args.push('--subtype', config.subtype);
    if (config.essence) args.push('--essence', config.essence);

  const child = spawn(VENV_PYTHON, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => {
    const text = data.toString();
    stdout += text;
    // Stream each line as a progress event
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    lines.forEach((line) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.webContents.send('export:progress', { jobId: 'current', line }); } catch {}
      }
    });
  });

  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  child.on('close', (code) => {
    currentExportJob = null;
    if (code === 0) {
      // Parse output path from the summary line
      const match = stdout.match(/Wrote OP-Atom AAF: (.+)/);
      const outPath = match ? match[1].trim() : config.outputPath;
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send('export:complete', {
            jobId: 'current',
            outputPath: outPath,
            stdout: stdout.trim(),
          });
        } catch {}
      }
    } else {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send('export:error', {
            jobId: 'current',
            message: 'Export failed with exit code ' + code,
            stderr: stderr.trim() || stdout.trim() || 'Unknown error',
          });
        } catch {}
      }
    }
  });

  child.on('error', (err) => {
    currentExportJob = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.send('export:error', {
          jobId: 'current',
          message: 'Failed to start export: ' + err.message,
          stderr: '',
        });
      } catch {}
    }
  });

  currentExportJob = { child, config };
  return { jobId: 'current' };
});

ipcMain.handle('export:cancel', async () => {
  if (!currentExportJob) return { ok: false, error: 'No active export' };

  const { child } = currentExportJob;
  // Kill the process tree on Windows via taskkill
  try {
    await new Promise((resolve, reject) => {
      spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], {
        windowsHide: true,
        stdio: 'ignore',
      }).on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('taskkill exit code ' + code));
      });
    });
  } catch {
    // Fallback: direct kill
    try { child.kill('SIGTERM'); } catch { child.kill(); }
  }

  currentExportJob = null;
  return { ok: true };
});

// ---- DevTools protection ----------------------------------------------------
app.on('browser-window-created', (event, win) => {
  win.webContents.on('devtools-opened', () => {
    // Keep DevTools closed in production builds
    // win.webContents.closeDevTools();
  });
});