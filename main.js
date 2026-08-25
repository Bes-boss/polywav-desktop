const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { parseWavHeader } = require('./lib/wav-header');

// ============================================================
// Polywav Desktop — Electron Core
// v1.0. Clean frameless window. No layout changes to the HTML.
// ============================================================

let mainWindow = null;
let isMaximized = false;
let winStatePath = null;

// ---- Hardening: optional userData override ----------------------------------
// Must run before the single-instance lock (lock scope = userData dir).
// Lets tests/portable installs isolate their state; real users are unaffected.
if (process.env.POLYWAV_USER_DATA) {
  try { app.setPath('userData', process.env.POLYWAV_USER_DATA); } catch (_) { /* ignore */ }
}

// ---- Hardening: single instance ---------------------------------------------
// Two instances would race on userData (win-state.json, presets) and could both
// spawn engine processes against the same outputs. Focus the running window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ---- Hardening: atomic writes ------------------------------------------------
// A crash mid-write must never truncate win-state.json or a preset YAML.
function atomicWriteFileSync(filePath, data) {
  const tmp = filePath + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

// ---- Main-process crash guard (audit hardening 2026-08-22) ------------------
// An uncaught exception in the main process must not silently kill the app.
// Log to stderr; keep the window alive for recoverable errors.
process.on('uncaughtException', (err) => {
  try {
    console.error('[polywav] uncaught exception in main process:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('export:progress', {
        jobId: 'current',
        line: '[polywav] internal error: ' + (err && err.message ? err.message : String(err)),
      });
    }
  } catch (_) { /* never throw inside the guard */ }
});
process.on('unhandledRejection', (reason) => {
  try {
    console.error('[polywav] unhandled rejection in main process:', reason);
  } catch (_) { /* never throw inside the guard */ }
});

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
        atomicWriteFileSync(getWinStatePath(), JSON.stringify(state, null, 2));
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
      atomicWriteFileSync(getWinStatePath(), JSON.stringify(state2, null, 2));
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

  // ---- UI selection (REACT-MIGRATION.md §2/§6; env-gated, additive) ----
    // Default: shipping index.html. POLYWAV_UI === 'react' -> React shell
    // (react/dist, or react-dist when packaged). POLYWAV_DEV_SERVER -> dev URL.
    const devServer = process.env.POLYWAV_DEV_SERVER;
    const uiReact = process.env.POLYWAV_UI === 'react';
    if (devServer) {
      mainWindow.loadURL(devServer);
    } else if (uiReact) {
          // Packaged: extraResources copies react/dist -> <resources>/react-dist.
          // Dev: react/dist sits inside the repo.
          const packed = path.join(process.resourcesPath || '', 'react-dist', 'index.html');
          const dev = path.join(__dirname, 'react', 'dist', 'index.html');
          mainWindow.loadFile(fs.existsSync(packed) ? packed : dev);
    } else {
      mainWindow.loadFile('index.html');
    }

  // Audit N-3: navigation & window hardening. The renderer processes
  // untrusted client files; any XSS must not be able to pivot to remote
  // content or spawn unsandboxed windows.
  mainWindow.webContents.setWindowOpenHandler(function () {
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', function (e, url) {
    // Only our own packaged pages may load; anything else (remote or another
    // local file) is blocked.
    var ok = url.startsWith('file://') && (
      url.endsWith('/index.html') || url.includes('/index.html?')
    );
    if (!ok) e.preventDefault();
  });
  // Hardening: deny every privileged web permission (mic, cam, geolocation,
  // notifications...). This app needs none of them; an XSS must not get them.
  mainWindow.webContents.session.setPermissionRequestHandler(function (_wc, permission, callback) {
    callback(false);
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
// Tolerate a destroyed window (dialog can outlive a crashed renderer).
function dialogParent() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
}

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(dialogParent(), {
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:openDirectoryWithDefault', async (event, defaultPath) => {
  const result = await dialog.showOpenDialog(dialogParent(), {
    defaultPath: defaultPath || undefined,
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(dialogParent(), {
    properties: ['openFile'],
    filters: [
      { name: 'Polywav / WAV', extensions: ['wav'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// (dead shell-open channel removed 2026-08-23 — nothing in either UI calls it,
// and the dead-channel contract forbids exporting unused IPC.)

// ---- IPC: Preset Library ----------------------------------------------------
// Two-tier store:
//   bundled: <appPath>/presets/*.yaml   ships with the app, read-only in the UI
//   user:    POLYWAV_PRESETS_DIR or <userData>/presets/   writable
// Main stays a dumb file server; YAML parsing/validation lives in the renderer
// and (authoritatively) in the Python engine's ShowPreset.
const PRESET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

function userPresetsDir() {
  const dir = process.env.POLYWAV_PRESETS_DIR || path.join(app.getPath('userData'), 'presets');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* read-only fs: surface on write */ }
  return dir;
}
function bundledPresetsDir() {
  return process.env.POLYWAV_PRESETS_BUNDLED_DIR || path.join(app.getAppPath(), 'presets');
}
function presetSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'preset';
}
function listPresetFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((f) => /\.ya?ml$/i.test(f))
      .sort();
  } catch (e) {
    return [];
  }
}

ipcMain.handle('presets:list', async () => {
  function readTier(dir, tier) {
    return listPresetFiles(dir).map((file) => {
      try {
        return { file, tier, stem: file.replace(/\.ya?ml$/i, ''), text: fs.readFileSync(path.join(dir, file), 'utf8') };
      } catch (e) {
        return { file, tier, stem: file.replace(/\.ya?ml$/i, ''), text: '', error: String(e.message || e) };
      }
    });
  }
  return { bundled: readTier(bundledPresetsDir(), 'bundled'), user: readTier(userPresetsDir(), 'user') };
});

ipcMain.handle('presets:read', async (event, stem) => {
  if (!PRESET_NAME_RE.test(String(stem || ''))) throw new Error('Invalid preset name');
  for (const dir of [userPresetsDir(), bundledPresetsDir()]) {
    for (const file of listPresetFiles(dir)) {
      if (file.replace(/\.ya?ml$/i, '') === stem) {
        return { stem, tier: dir === userPresetsDir() ? 'user' : 'bundled', text: fs.readFileSync(path.join(dir, file), 'utf8') };
      }
    }
  }
  throw new Error('Preset not found: ' + stem);
});

ipcMain.handle('presets:save', async (event, payload) => {
  const name = String((payload && payload.name) || '');
  const yamlText = String((payload && payload.yamlText) || '');
  const force = !!(payload && payload.force);
  if (!PRESET_NAME_RE.test(name)) throw new Error('Preset name may contain letters, numbers, spaces, - and _ only');
  if (!yamlText.trim()) throw new Error('Refusing to save empty preset');
  const file = presetSlug(name) + '.yaml';
  const full = path.join(userPresetsDir(), file);
  if (fs.existsSync(full) && !force) return { exists: true, file };
  atomicWriteFileSync(full, yamlText.endsWith('\n') ? yamlText : yamlText + '\n');
  return { ok: true, file, overwritten: !!force && fs.existsSync(full) };
});

ipcMain.handle('presets:delete', async (event, stem) => {
  if (!PRESET_NAME_RE.test(String(stem || ''))) throw new Error('Invalid preset name');
  const file = path.join(userPresetsDir(), stem + '.yaml');
  if (!fs.existsSync(file)) throw new Error('Only user presets can be deleted');
  fs.unlinkSync(file);
  return { ok: true };
});

ipcMain.handle('presets:export', async (event, payload) => {
  const defaultName = String((payload && payload.defaultName) || 'preset.yaml');
  const yamlText = String((payload && payload.yamlText) || '');
  if (!yamlText.trim()) throw new Error('Nothing to export');
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'Polywav Preset', extensions: ['yaml', 'yml'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  atomicWriteFileSync(result.filePath, yamlText.endsWith('\n') ? yamlText : yamlText + '\n');
  return { ok: true, path: result.filePath };
});

ipcMain.handle('presets:importOpen', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Polywav Preset', extensions: ['yaml', 'yml'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  const p = result.filePaths[0];
  return { ok: true, path: p, base: path.basename(p).replace(/\.ya?ml$/i, ''), text: fs.readFileSync(p, 'utf8') };
});

// ---- IPC: File Probe --------------------------------------------------------
// Hardening: a hung engine must not leave the UI loading forever.
const PROBE_TIMEOUT_MS = 20000;

ipcMain.handle('file:probe', async (event, filePath) => {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const child = spawn(VENV_PYTHON, buildEngineArgs(['probe', '-i', filePath]), {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) { /* already dead */ }
      finish({ error: 'Probe timed out after ' + (PROBE_TIMEOUT_MS / 1000) + 's' });
    }, PROBE_TIMEOUT_MS);

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        finish({ error: 'Probe failed', stderr: stderr.trim(), stdout: stdout.trim() });
        return;
      }

      const result = { file: filePath, channels: 0, sampleRate: 0, frames: 0, format: '', channelNames: [], bitDepth: 24 };
      const trackNames = [];  // filled from the engine's 'Track NN:' lines
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
        } else if (/^Track \d+:/.test(trimmed)) {
          // Authoritative per-channel names from the engine (iXML TRACK_LIST,
          // else bext). One line per channel, so order is explicit.
          const tm = trimmed.match(/^Track (\d+):\s*(.*)$/);
          if (tm) trackNames[parseInt(tm[1], 10) - 1] = tm[2].trim();
        } else if (trimmed.startsWith('Description:')) {
          const desc = trimmed.split(':').slice(1).join(':').trim();
          if (desc) {
            result.channelNames = desc.split(',').map((n) => n.trim());
          }
        }
      });

      // Prefer the explicit per-channel list. The Description fallback is a
      // comma-split guess and is simply wrong when the recorder writes take
      // metadata (bPROJECT=/bTAKE=) there instead of names.
      if (trackNames.some((n) => n && n.length)) {
        const n = result.channels || trackNames.length;
        result.channelNames = Array.from({ length: n }, (_, k) => trackNames[k] || ('Ch ' + (k + 1)));
      }

      const bdMatch = result.format.match(/PCM_(\d+)/);
      result.bitDepth = bdMatch ? parseInt(bdMatch[1], 10) : 24;
      finish(result);
    });

    child.on('error', (err) => {
      finish({ error: err.message });
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
        return parseWavHeader(buf, bytesRead);
      } catch (err) {
        return { error: err.message };
      }
    });

      // ---- IPC: Directory scan (React batch ingest) ------------------------------
      // List .wav files in a shoot-day folder. The React shell probes each hit via
      // file:probe to build the take list (batch decision 2026-08-22).
      ipcMain.handle('fs:listWavs', async (event, dir) => {
        try {
          const st = fs.statSync(String(dir || ''));
          if (!st.isDirectory()) return { error: 'Not a folder: ' + dir };
          const entries = fs.readdirSync(String(dir || ''), { withFileTypes: true })
            .filter((e) => e.isFile() && /\.wav$/i.test(e.name))
            .map((e) => e.name)
            .sort();
          return { wavs: entries };
        } catch (e) {
          return { error: String((e && e.message) || e) };
        }
      });

      // ---- IPC: Export Pipeline ---------------------------------------------------
// Audit N-13: resolve the Python interpreter at runtime instead of hardcoding
// a user-specific absolute path. Order: env var -> bundled sidecar -> PATH.
function resolvePython() {
  // 0. Explicit env override (engine exe or interpreter).
  //    POLYWAV_PYTHON kept as a legacy alias.
  const envEngine = process.env.POLYWAV_ENGINE || process.env.POLYWAV_PYTHON;
  if (envEngine && fs.existsSync(envEngine)) {
    return envEngine;
  }
  // 1. Packaged engine sidecar next to the installed app
  try {
    const sidecar = path.join(process.resourcesPath || '', 'engine', 'polywav-engine.exe');
    if (process.resourcesPath && fs.existsSync(sidecar)) return sidecar;
  } catch (e) { /* resourcesPath unavailable in some contexts */ }
  // 2. Engine sidecar dropped into the user-data bin dir
  try {
    const bundledExe = path.join(app.getPath('userData'), 'bin', 'polywav-engine.exe');
    if (fs.existsSync(bundledExe)) return bundledExe;
  } catch (e) { /* app not ready — skip */ }
  // 3. Legacy: a full python.exe dropped into userData/bin
  try {
    const bundledPy = path.join(app.getPath('userData'), 'bin', 'python.exe');
    if (fs.existsSync(bundledPy)) return bundledPy;
  } catch (e) { /* app not ready — skip */ }
  // 4. Dev: the engine produced by `npm run engine:build`, which lands in
  //    <engine root>/dist/polywav-engine — a sibling of this desktop checkout.
  //    Resolved repo-relative so it works on any clone. The previous entry here
  //    was one machine's hardcoded venv; on any other machine it resolved
  //    nowhere and the chain fell through to a bare `python` without the engine.
  try {
    const devExe = process.platform === 'win32' ? 'polywav-engine.exe' : 'polywav-engine';
    const devEngine = path.join(__dirname, '..', 'dist', 'polywav-engine', devExe);
    if (fs.existsSync(devEngine)) return devEngine;
  } catch (e) { /* path unavailable — skip */ }
  return 'python'; // last resort: whatever is on PATH
}
const VENV_PYTHON = resolvePython();
// Frozen PyInstaller exe runs the CLI directly; interpreter mode needs -m module.
const enginePathLower = String(VENV_PYTHON).toLowerCase();
const ENGINE_IS_EXE =
  enginePathLower.endsWith('.exe') && enginePathLower.indexOf('python') === -1;

// Build full spawn argv for a polywav CLI invocation.
// cliArgs example: ['embed-aaf', '-i', input, '-o', output].
function buildEngineArgs(cliArgs) {
  if (ENGINE_IS_EXE) return cliArgs.slice();
  return ['-m', 'polywav.cli'].concat(cliArgs);
}

let currentExportJob = null;
let exportCancelled = false; // Audit N-4a: cancel must not be reported as failure

ipcMain.handle('export:start', async (event, config) => {
  if (currentExportJob) {
    return { error: 'An export is already running' };
  }

  // Hardening: validate before spawning. The engine's errors are good but
  // late; these fail fast with a clear message and no python spin-up.
  const inputPath = String((config && config.inputPath) || '');
  const outputPath = String((config && config.outputPath) || '');
  if (!inputPath || !fs.existsSync(inputPath)) {
    return { error: 'Input file not found: ' + (inputPath || '(none)') };
  }
  if (!outputPath) {
    return { error: 'No output path given' };
  }
  const outDir = path.dirname(outputPath);
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (e) {
    return { error: 'Cannot create output folder ' + outDir + ': ' + String((e && e.message) || e) };
  }

  // Build CLI arguments
    const args = buildEngineArgs(['embed-aaf', '-i', inputPath, '-o', outputPath]);
    if (config.clipName) args.push('--name', config.clipName);
    if (config.routing) args.push('--routing', config.routing);
    if (config.mode && config.mode !== 'group') args.push('--mode', config.mode);
    if (config.sampleRate) args.push('--samplerate', String(config.sampleRate));
    if (config.subtype) args.push('--subtype', config.subtype);
    if (config.essence) args.push('--essence', config.essence);
    if (config.mxfDir) args.push('--mxf-dir', config.mxfDir);

  // The track plan is the app's complete naming decision. It goes to disk
  // because 63 tracks of names, order and channel assignment do not belong
  // on a command line.
  let trackPlanPath = null;
  if (config.trackPlan && Array.isArray(config.trackPlan.tracks) && config.trackPlan.tracks.length) {
    try {
      trackPlanPath = path.join(app.getPath('temp'), `polywav-trackplan-${process.pid}.json`);
      fs.writeFileSync(trackPlanPath, JSON.stringify(config.trackPlan), 'utf8');
      args.push('--track-plan', trackPlanPath);
    } catch (e) {
      trackPlanPath = null;   // fall back to the engine's own name discovery
    }
  }
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
    if (trackPlanPath) {
      try { fs.unlinkSync(trackPlanPath); } catch (e) { /* already gone */ }
      trackPlanPath = null;
    }
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

  // Hardening: the renderer's cancelExport sets idle optimistically, but the
  // authoritative state comes from here — covers the case where the renderer
  // missed its own update (overlay closed, tab switched mid-cancel).
  exportCancelled = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('export:cancelled', { jobId: 'current' }); } catch {}
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