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
    var parsed = JSON.parse(data);
    // Audit N-11c: corrupt-but-valid JSON must not reach BrowserWindow opts
    var safe = {};
    ['width', 'height', 'x', 'y'].forEach(function (k) {
      var v = parsed ? parsed[k] : undefined;
      if (typeof v === 'number' && isFinite(v)) safe[k] = Math.round(v);
    });
    if (!safe.width || safe.width < 200) safe.width = 1280;
    if (!safe.height || safe.height < 150) safe.height = 820;
    safe.maximized = !!(parsed && parsed.maximized);
    return safe;
  } catch (e) {
    return { width: 1280, height: 820 };
  }
}

// Audit N-11a: a saved position may land off-screen after a monitor change.
// Clamp x/y into the union of all visible display work areas.
function clampToDisplays(state) {
  try {
    const { screen } = require('electron');
    const displays = screen.getAllDisplays();
    if (!displays || !displays.length) return state;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    displays.forEach(function (d) {
      var wa = d.workArea;
      minX = Math.min(minX, wa.x);
      minY = Math.min(minY, wa.y);
      maxX = Math.max(maxX, wa.x + wa.width);
      maxY = Math.max(maxY, wa.y + wa.height);
    });
    // Require at least the title-bar region (100px) to be reachable
    if (state.x !== undefined) {
      if (state.x < minX - 100 || state.x > maxX - 100) delete state.x;
      else state.x = Math.max(minX, Math.min(state.x, maxX - 200));
    }
    if (state.y !== undefined) {
      if (state.y < minY - 30 || state.y > maxY - 100) delete state.y;
      else state.y = Math.max(minY, Math.min(state.y, maxY - 100));
    }
  } catch (e) { /* screen module not ready — skip clamping */ }
  return state;
}

function saveWindowState() {
  if (!mainWindow) return;
  try {
    // Audit N-11b: while maximized, do NOT persist maximized geometry as
    // normal bounds — remember only the flag; keep last known normal size.
    if (mainWindow.isMaximized()) {
      var prev = loadWindowState();
      var state = {
        width: prev.width || 1280,
        height: prev.height || 820,
        x: prev.x,
        y: prev.y,
        maximized: true,
      };
      fs.writeFileSync(getWinStatePath(), JSON.stringify(state, null, 2));
      return;
    }
    var bounds = mainWindow.getBounds();
    var state2 = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: false,
    };
    fs.writeFileSync(getWinStatePath(), JSON.stringify(state2, null, 2));
  } catch (e) {
    // Silently fail — not critical
  }
}

// ---- BrowserWindow ---------------------------------------------------------
function createWindow() {
  var state = clampToDisplays(loadWindowState());
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
      sandbox: true,
    },
  });

  mainWindow.loadFile('index.html');

  // Audit N-3: navigation & window hardening. The renderer processes
  // untrusted client files; any XSS must not be able to pivot to remote
  // content or spawn unsandboxed windows.
  mainWindow.webContents.setWindowOpenHandler(function () {
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', function (e, url) {
    if (!url.startsWith('file://')) {
      e.preventDefault();
    }
  });

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

// ---- IPC: Export Pipeline ---------------------------------------------------
// Audit N-13: resolve the Python interpreter at runtime instead of hardcoding
// a user-specific absolute path. Order: env var -> bundled sidecar -> PATH.
function resolvePython() {
  if (process.env.POLYWAV_PYTHON && fs.existsSync(process.env.POLYWAV_PYTHON)) {
    return process.env.POLYWAV_PYTHON;
  }
  try {
    const bundled = path.join(app.getPath('userData'), 'bin', 'python.exe');
    if (fs.existsSync(bundled)) return bundled;
  } catch (e) { /* app not ready — skip */ }
  // Dev fallback: the known venv on this machine, if it exists
  const devVenv = 'C:\\Users\\Liam\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\python.exe';
  if (fs.existsSync(devVenv)) return devVenv;
  return 'python'; // last resort: whatever is on PATH
}
const VENV_PYTHON = resolvePython();

let currentExportJob = null;
let exportCancelled = false; // Audit N-4a: cancel must not be reported as failure

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

  // Audit N-7: lines can arrive split across pipe chunks. Buffer until a
  // newline (or carriage return) and only emit complete lines. Cap the
  // retained copies so a chatty CLI cannot exhaust memory.
  let lineBuf = '';
  child.stdout.on('data', (data) => {
    const text = data.toString();
    if (stdout.length < 5 * 1024 * 1024) stdout += text;
    lineBuf += text;
    const parts = lineBuf.split(/\r\n|\n|\r/);
    lineBuf = parts.pop(); // keep the partial tail in the buffer
    parts.forEach((line) => {
      if (!line.trim()) return;
      if (mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.webContents.send('export:progress', { jobId: 'current', line }); } catch {}
      }
    });
  });

  child.stderr.on('data', (data) => {
    if (stderr.length < 5 * 1024 * 1024) stderr += data.toString();
  });

  child.on('close', (code) => {
    // Flush any trailing partial line
    if (lineBuf && lineBuf.trim() && mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.webContents.send('export:progress', { jobId: 'current', line: lineBuf }); } catch {}
    }
    lineBuf = '';
    const job = currentExportJob;
    currentExportJob = null;
    if (!job) return; // cancelled elsewhere — cancel handler owns notification
    if (exportCancelled || job.cancelRequested) {
      // Audit N-4a: a user-cancelled export is NOT an error.
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send('export:cancelled', { jobId: 'current' });
        } catch {}
      }
      return;
    }
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
// Audit N-6: a running export must not outlive the app. Kill the child
// process tree on quit so no orphaned python/polywav process lingers.
app.on('before-quit', () => {
  const job = currentExportJob;
  if (!job || !job.child || !job.child.pid) return;
  try {
    spawn('taskkill', ['/T', '/F', '/PID', String(job.child.pid)], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch {
    try { job.child.kill(); } catch { /* already dead */ }
  }
});

app.on('browser-window-created', (event, win) => {
  win.webContents.on('devtools-opened', () => {
    // Keep DevTools closed in production builds
    // win.webContents.closeDevTools();
  });
});