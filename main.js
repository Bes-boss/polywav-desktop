const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;

// ── Python path resolution ───────────────────────────────────
function resolvePythonPath() {
  if (process.env.POLYWAV_PYTHON) return process.env.POLYWAV_PYTHON;
  if (process.env.VIRTUAL_ENV) {
    const p = path.join(process.env.VIRTUAL_ENV, 'Scripts', 'python.exe');
    if (fs.existsSync(p)) return p;
  }
  const bundled = path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe');
  if (fs.existsSync(bundled)) return bundled;
  return 'python';
}

const PYTHON_PATH = resolvePythonPath();

// ── Window creation ──────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Polywav Ingest',
    frame: false,
    backgroundColor: '#1f1c19',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
    },
  });

  const htmlPath = path.join(__dirname, 'index.html').replace(/\\/g, '/');
  mainWindow.loadURL('file:///' + htmlPath);

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.insertCSS(
      'html, body { min-height: 100vh; }' +
      '.app-wrap { position: relative; z-index: 1; }' +
      '.app-canvas, .app-orb { z-index: 0; }'
    );
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximizeChange', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximizeChange', false);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (exportChild) { exportChild.kill(); exportChild = null; }
});

// ── Window control IPC ──────────────────────────────────────
ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.handle('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});
ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.close();
});
ipcMain.handle('window:isMaximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// ── IPC: Browse output directory ────────────────────────────
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ── IPC: Open folder in Explorer ─────────────────────────────
ipcMain.handle('shell:openFolder', async (event, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) {
    folderPath = path.dirname(folderPath);
    if (!fs.existsSync(folderPath)) return false;
  }
  shell.openPath(folderPath);
  return true;
});

// ── IPC: Probe WAV file ───────────────────────────────────────
ipcMain.handle('file:probe', async (event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return { success: false, error: 'File not found' };
  }
  try {
    const fd = fs.openSync(filePath, 'r');
    const read = (size, off) => {
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, off);
      return buf;
    };

    // Parse RIFF/WAVE header
    const riff = read(12, 0);
    if (riff.toString('ascii', 0, 4) !== 'RIFF' || riff.toString('ascii', 8, 12) !== 'WAVE') {
      fs.closeSync(fd);
      return { success: false, error: 'Not a WAV file' };
    }

    // Walk chunks to find fmt + bext
    let channels = 0;
    let samplerate = 0;
    let bitDepth = 0;
    let bextDescription = null;
    let pos = 12;

    while (pos + 8 <= fs.statSync(filePath).size) {
      const ckId = read(4, pos).toString('ascii');
      const ckSize = read(4, pos + 4).readUInt32LE(0);
      const dataStart = pos + 8;

      if (ckId === 'fmt ') {
        const fmt = read(16, dataStart);
        channels = fmt.readUInt16LE(2);
        samplerate = fmt.readUInt32LE(4);
        const bps = fmt.readUInt16LE(14);
        bitDepth = bps || 16;
      } else if (ckId === 'bext') {
        const bextLen = Math.min(ckSize, 256); // Description is first 256 bytes
        const bextRaw = read(bextLen, dataStart);
        bextDescription = bextRaw.toString('utf-8').replace(/\x00.*$/, '').trim();
      }

      pos += 8 + ckSize + (ckSize % 2); // pad to word boundary
      if (ckId === 'data') break; // no chunks after data
    }

    fs.closeSync(fd);

    if (channels === 0) return { success: false, error: 'No audio data found' };

    // Parse channel names from BEXT description (comma-separated)
    let channelNames = [];
    if (bextDescription) {
      channelNames = bextDescription.split(',').map(s => s.trim()).filter(Boolean);
    }
    // Fallback: generate generic names if BEXT didn't have enough
    while (channelNames.length < channels) {
      channelNames.push(`Channel ${channelNames.length + 1}`);
    }

    return {
      success: true,
      format: 'WAV',
      channels,
      samplerate,
      bitDepth,
      durationSec: 0, // will calculate from data chunk if needed
      channelNames: channelNames.slice(0, channels),
      bextDescription,
      filePath,
      fileName: path.basename(filePath),
      fileSize: fs.statSync(filePath).size,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Stub IPC handlers (clean rejection, not 30s timeout) ────
['dialog:saveFile', 'fs:exists', 'fs:stat', 'app:getInfo'].forEach(channel => {
  ipcMain.handle(channel, async () => {
    console.warn(`IPC channel "${channel}" called but not implemented`);
    return null;
  });
});

// ── IPC: Export pipeline ─────────────────────────────────────
let exportAborted = false;
let exportChild = null;

ipcMain.handle('export:start', async (event, config) => {
  if (exportChild) return { success: false, error: 'Export already in progress' };

  exportAborted = false;
  const win = mainWindow;
  if (!win) return { success: false, error: 'No window' };

  const send = (pct, step) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('export:progress', { pct, step });
  };

  try {
    send(5, 'Validating...');
    if (!config.inputFile) throw new Error('No input file');
    if (!fs.existsSync(config.inputFile)) throw new Error('File not found: ' + config.inputFile);

    send(10, 'Preparing output...');
    const outDir = config.outputDir || path.dirname(config.inputFile);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const stem = path.basename(config.inputFile, path.extname(config.inputFile));
    const outputAaf = path.join(outDir, stem + '.aaf');

    const mode = config.mode || 'group';
    let subtype = null;
    if (config.bitDepth === 16) subtype = 'PCM_16';
    else if (config.bitDepth === 24) subtype = 'PCM_24';
    else if (config.bitDepth === 32) subtype = 'PCM_32';

    send(15, 'Running polywav embed-aaf...');

    const args = ['-m', 'polywav', 'embed-aaf',
      '-i', config.inputFile,
      '-o', outputAaf,
      '--mode', mode,
    ];
    if (config.sampleRate) args.push('--samplerate', String(config.sampleRate));
    if (subtype) args.push('--subtype', subtype);
    if (config.clipName) args.push('--name', config.clipName);

    send(20, 'Reading polywav file...');

    exportChild = spawn(PYTHON_PATH, args, {
      cwd: path.dirname(config.inputFile),
      windowsHide: true,
    });

    let stderrBuf = '';

    exportChild.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes('Wrote')) send(90, 'Writing AAF...');
      if (text.includes('Source channels')) send(70, 'Processing channels...');
      if (text.includes('Output tracks')) send(85, 'Building tracks...');
    });

    exportChild.stderr.on('data', (data) => {
      stderrBuf += data.toString();
    });

    const exitCode = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (exportChild) { exportChild.kill(); exportChild = null; }
        resolve('TIMEOUT');
      }, 30 * 60 * 1000);

      exportChild.on('close', (code) => {
        clearTimeout(timeout);
        resolve(exportAborted ? 'CANCELLED' : code);
      });

      exportChild.on('error', (err) => {
        clearTimeout(timeout);
        send(0, 'Failed: ' + err.message);
        resolve(-1);
      });
    });

    const child = exportChild;
    exportChild = null;

    if (exitCode === 'CANCELLED') throw new Error('Export cancelled');
    if (exitCode === 'TIMEOUT') throw new Error('Export timed out after 30 minutes');
    if (exitCode !== 0) {
      const detail = stderrBuf ? '\n' + stderrBuf.trim() : '';
      throw new Error(`polywav exited with code ${exitCode}${detail}`);
    }

    send(100, 'Export complete');
    return { success: true, outputPath: outputAaf, outputDir: outDir };

  } catch (err) {
    send(0, 'Failed: ' + err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('export:cancel', async () => {
  exportAborted = true;
  if (exportChild) {
    exportChild.kill();
    exportChild = null;
  }
  return true;
});