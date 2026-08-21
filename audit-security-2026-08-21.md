# Polywav Desktop — Hyper-Critical Security & Quality Audit (follow-up)

**Audit date:** 2026-08-21
**Auditor scope:** `main.js` (426 ln), `preload.js` (47 ln), inline JS in `index.html` (lines 3519–6535, ~3015 ln of JS). CSS/visuals excluded.
**Baseline:** `audit-technical.md` (2026-08-08). Every prior finding re-verified against current code with current line numbers.
**App version:** package.json says 1.0.0, Electron ^33.0.0.

---

## Executive summary

The app's security posture has **regressed in one important way and improved in several others** since 2026-08-08. The good: dead preload channels removed, concurrent-export guard added, stderr now surfaced, duplicate `exportCLI` fixed. The bad: **`webSecurity: false` is now set** (not flagged by the prior audit), and the renderer injects **BEXT-derived channel names straight from client-delivered WAV files into `innerHTML` in at least 8 places without escaping**. For an audio engineer processing *client files* — untrusted input by definition — this is a real attack chain, not a theoretical one:

> Crafted WAV (BEXT Description = `<img src=x onerror=…>`) → probe → `rawChannels[].raw` → `tbody.innerHTML` → JS executes in renderer → renderer has full `window.electronAPI` bridge (`exportStart` arbitrary write path, `openPath` arbitrary open, `readFileHeader` arbitrary read) **and SOP is disabled**, so `fetch('file:///C:/Users/Liam/...')` works for bulk exfiltration.

There is no CSP, no `setWindowOpenHandler`, no `will-navigate` guard, no permission handler. Any one XSS payload therefore pivots freely. Fixing escaping + `webSecurity` collapses this chain to harmless defacement.

---

## PART 1 — Verification of prior audit findings (audit-technical.md, 2026-08-08)

| ID | Prior finding | Status | Current location / evidence |
|----|---------------|--------|------------------------------|
| C-1 | Hardcoded absolute Python path | **STILL PRESENT** | main.js:310 — `VENV_PYTHON = 'C:\\Users\\Liam\\...\\venv\\Scripts\\python.exe'`. Breaks on any other machine/packaged build. Bonus smell: declared at line 310 but referenced inside the `file:probe` handler registered at line 197–199 (works only because handlers run post-load; fragile ordering). |
| C-2 | Canvas animation never throttled | **PARTIAL** | `backgroundThrottling:false` was removed from webPreferences (main.js:66–72), so Chromium now throttles rAF when minimized/occluded. But the draw loop (index.html:4455–4495) still has no `visibilitychange` pause, and the IPC path meant to do this was never wired (see N-12): main.js:304–307 is an empty receiver, nothing ever sends `window:visibility-change`. A hidden-but-visible-on-other-monitor window burns GPU indefinitely. |
| C-3 | No child-process cleanup on quit | **STILL PRESENT** | No `before-quit`/`will-quit` anywhere in main.js. Variable renamed `exportChild`→`currentExportJob` (main.js:312); closing the app mid-export still orphans python.exe holding file locks on the output AAF/WAV. |
| S-1 | Five dead IPC channels (`dialog:openFile`, `dialog:saveFile`, `fs:exists`, `fs:stat`, `app:getInfo`) | **FIXED** | `dialog:saveFile`, `fs:exists`, `fs:stat`, `app:getInfo` are gone from preload.js; `dialog:openFile` is now implemented (main.js:180–190) and used (index.html:4782, 4791). New dead channels appeared though — see N-12. |
| S-2 | CLI stderr not surfaced to user | **FIXED** | stderr captured (main.js:348–350) and sent in `export:error` (main.js:370–374); renderer renders it escaped via `escapeHtml` (index.html:5319, 5392). |
| S-3 | No guard against concurrent exports | **FIXED** | main.js:315–317 returns `{error:'An export is already running'}` if `currentExportJob` set. |
| S-4 | Duplicate `exportCLI` definitions | **FIXED** | Single definition; `var exportCLI = doExport;` alias at index.html:5286. |
| S-5 | Unused exported channels = dead attack surface | **FIXED** | Same remediation as S-1 (but see N-12 for the new dead set). |
| I-1 | `sandbox:false` unjustified | **STILL PRESENT** | main.js:71. Preload uses only `contextBridge`+`ipcRenderer` → `sandbox:true` costs nothing. |
| I-2 | innerHTML with user-controlled filename | **STILL PRESENT & EXPANDED** | Was 1 site (old line 3734). Now ~10 sites incl. the far more serious BEXT channel-name path (N-2). Recent-files sites: index.html:4712, 4771, 4843; hero subtitle: 4538. |
| I-3 | SVG path rendering via innerHTML | **PARTIAL** | `svgEl.innerHTML = html` remains (index.html:5515), but interpolated values are now computed numbers + hardcoded palette colors only (5498–5513); temp cable already uses `createElementNS` (5557). Practically safe today, still fragile pattern. |
| I-4 | No timeout on export child | **STILL PRESENT** | No timeout around spawn (main.js:328–395). A hung CLI hangs the export forever; only manual cancel recovers. |
| I-5 | Heuristic progress mapping | **IMPROVED / PARTIAL** | stdout lines now stream live to the log as progress events (main.js:340–345) — much better UX. Still no structured progress contract; completion detection still relies on regex `/Wrote OP-Atom AAF: (.+)/` (main.js:356). And the streaming has a chunk-boundary bug — see N-7. |
| I-6 | Cancel vs exit race (message mismatch) | **WORSE** | The old `exportAborted` flag is **gone entirely**. Cancel force-kills the tree → child exits non-zero → close handler emits `export:error "Export failed with exit code 1"` (main.js:367–377). Renderer's cancel handler sets badge `cancelled` (index.html:5354–5372), then the error event flips it to `failed` + logs an error — order-dependent UI, misleading log. Detail in N-4. |
| I-7 | Large single-file architecture | **STILL PRESENT** | Grew 5123 → 6537 lines. |
| I-8 | Cancel kill fire-and-forget | **PARTIAL (improved)** | Cancel now awaits taskkill completion before returning `{ok:true}` (main.js:402–415). Remaining issue: the subsequent `close` event notification still arrives unordered vs. the cancel response (part of N-4). |

Prior-audit claims that checked out as still true: array-args spawning with no `shell:true` (main.js:199, 328, 404); no `eval`/`new Function`; no `shell.openExternal`; undo/redo deep-clone history intact (index.html:4920–4964).

---

## PART 2 — NEW findings (ranked by severity)

### 🔴 CRITICAL

#### N-1: `webSecurity: false` disables same-origin policy in the renderer
- **File:** main.js:70
- **Why it matters here:** This app's whole purpose is opening files that clients delivered. With SOP off, any script running in the renderer (see N-2 for how easily that happens) can `fetch('file:///C:/Users/Liam/Documents/...')` and read arbitrary local files, then exfiltrate them via the exposed IPC bridge (e.g., write into a preset YAML download or an export output path). It also makes the Google Fonts load (N-16) a live supply-chain surface instead of a cosmetic one. There is no comment justifying it, and nothing in the app needs it — all content is local `file://` same-origin.
- **Fix:** Delete line 70. If some asset ever fails under default policy, serve the app via a custom `protocol.handle`/`registerFileProtocol` with proper CORS instead of disabling security globally.
```js
webPreferences: {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,   // see N-15
},
```

#### N-2: Unescaped attacker-controlled strings injected via `innerHTML` (XSS) — BEXT channel names, filenames, clip names
- **Files / exact sites (all index.html unless noted):**
  - **3882** — `ch.raw` (BEXT channel name from probed WAV) and `ch.bext` injected into normalize table row.
  - **3890–3893** — capture-group cell values derived from `ch.raw` injected into `contenteditable` cells; **3895** normalized name injected.
  - **5025** — `normName` (derived from raw names) into route table.
  - **5417, 5453** — `normName` into patch-tab source chips and unrouted chips.
  - **4538** — `_clipName` (filename) into hero subtitle.
  - **4712, 4771, 4843** — filename into recent-files list (4843 also replays names from localStorage → **stored/persistent XSS across sessions**).
  - **6483–6493** — wizard summary injects user-typed template/dirs (self-XSS, lower risk).
- **Why CRITICAL for this app:** Channel names come from the BEXT Description field of client WAV files — fully attacker-controlled bytes. An audio engineer dropping a supplied file is the normal workflow. Payload executes in a renderer that holds the entire `electronAPI` bridge: `exportStart` (spawn python with attacker-chosen `-i/-o` paths → arbitrary file write/clobber), `openPath` (open anything), `readFileHeader`, and — combined with N-1 — unrestricted local file reads. Only the export log path escapes correctly (`escapeHtml`, index.html:5324–5328).
- **Fix:** One helper + mechanical replacement at every site:
```js
function esc(s){var d=document.createElement('div');d.appendChild(document.createTextNode(String(s==null?'':s)));return d.innerHTML;}
html += '<td class="raw-name">' + esc(ch.raw) + ' <span class="bext-tag">' + esc(ch.bext) + '</span></td>';
```
For the recent list, build nodes with `textContent` (also fixes N-17's round-trip mangling). Defense-in-depth so the remaining slip can't pivot: add CSP meta `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:;">` (after self-hosting fonts per N-16, drop the font origins too).

### 🟠 HIGH

#### N-3: Zero navigation/window hardening — no `setWindowOpenHandler`, no `will-navigate` deny, no permission handler, no CSP
- **File:** main.js:52–124 (createWindow)
- **Why it matters:** With N-2 giving script execution, `location.href='https://evil'` loads remote content **inside the trusted frameless app window** (perfect phishing: identical chrome, next to real client data), and `window.open` spawns unsandboxed windows. Electron's secure-default checklist requires all three guards; none are present.
- **Fix:**
```js
mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
mainWindow.webContents.on('will-navigate', (e, url) => {
  if (!url.startsWith('file://')) e.preventDefault();
});
session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(false));
```

#### N-4: Export cancel/completion race — cancellation reported as failure; PID-reuse window on taskkill
- **Files:** main.js:352–378 (close handler), 397–419 (cancel); index.html:5354–5372
- **Details:** (a) No aborted flag exists anymore, so after a successful cancel the close handler still emits `export:error "Export failed with exit code 1"`, overwriting the renderer's `cancelled` badge and polluting the log. (b) `export:cancel` nulls `currentExportJob` immediately (main.js:417); if the child already exited between the guard and `taskkill /F /PID`, Windows may have **reused the PID** and the force-kill hits an unrelated process. (c) Renderer flip-flop: `.then` of `exportCancel` sets badge `cancelled`, then the async `export:error` event sets `failed`.
- **Fix:**
```js
let exportCancelled = false;
// in export:start: exportCancelled = false;
child.on('close', (code) => {
  const job = currentExportJob; currentExportJob = null;
  if (!job) return;                       // cancelled elsewhere
  if (exportCancelled || job.cancelRequested) {
    mainWindow && !mainWindow.isDestroyed() &&
      mainWindow.webContents.send('export:cancelled', { jobId:'current' });
    return;
  }
  /* ...existing complete/error branches... */
});
// in export:cancel:
const job = currentExportJob;
if (!job || job.child.exitCode !== null || job.child.killed) return { ok:false, error:'No active export' };
job.cancelRequested = true; exportCancelled = true;
await new Promise(res => spawn('taskkill',['/T','/F','/PID',String(job.child.pid)],{windowsHide:true,stdio:'ignore'}).on('close',res));
return { ok: true };
```
Renderer: handle `onExportCancelled` to set badge/log instead of falling through to `onExportError`.

#### N-5: Probe race — stale async result clobbers newer file state (wrong routing exported)
- **Files:** index.html:4638–4669 (`finalizeFileLoad.finish`), 4672–4777 (`handleFile`/`handleFilePath`)
- **Scenario:** Engineer drops file A, immediately drops file B. Both probes are in flight. `_filePath/_clipName` were updated synchronously to B, but A's slower probe resolves last → `finish()` rebuilds `ROUTING_DATA`/`rawChannels` from **A** while header/UI say **B**. The engineer routes "B's" channels and exports — python receives B's path with A-derived channel semantics. Silent data-integrity bug for exactly the busy multi-file workflow this tool targets.
- **Fix:** Tag each load with an epoch and ignore stale completions:
```js
var _loadEpoch = 0;
function finalizeFileLoad(meta, bextProbePromise) {
  var epoch = ++_loadEpoch;
  function finish(names){
    if (epoch !== _loadEpoch) return;   // stale probe, drop
    ...
  }
}
```
Same guard inside the `readWavHeaderFromFile(...).then(...)` continuation.

### 🟡 MEDIUM

#### N-6: App close mid-export orphans python (prior C-3, restated as new-code defect)
- **File:** main.js (absent) — needed near line 126.
- **Impact:** Orphaned python keeps writing a partial AAF / holds locks; engineer later can't delete or overwrite the output.
- **Fix:**
```js
app.on('before-quit', () => {
  if (currentExportJob) {
    try { spawn('taskkill', ['/T','/F','/PID', String(currentExportJob.child.pid)], {windowsHide:true, stdio:'ignore'}); } catch {}
    currentExportJob = null;
  }
});
```

#### N-7: Progress-stream parsing splits lines on chunk boundaries; no `\r` handling; unbounded buffering
- **File:** main.js:336–349
- **Details:** Each `data` event is split independently (line 340) — a line arriving across two TCP/pipe chunks emits **two partial progress events** (log shows torn lines, and any future parsing on those lines breaks). Bare `\r` progress updates (typical CLI spinners) aren't handled, so they'd concatenate into one giant line. `stdout += text` grows without cap — a chatty CLI on a long batch exhausts renderer/main memory.
- **Fix:**
```js
let lineBuf = '';
child.stdout.on('data', (d) => {
  lineBuf += d.toString();
  const parts = lineBuf.split(/\r\n|\n|\r/);
  lineBuf = parts.pop();                       // keep partial tail
  parts.forEach(line => { if (line.trim()) send(line); });
  if (stdout.length < 5_000_000) stdout += d.toString();  // cap retained copy
});
child.on('close', () => { if (lineBuf.trim()) send(lineBuf); ... });
```
Also stream `stderr` tail to the log live (currently silent until exit).

#### N-8: Failed export start leaves progress UI stuck in "running"
- **File:** index.html:5260–5273 (`doExport`)
- **Details:** `showExportProgress(true)` + badge `running` happen before the invoke. When main returns `{error}` (concurrent-export guard, main.js:315) or the promise rejects, the code only toasts — progress bar stays visible, badge stays `running`, button stays "Cancel Export" while `_exporting` is false. Next real click of the visible button calls `cancelExport` on nothing.
- **Fix:** In both the `result.error` branch and `.catch`, call `showExportProgress(false); setExportBadge('ready','error'); updateExportButton(false);`.

#### N-9: Tab-switch hide timeout blanks the active tab on quick A→B→A
- **File:** index.html:3545–3560 (`switchTab`)
- **Details:** Switching away schedules `current.style.display='none'` after 400 ms with no epoch check. Switch back within 400 ms and the timer fires on the now-active tab, hiding it while `.active` — tab appears blank until the next switch.
- **Fix:** Capture and cancel: store `pendingHide` timeout per switch; clear it at function entry if it targets the incoming tab, or check inside the callback `if (!current.classList.contains('active')) current.style.display='none';`.

#### N-10: `onMaximizeChange` listener leaks on every maximize click
- **Files:** index.html:3524–3531; preload.js:13–15
- **Details:** `maximizeWindow()` registers a fresh `ipcRenderer.on('window:maximize-change')` handler per click (button onclick, index.html:2712). After N clicks, N callbacks run per event. Preload never returns an unsubscribe fn, so the leak is unfixable from the renderer.
- **Fix:** Register once at startup (module scope, not inside `maximizeWindow()`), and have preload return removers:
```js
onMaximizeChange: (cb) => { const h=(e,m)=>cb(m); ipcRenderer.on('window:maximize-change',h); return ()=>ipcRenderer.removeListener('window:maximize-change',h); },
```
Apply the same return-a-remover pattern to `onExportProgress/Complete/Error`.

#### N-11: Window-state restore has no off-screen validation; maximized geometry saved as normal bounds
- **File:** main.js:25–49, 53–58, 88–111
- **Details:** (a) `x/y` restored verbatim — undock a monitor and the app opens off-screen (invisible window, tray-less app = looks like a crash). (b) While maximized, debounced `saveWindowState` stores the maximized bounds as normal bounds; restore-after-restart yields wrong size when un-maximizing. (c) Corrupt-but-valid JSON (e.g. `{"width":"abc"}`) passes `JSON.parse` and reaches BrowserWindow options unvalidated.
- **Fix:** Validate against `screen.getAllDisplays()` work areas before applying (skill's canonical snippet); skip saving x/y/w/h while `isMaximized()` (save `{maximized:true}` only); clamp/sanitize numeric fields with defaults.

#### N-12: Dead IPC surface & never-wired canvas-pause channel (new dead pairs replaced the old ones)
- **Files:** preload.js:22 (`openDirectory`), 25 (`openPath`), 18–19 (`getWindowState`/`saveWindowState`), 32–34 (`onVisibilityChange`); main.js:154–160, 192–194, 304–307
- **Details:** Renderer grep confirms **zero callers** for `openDirectory`, `openPath`, `getWindowState`, `saveWindowState`, `onVisibilityChange`. Main's `window:visibility-change` receiver (304–307) is empty, and nothing ever sends that channel in either direction — the intended minimize→pause-animation pipeline simply doesn't exist (ties into C-2/N-14). Unhandled-channel invokes hang ~30 s; unused ones are pure attack/maintenance surface.
- **Fix:** Delete unused preload exports + their handlers, or wire them. Given N-14, simplest correct move: implement minimize/restore sends and use `onVisibilityChange` for the canvas, deleting the redundant document-hidden path ambiguity.

#### N-13: Hardcoded VENV_PYTHON (prior C-1) plus declaration-order trap
- **File:** main.js:310 (declaration), 199 (first use)
- **Fix:** Resolve at startup with fallback chain and fail loudly:
```js
function resolvePython() {
  return process.env.POLYWAV_PYTHON
    || path.join(app.getPath('userData'), 'bin', 'python.exe') // configured location
    || 'python'; // PATH fallback
}
const VENV_PYTHON = resolvePython();
```
Move declaration above the `file:probe` registration.

#### N-14: Canvas rAF loop never pauses on hide (prior C-2 remainder)
- **File:** index.html:4411–4496
- **Fix:**
```js
var animId; function draw(){ ...; animId=requestAnimationFrame(draw); }
document.addEventListener('visibilitychange', function(){
  if (document.hidden) cancelAnimationFrame(animId); else animId=requestAnimationFrame(draw);
});
```
Optionally wire the existing (dead) `window:visibility-change` IPC for minimize coverage and delete the empty receiver at main.js:304–307.

### ⚪ LOW

#### N-15: `sandbox:false` unnecessary (prior I-1) — main.js:71. Preload needs only `contextBridge`+`ipcRenderer`. Set `sandbox:true`.

#### N-16: Remote Google Fonts + no CSP — index.html:7–8. Offline launch loses typography; CDN compromise = script/style injection into a webSecurity-disabled renderer. Self-host Inter/JetBrains Mono locally and ship woff2 in the app; add CSP meta (see N-2 fix).

#### N-17: Recent-files persistence mangles HTML-ish filenames & trusts schema blindly — index.html:4817–4847. Names rendered via innerHTML then saved back from `textContent`, so `Ch1<img>x.wav` persists as mangled text; `loadRecentFiles` accepts any JSON (strings → literal "undefined"); one bad item aborts the rest silently inside try/catch. Fix: build items with `textContent`, validate `item && typeof item.name==='string'`, wrap `JSON.parse` per-item.

#### N-18: localStorage settings have no schema version/migration — index.html:5879–5914. `polywav-settings` merges stored-over-defaults forever; renamed/re-typed keys (e.g. bitDepth `'auto'`↔`'24'` semantics) silently keep stale values; corrupt JSON is swallowed with zero telemetry. Add `schemaVersion` + migration step; `console.warn` on parse failure; consider `navigator.storage.persist()`.

#### N-19: Dead code — index.html:4314–4336 (`updatePreview`/`updateSummary` reference legacy route UI, never called except internally), 4384–4393 (mock `setMode`/`setEssence` shadowed by state-backed versions at 5952–5965 — same duplicate-definition pattern prior audit caught for exportCLI), main.js:421–427 ("DevTools protection" is a commented-out no-op). Delete all three blocks.

#### N-20: Path/argument validation gaps in main process — main.js:192–194 (`shell:openPath` opens any renderer-supplied path), 251–301 (`file:readFileHeader` reads first 4KB of any path), 320–326 (renderer-supplied `mode/subtype/essence/clipName/routing` passed into argv without allow-listing; a value like `--something` is argument injection into the python CLI). Low risk standalone (renderer is our own code) but each widens the N-2 blast radius. Fix: allow-list enums server-side; require `fs.existsSync` + extension check for paths; reject argv values starting with `-`.

#### N-21: CLI preview string doesn't quote paths — index.html:5177–5179. `polywav embed-aaf -i C:/dir with spaces/a.wav ...` copied via `copyCLI` breaks. Quote `inPath`/output and note it's display-only.

#### N-22: User-supplied regex compiled on every cell render — index.html:3601–3620. Pathological pattern + long BEXT name = ReDoS freezing the UI thread. Cache compiled RegExp per pattern string and bound input length.

---

## PART 3 — Focus-area cross-check (as requested)

1. **IPC attack surface:** All spawns use array args, no `shell:true` → no classic command injection even with quotes/metachars in filenames (verified main.js:199, 328, 404). Real issues are argument injection (N-20) and unvalidated fs/openPath reachability (N-20), both amplified by N-1/N-2.
2. **innerHTML/XSS:** Traced all 24 `innerHTML` occurrences. Escaped only: export log (5319). Unescaped dynamic: 3882, 3890–3895, 5025, 5417, 5453, 4538, 4712, 4771, 4843, 6483–6493 → N-2.
3. **Export cancel/taskkill:** Tree-kill correct in mechanism; race + PID-reuse + missing cancelled-event → N-4; quit-path cleanup missing → N-6.
4. **Progress stream:** Partial-line tearing, `\r`, memory growth → N-7.
5. **localStorage fragility:** Corrupt JSON handled (silent); no versioning/migration; recent-list shape unchecked; DOM-round-trip corruption → N-17, N-18.
6. **Listener leaks:** `onMaximizeChange` per-click leak (N-10); tab-content listeners re-created on fresh nodes each render (OK, GC-able); document-level listeners registered once (OK).
7. **electronAPI undefined:** Handled well overall (`eIPC` null-guard, browser fallbacks for browseDir→prompt, doExport→clipboard). Note: `prompt()` fallback would throw in Electron itself but only runs when electronAPI is absent — acceptable. Residual: none blocking. LOW.
8. **Races:** Double-click Export guarded by `_exporting`+main-side lock, but failure leaves stuck UI (N-8); probe-during-probe stale overwrite (N-5); cancel-during-completion (N-4); tab-switch timer (N-9).
9. **Window-state edge cases:** Off-screen restore, maximized-bounds save, type validation → N-11.
10. **Dead code/IPC:** N-12, N-19.
11. **Navigation hardening:** None present → N-3.
12. **eval/remote content:** No eval/new Function/remote scripts. Remote fonts only (N-16). No `iframe`/`webview` tags found.

---

## Top 10 priority fixes

| # | Finding | Effort | Impact |
|---|---------|--------|--------|
| 1 | N-2 Escape every dynamic innerHTML injection (esp. BEXT names at 3882 et al.) | S | Kills the realistic attack chain from client WAVs |
| 2 | N-1 Remove `webSecurity:false` (main.js:70) | XS | Restores SOP; neutralizes exfil/read primitives |
| 3 | N-3 Add setWindowOpenHandler deny + will-navigate guard (+ CSP meta) | S | Blocks XSS pivot to remote/phishing content |
| 4 | N-4 Cancelled-state flag + cancelled event + PID-liveness check before taskkill | M | Correct UX, no failed-after-cancel lies, no PID-reuse kills |
| 5 | N-6 `before-quit` tree-kill of running export | XS | No orphaned python / locked output files |
| 6 | N-5 Probe epoch guard against stale async overwrite | XS | Prevents exporting wrong-file routing metadata |
| 7 | N-13 Runtime Python resolution replacing hardcoded path | S | App works off this machine & packaged |
| 8 | N-8 Reset progress/badge UI on failed export start | XS | No stuck "running" state |
| 9 | N-7 Line-buffered stdout parsing + capped buffers | S | Clean progress logs, robust long exports |
| 10 | N-10+N-12 Preload listener hygiene: return removers, register once, delete dead channels | S | Stops leak; shrinks attack surface |

*(XS <30 min, S <half day, M ~1 day)*

— End of report —
