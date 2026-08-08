# Polywav Ingest — Technical & Security Audit

**Audit date:** 2026-08-08  
**App version:** 0.2.0 (Electron 33)  
**Scope:** `main.js`, `preload.js`, `index.html`, `package.json`

---

## Executive Summary

The Polywav Ingest app is a well-structured single-file Electron application with properly configured security primitives (`contextIsolation: true`, `nodeIntegration: false`, `contextBridge` usage). Its biggest risk is a hardcoded absolute Python path (`C:/Users/Liam/...`) that will break on any other machine, and a canvas animation that runs perpetually even when the window is hidden. Several dead IPC channels in the preload bridge have no corresponding backend handlers and would cause the renderer to hang if called. The app otherwise follows reasonable patterns for its niche.

---

## Findings by Severity

### 🔴 Critical

#### C-1: Hardcoded Absolute Python Path in Export Handler
- **File:** `main.js`
- **Line:** 101
- **Description:** The Python executable path is hardcoded to the developer's specific machine:  
  `'C:/Users/Liam/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe'`
- **Impact:** The export feature will fail on any other machine, in any environment (CI, packaged build, different user profile, different Python installation).
- **Fix recommendation:** Replace with a portable strategy:
  - Use `process.env.PYTHON` or a config key (user-set via settings panel).
  - Fall back to `python` / `python3` on `PATH`.
  - Detect during app startup and surface to the user if Python is missing.
  - Store the resolved path in settings (persisted to a config file, not localStorage).

#### C-2: Canvas Animation Runs Forever — No Visibility Throttling
- **File:** `index.html`
- **Lines:** 3598–3683
- **Description:** The `requestAnimationFrame`-based canvas waveform + particle animation runs in an IIFE with no listener for page visibility changes. Combined with `backgroundThrottling: false` in `webPreferences` (main.js:21), the animation continues rendering at full 60 fps even when the window is minimized or hidden.
- **Impact:** Unnecessary CPU/GPU consumption and battery drain on laptops. A decorative effect should not consume resources when the app isn't visible.
- **Fix recommendation:** Add a `document.addEventListener('visibilitychange', ...)` handler that pauses/resumes the draw loop. Example:
  ```js
  var animId;
  function draw() { ... animId = requestAnimationFrame(draw); }
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) { cancelAnimationFrame(animId); }
    else { draw(); }
  });
  ```

#### C-3: No Child Process Cleanup on App Quit
- **File:** `main.js`
- **Lines:** 114 (spawn), 43–45 (app lifecycle)
- **Description:** If the user closes the app while an export is running, the child Python process (`exportChild`) is orphaned. There is no `app.on('before-quit')` or `app.on('will-quit')` handler to kill the running child.
- **Impact:** Orphaned Python processes accumulate, potentially leaving filesystem locks, consuming memory, or writing partial exports.
- **Fix recommendation:**
  ```js
  app.on('before-quit', function() {
    if (exportChild) { exportChild.kill(); exportChild = null; }
  });
  ```

---

### 🟠 Significant

#### S-1: Five Dead IPC Handlers in Preload Bridge
- **File:** `preload.js`
- **Lines:** 6, 8, 14, 15, 30
- **Description:** These IPC channels are registered in the `contextBridge` but have **no corresponding `ipcMain.handle()` in main.js**:
  - `dialog:openFile`
  - `dialog:saveFile`
  - `fs:exists`
  - `fs:stat`
  - `app:getInfo`
- **Impact (low during normal use):** The HTML never calls these methods directly, so no crash occurs in normal operation. However, if any renderer code invoked them (e.g., via console experimentation or future feature work), `ipcRenderer.invoke()` would reject — but only after a 30-second Electron timeout, during which the renderer process hangs unresponsive. There is no `receive`-side error handler.
- **Fix recommendation:** Either implement the handlers in main.js or remove the dead exports from preload.js. If the handlers are planned for future use, add stub handlers that return `null` to fail cleanly.

#### S-2: CLI Error Messages Not Surface in UI
- **File:** `main.js`
- **Lines:** 130–133, 142–143
- **Description:** The `stderr` output from the child process is logged to `console.error` (seen only by the developer) but never captured or displayed to the user. On failure, the renderer receives only `"polywav exited with code N"` with no explanation of what went wrong.
- **Impact:** Users cannot diagnose export failures without opening DevTools.
- **Fix recommendation:** Collect `stderr` into a buffer and include it in the error response:
  ```js
  let stderr = '';
  exportChild.stderr.on('data', (data) => { stderr += data.toString(); });
  // On failure:
  throw new Error(`polywav exited with code ${exitCode}: ${stderr}`);
  ```

#### S-3: No Guard Against Concurrent Export Calls
- **File:** `main.js`
- **Lines:** 66–67, 114, 140
- **Description:** If the renderer calls `export:start` while an export is already running, the old `exportChild` reference is overwritten — the previous process is orphaned and no longer cancellable. There is no check for an in-flight export.
- **Impact:** Multiple concurrent Python processes, resource exhaustion, confusing state.
- **Fix recommendation:** Reject subsequent `export:start` calls if `exportChild !== null`:
  ```js
  if (exportChild) return { success: false, error: 'Export already in progress' };
  ```

#### S-4: Duplicate `exportCLI` Function Declaration
- **File:** `index.html`
- **Lines:** 4245 and 4256
- **Description:** `exportCLI` is defined twice. The first definition (line 4245) redirects to `doExport()`. The second (line 4256) contains standalone clipboard logic that calls `buildCLICommand()` and copies to clipboard. The second definition silently overrides the first.
- **Impact:** The HTML `onclick="exportCLI()"` always calls the second function (clipboard copy), never the first (full export). The behavior may be intentional, but the dead first definition is misleading and the intent is unclear.
- **Fix recommendation:** Remove the first definition (line 4245) and rename the second to something unambiguous like `copyCLI()`. Use explicit `<button onclick="doExport()">Export</button>` for the actual export button.

#### S-5: Unused Exported Channels Are Dead Surface
- **File:** `preload.js`
- **Lines:** 6–8, 14–15, 30
- **Description:** The five dead IPC channels exposed in the preload expand the app's attack surface unnecessarily. While sandbox is off, `contextIsolation` prevents direct Node access — but exposing channels with no handlers is an unnecessary risk and maintenance burden.
- **Fix recommendation:** Remove the unused exports from `preload.js` entirely. Add only when a corresponding main.js handler is implemented.

---

### 🟡 Informational

#### I-1: `sandbox: false` Without Justification
- **File:** `main.js`
- **Line:** 20
- **Description:** The sandbox is disabled. While the app uses `contextBridge` correctly (mitigating the main sandbox benefit — process isolation for untrusted content), sandbox also restricts the preload script's available APIs. The preload only uses `contextBridge` and `ipcRenderer`, both of which work in sandbox mode.
- **Fix recommendation:** Set `sandbox: true`. The preload script doesn't need any sandbox-restricted APIs, and enabling sandbox provides defense-in-depth against potential contextBridge or Chromium vulnerabilities.

#### I-2: `innerHTML` Used with User-Controlled Filename
- **File:** `index.html`
- **Line:** 3734
- **Description:** The dropped file's `name` and `size` are inserted via `innerHTML`:
  ```js
  item.innerHTML = '<span class="file-icon">&#x266B;</span><span class="file-name">' + name + '</span>...';
  ```
  With `contextIsolation: true` and `nodeIntegration: false`, this is not an RCE vector. However, it allows HTML injection in the renderer: a file named `<img src=x onerror=alert(1)>` would execute arbitrary HTML/JS in the renderer context. This could enable UI defacement, phished credential dialogs, or clipboard access (via `navigator.clipboard`).
- **Severity note:** Low risk in Electron with proper webPreferences; still worth fixing for defense-in-depth.
- **Fix recommendation:** Use `textContent` instead of `innerHTML` when displaying filenames, or sanitize with `textContent` + element creation rather than HTML string building.

#### I-3: Same `innerHTML` Pattern in SVG Path Rendering
- **File:** `index.html`
- **Line:** 4414
- **Description:** `svgEl.innerHTML = html` constructs SVG path elements with stroke colors from `ROUTING_DATA`. The colors come from hardcoded values (`#c4664a`, `#c8a96e`, etc.), so this is practically safe. But the pattern is fragile — a future change that introduces user-controlled color values would create an injection vector inside SVG namespaced content.
- **Fix recommendation:** Use `document.createElementNS` for SVG path elements (as is already done for the temp cable at line 4456) rather than `innerHTML`.

#### I-4: No Timeout on Export Child Process
- **File:** `main.js`
- **Lines:** 114–117
- **Description:** The spawned Python process has no timeout. If the CLI hangs (deadlock, waiting on stdin, network filesystem stall), the Electron app hangs indefinitely with no way to detect the stall automatically.
- **Fix recommendation:** Add a timeout guard:
  ```js
  const exportTimeout = setTimeout(() => {
    if (exportChild) { exportChild.kill('SIGKILL'); exportChild = null; }
    reject(new Error('Export timed out after 30 minutes'));
  }, 30 * 60 * 1000);
  // Clear in the close handler
  ```

#### I-5: No Progress from CLI — Hardcoded Heuristic Progress Mapping
- **File:** `main.js`
- **Lines:** 125–127
- **Description:** Progress percentage is estimated based on string detection in stdout (`'Wrote'`, `'Source channels'`, `'Output tracks'`). This is fragile — if the CLI output format changes even slightly, the progress bar will stall at 20%.
- **Fix recommendation:** Add `--json` or `--progress` flags to the polywav CLI to emit structured progress, or use percentage values from the CLI output directly.

#### I-6: Race Condition Around Cancellation vs Process Exit
- **File:** `main.js`
- **Lines:** 136–143
- **Description:** When the user cancels, `exportAborted = true` and `exportChild.kill()` are called. The `close` event fires asynchronously. If the process exits before `exportAborted` is checked, the user sees `"polywav exited with code N"` instead of `"Cancelled"`. The error message from the `close` handler fires first and wins.
- **Fix recommendation:** Track cancellation state more carefully, or check `exportAborted` in the `close` handler itself before determining the error message:
  ```js
  exportChild.on('close', (code) => {
    if (exportAborted) reject(new Error('Cancelled'));
    else if (code !== 0) reject(new Error(`polywav exited with code ${code}`));
    else resolve(code);
  });
  ```

#### I-7: Large Single-File Architecture
- **File:** `index.html` (5123 lines)
- **Description:** The entire UI (HTML, CSS, and JS) is in one file. This works for a utility app but makes maintenance harder. All functions, state, and event bindings are in the global scope.
- **Recommendation:** For any significant feature additions, extract JS into a separate file. The CSS could also be extracted for clarity, but isn't a priority.

#### I-8: No Process Cleanup on Cancel Path (`exportChild = null` After `.kill()`)
- **File:** `main.js`
- **Line:** 156
- **Description:** On cancel, `exportChild.kill()` is called and set to `null`. But there's no `await` or event-based confirmation that the process actually died before returning. The IPC response `return true` is sent immediately (the handler is not async — wait, it IS async and returns on the same line as `exportChild.kill()`, which returns void before kill completes). Actually looking at the code:
  ```js
  ipcMain.handle('export:cancel', async () => {
    exportAborted = true;
    if (exportChild) { exportChild.kill(); exportChild = null; }
    return true;
  });
  ```
  The kill is fire-and-forget. This is functionally fine — the process will be killed — but there's no confirmation back to the renderer that the process actually terminated.
- **Recommendation:** Either `await` the close event before responding, or add a small delay/race.

---

## Python Integration Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| Hardcoded Python path | 🔴 Critical | Absolute path `C:/Users/Liam/...` is machine-specific |
| No `stderr` surfaced to user | 🟠 Significant | Error messages from CLI are logged to console but hidden from UI |
| No progress feedback contract | 🟡 Info | Progress from CLI is guessed via substring matching |
| No timeout on CLI | 🟡 Info | A hung CLI hangs the app indefinitely |
| Forward slashes in Python path | ✅ OK | `spawn()` handles forward slashes fine on Windows |
| Array args (no shell:true) | ✅ Secure | Prevents shell injection |

### Hardcoded Path — Impact Assessment

The line `const pythonPath = 'C:/Users/Liam/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe'` will fail on:
- Any machine whose `C:\Users` profile is not `Liam`
- Any machine whose Python is not in a `hermes-agent/venv/` virtualenv
- The packaged/release build (paths change entirely)
- CI/CD environments
- After `hermes-agent` version upgrades that change the venv path

**Recommendation:** Resolve the Python path at startup using a priority chain:
1. `process.env.POLYWAV_PYTHON` (user override)
2. `process.env.VIRTUAL_ENV + '/Scripts/python.exe'` (active venv)
3. `path.resolve(__dirname, '..', '..', 'venv', 'Scripts', 'python.exe')` (bundled venv)
4. `'python'` as final fallback (must be on PATH)

Surface a clear configuration dialog if Python is unreachable.

---

## Summary of What's Solid

- **Security primitives configured correctly:** `contextIsolation: true`, `nodeIntegration: false`, `contextBridge` used properly. No `shell:true` in `spawn()`. Arguments passed as array (no shell injection).
- **No `eval()` or dangerous `require()` patterns anywhere in the codebase.**
- **Clean IPC error handling:** The `export:start` handler has a proper `try/catch`, the progress `send()` function checks `win.isDestroyed()` before posting messages, and cancellation logic correctly kills the child process.
- **Proper Electron lifecycle:** `window-all-closed` and `activate` events are handled. DevTools are conditionally opened only with `--dev` flag.
- **Good undo/redo system:** `MAX_HISTORY = 50` with proper deep-clone state snapshots.
- **Custom YAML parser is over-engineered for the task but self-contained** — no external dependencies means no supply-chain risk from YAML libraries.
- **File existence checks before operations** in both the `shell:openFolder` handler and the export pipeline.
- **No `shell.openExternal()` calls** that could be used for URL-based attacks.
- **No remote content loaded by default** — the app loads `file://` for its UI and only connects to Google Fonts at load time (preconnect link, no dynamic loading).