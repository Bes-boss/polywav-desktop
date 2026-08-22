# REACT-MIGRATION.md — Parallel-Shell Contract

**Status:** planning contract (2026-08-22). No React code exists yet; nothing here
changes the shipping HTML app. This doc is the agreement a React shell must honor
so it can be built *beside* the current UI without breaking anything.

---

## 1. Ground rules (non-negotiable)

1. **Nothing is destroyed.** `index.html` + `app.js` remain the default UI until
   the React shell reaches feature parity and Liam signs off on a cutover.
2. **One bridge.** All privileged access goes through `window.electronAPI`
   (exposed by `preload.js`). The React tree never touches `ipcRenderer`, Node,
   or `fs` directly — same rule the HTML app follows today (sandbox: true).
3. **Same storage keys.** Both UIs read/write the identical persisted state so a
   user can switch between them without losing settings:
   - `localStorage['polywav-settings']` — see §3
   - `localStorage['polywav-recents']` — recent-file list (JSON array)
4. **CSP holds.** The shipped CSP is `script-src 'self'`. The React app ships as
   pre-built static JS (Vite build), never an inline `<script>` or eval-based
   stack. Dev-server/HMR mode is allowed only when explicitly enabled by env
   var in main.js (see §6).

## 2. Coexistence architecture

```
desktop/
  index.html          ← current app (untouched, default)
  react/              ← new Vite + React + TS project root
    src/
      api/electron.ts ← typed wrapper over window.electronAPI (§4)
      store/          ← zustand stores mirroring §3 shapes
      routes/…        ← components mapped from current screens (§5)
  main.js             ← loads index.html OR react/dist/index.html
```

Selection rule in main.js (small, additive change — implement when scaffolding):

```js
const ui = process.env.POLYWAV_UI === 'react'
  ? 'react-dist/index.html'   // built output copied to resources/react-dist
  : 'index.html';             // today's default
mainWindow.loadFile(ui);
```

No routing library is needed across shells; the choice is made once per launch.

## 3. State contract (mirror of app.js `SETTINGS`)

Source of truth: `DEFAULT_SETTINGS` in `app.js`. React must use these exact
key names, types, and defaults:

| key | type | default | notes |
|---|---|---|---|
| `mode` | `'group' \| 'sequence' \| 'mixed'` | `'group'` | track grouping |
| `essence` | `'embedded' \| 'external' \| 'mxf'` | `'embedded'` | export essence |
| `sampleRate` | `'auto' \| '48000' \| '96000' \| '192000'` | `'auto'` | |
| `bitDepth` | `'auto' \| '16' \| '24' \| '32'` | `'24'` | |
| `presetName` | string | first library preset name | display only; save/load goes through presets API |
| `namingTemplate` | string | `'{prefix}_{role}_{num}'` | tokens resolved engine-side |
| `mixGain` | number | `-3` | dB |
| `outputAafDir` | string | `'./output'` | |
| `outputMxfDir` | string | `'./output/mxf'` | used when `essence==='mxf'` |
| `showRawBext` | boolean | `true` | |
| `autoAssign` | boolean | `true` | |
| `showToasts` | boolean | `true` | |
| `confirmExport` | boolean | `true` | |

Persistence semantics: merge-saved-over-defaults (unknown keys dropped), write
on every change (the HTML app's exact behavior). Recents: array of
`{ name, path }`, deduped by path, most-recent first, capped (HTML app caps at
10) — click re-probes `path`.

## 4. IPC contract (`window.electronAPI`)

Typed wrapper requirement: `api/electron.ts` exposes promise-returning methods
and returns unsubscribe functions for every `on*` subscription. React effects
MUST clean up subscriptions on unmount.

### Invoke channels (request/response)

| method | args → result | notes |
|---|---|---|
| `minimizeWindow()` / `maximizeWindow()` / `closeWindow()` | — | frameless chrome |
| `openDirectory()` | → `{ canceled?, filePaths? }` | dialog |
| `openDirectoryWithDefault(path)` | → same | remembers last dir |
| `openFile()` | → same | WAV picker |
| `presetsList()` | → `{ presets: [{name}] , error? }` | two-tier store (user-writable + bundled RO) |
| `presetsRead(name)` | → yaml text or `{ error }` | |
| `presetsSave({name, yaml})` | → `{ ok } \| { error }` | safe-name validated main-side |
| `presetsDelete(name)` | → `{ ok } \| { error }` | bundled presets refuse delete |
| `presetsExport({name})` | → save-dialog result | |
| `presetsImportOpen()` | → open-dialog + copy into user store | |
| `probeFile(path)` | → `{ channels, sampleRate, bitsPerSample, frames, format }` or `{ error }` | runs engine probe |
| `readFileHeader(path)` | → parsed fmt/bext summary or `{ error }` | |
| `exportStart(config)` | → `{ started: true }` or `{ error }`; single job at a time | config = clipName, routing, mode, sampleRate, subtype, essence, mxfDir, inputPath, outputPath |
| `exportCancel()` | → cancels active child; reports `export:cancelled`, NOT error (Audit N-4a) | |

### Push events (main → renderer)

| channel | payload | React handling |
|---|---|---|
| `window:maximize-change` | `boolean` | chrome button icon state |
| `export:progress` | `{ jobId, line }` | append to streaming log view |
| `export:complete` | result object | terminal success state |
| `export:error` | error object/string | terminal failure state |
| `export:cancelled` | payload | terminal neutral state (not an error) |

Preload v1.2 note (required before React wiring): `on*` helpers should also
return an unsubscribe closure. Additive change; existing HTML app unaffected.

## 5. Screen → component map (parity checklist)

| Current screen/feature (app.js) | React component (proposed) |
|---|---|
| Drop zone + file load/recents | `FileLoadPanel`, `RecentsList` |
| Parse table (channel map, drag/drop, chips) | `ChannelMapTable`, `TemplateChips` |
| Route tab | `RoutingBoard` |
| Normalize tab | `NormalizeControls` |
| Export tab + progress log | `ExportPanel`, `ProgressLog` |
| Settings overlay | `SettingsOverlay` (+ segmented controls) |
| Ingest wizard (5-step) | `IngestWizard` |
| Preset library row/dropdown | `PresetLibraryBar` |
| Toasts | `ToastStack` (respects `showToasts`) |
| Fatal-error overlay (#fatalError) | `ErrorBoundary` (top-level class boundary) |

## 6. Dev/build workflow

- Dev: `npm run dev` inside `react/` runs Vite on :5173; main.js honors
  `POLYWAV_DEV_SERVER=http://localhost:5173` by `loadURL` instead of `loadFile`
  (additive, env-gated — implement with scaffolding step).
- Build: `vite build` outputs `react/dist`; packaging copies it to
  `resources/react-dist` alongside `resources/engine` (extraResources entry).
- Gates: existing 70 contract tests keep passing untouched; add `B11.*`
  contracts when the shell lands (bundle exists, no remote origins, bridge-only
  privileged access lint rule).

## 7. Sequencing

1. Wireframe pass (blocked ticket `ui-wireframe`) — done WITH Liam.
2. Scaffold `react/` (Vite, TS, zustand) — additive files only.
3. Bridge wrapper + stores against §3/§4 contracts, unit-tested.
4. Screens in §5 order: FileLoad → Export → Parse → Route → Normalize → overlays.
5. Parity review side-by-side; cutover flip (`POLYWAV_UI`) only on sign-off.
