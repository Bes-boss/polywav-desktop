# PolyWAV Desktop — Full App Analysis (2026-08-22)

Companion to REACT-MIGRATION.md. Captures the shipping HTML app's exact per-tab
structure, CSS vocabulary, and behaviors so the React shell can clone it 1:1.

## Global chrome

- **Sticky header** (`#stickyHeader > .header-inner`): left = `h1` "Polywav Ingest"
  (tomato `.dot` before), subtitle line (``<strong>…</strong> · status text``);
  right = status pill `.status` (● + meta), Export `.header-action-btn` (svg),
  Settings `.settings-btn` (gear svg), `.window-controls` with `.win-btn` ×3
  (min ─, max □, close ✕).
- **Tab bar** `.tab-bar` (role=tablist): `justify-content:center`, gap 2px, tabs
  are BUTTONS `.tab` with `.tab-icon` (⌂ ✎ → ▣ ⇩) + uppercase label
  (`text-transform:uppercase; letter-spacing:.6px; padding:10px 24px`);
  active = `--tomato` text + 2px tomato bottom border. Tabs: home, normalize,
  route, patch, export. Switching = `switchTab()` toggles `.tab-content.active`
  (fade/slide 0.4s) + `.tab-empty-state` vs `.tab-working` per tab.
- **Background**: 3 blurred `.app-orb` (tomato top-right, sage bottom-left, gold
  mid) + masked radial dot grid via `body::before` (+ `.app-canvas` canvas).
- **Theme**: dark default; `body.light-mode` overrides (`--bg-card:#fff` etc.).
  `toggleTheme()`; persisted in settings (`theme` key is in local state but not
  in DEFAULT_SETTINGS — applied from DOM class; see `toggleTheme`).
- **Toast**: single `#toast` div; `showToast(msg)` timed fade; respects
  `SETTINGS.showToasts`.
- **Fatal overlay**: `#fatalError.fatal-overlay` (hidden attr), `#fatalDesc`,
  Reload button. Shown by `window.onerror` boundary in app.js.
- **Win controls**: `window.electronAPI.minimizeWindow/maximizeWindow/closeWindow`;
  `onMaximizeChange` swaps max/restore glyph.

## Settings overlay (`#settingsOverlay .settings-panel`)

Sections (`.settings-section`, icon + `h3`):
1. **Appearance** — Theme segmented (`#themeDarkOpt/#themeLightOpt`).
2. **Export Mode** — Output structure segmented (group/sequence/mixed),
   Media format segmented (embedded/external/mxf), Sample rate `#srSelect`
   (auto/48k/96k/192k), Bit depth `#bdSelect` (auto/16/24/32).
3. **Presets** — `#presetSelect` active preset; manage row: `#presetNameInput`
   + Save/Export/Import/Delete buttons (`.preset-actions-row`, btn-danger);
   `#namingTemplateInput` default template.
4. **General** — toggles `.toggle-switch`: `#rawBextToggle` (show raw names),
   `#toastToggle` (toasts).
Footer: version text, Cancel `#settingsCancelBtn` (re-load), Apply
`#settingsApplyBtn` (save + apply).

Settings flow: `loadSettings()` merges saved JSON over `DEFAULT_SETTINGS`
(unknown keys dropped); `saveSettings()` writes `localStorage['polywav-settings']`
on every change; `syncSettingsUI()` reads state into controls; segmented active
state via `data-setmode` / `data-setessence`.

## Ingest wizard overlay (5 steps, `#wizardOverlay`)

`.wizard-modal`: header (✶ Setup Wizard + close), `.wizard-steps` dots
(1..5, numbered with dot+label, sep lines), `.wizard-body` panels
(`#wizStep0..4`, only `.active` shows), footer: left `#wizFooterLeft`
"Step X of 5", right Back/Next (`#wizBackBtn/#wizNextBtn`, `.wizard-btn`, Next
`.primary`).

- **Step 1 — Project template** `#wizStep0`: 4 `.wizard-tmpl-card`
  (`.tmpl-icon/.tmpl-name/.tmpl-desc`): Panel Show 📺, Cooking Show 🍳,
  Music 🎵, Custom ⚙️.
- **Step 2 — Naming convention** `#wizStep1`: rows `.wizard-row`
  (`.row-label/.row-desc` left, `.row-control` right): `#wizNamingTemplate`
  (e.g. `{prefix}_{role}_{num}`), `#wizSeparator` (_ - . space), preview
  `#wizNamingPreview` (e.g. `ISO_Presenter_01`).
- **Step 3 — Track routing defaults** `#wizStep2`: `#wizAutoAssign` toggle,
  `#wizTrackGroup` select (A1-A8/A9-A16/A17-A24/A25-A32), `#wizMixGain` number
  (default -3, step .5, range -24..6).
- **Step 4 — Export preferences** `#wizStep3`: `#wizMode`, `#wizEssence`,
  `#wizSampleRate`, `#wizBitDepth`, `#wizAafDir` (`./output`), `#wizMxfDir`
  (`./output/mxf`).
- **Step 5 — Summary & save** `#wizStep4`: `.wizard-summary` (generated
  YAML text); save writes preset via presetsSave + applies settings.

## Tab: Home

- `.hero-wrap` with parallax; `.hero-content`: eyebrow "Audio Ingest Pipeline",
  h1 "Polywav Ingest" + `.title-dot`, subtitle, hero desc; `.wizard-cta`
  button (✶ Setup Wizard · configure templates…).
- `.drop-zone` (drop + drag layers, ring, icon ⇩, "Drop it here", hint,
  `.drop-zone-btn` Browse files, hidden `#fileInput` accept .wav/.aaf/.mxf,
  `.drop-formats` chips .WAV .AAF .MXF).
- `.recent-section`: header "Recent files" + `#recentClearBtn` Clear;
  `#recentList` (items or `.recent-empty`); stored `localStorage['polywav-recents']`
  = array `{name,path}`, most-recent first, cap 10.
- `#fileLoadedCard` (hidden until load): `.fl-header` (♫ icon, "Loaded file"
  label + `#flFileName`, `#flNewBtn` ✕ Load new), `#flDetails` (probe stats),
  `.fl-actions` (Route channels primary, Normalize secondary, Export secondary).

**BATCH ADDITION (design decision 2026-08-22):** drop zone also accepts a FOLDER
(whole shoot day); detection lists every polywav take; the take strip (see Route)
is pre-populated. Single-file load still works unchanged.

## Tab: Normalize

- `.preset-panel` grid 2 cols:
  - `#regex-pattern` text input (default
    `^(?<prefix>[A-Z]+)_(?<role>[A-Za-z]+)_?(?<num>\d+)?$`) + hint about named
    groups.
  - `.template-chips` `#template-chips` (drag-reorderable chips for
    prefix/role/num/suffix slots, click to cycle options);
    hidden `#output-template` holds the string (persisted).
- Card "Normalization preview" (badge `#normChannelBadge`): `.parse-table`
  with draggable column headers: # / Raw channel / Prefix / Type / Role / # /
  Suffix / Normalized name (`#parse-tbody` rows built by `parseName()`).
- `.test-rename`: `#test-raw` input → `#test-result` live preview.

**Batch delta:** the strip (folder + takes) sits above `.preset-panel`; the
pattern/template apply to every take; preview shows per-selected-take.

## Tab: Route

- `.route-layout` grid `1fr 320px` gap 24:
  - Left card "Source channels" (`#routeSourceBadge` = count): `.routing-table`
    sticky thead (uppercase 11px) with columns: ☰ drag handle, `#` (`.ch-num`
    mono), Channel name (`.ch-name` + `.bext-tag` sage chip + `.raw-hint` raw
    name), `select.track-select` Avid track (option "" = "— Unassigned —", then
    A1..A64; `.assigned` = sage border), `.track-preview` (mono track name or
    italic "—"). Rows built by `renderRouteTab()` from `ROUTING_DATA`.
  - Right card "Track layout" (`#routeSummaryList`): `.summary-list` with
    `.summary-group-header` (tomato uppercase, chevron, collapsible via
    `toggleTrackGroup`) + rows (`.track-label`, `.track-count` chip).
    Track colors `AO_COLORS = ['#c4664a','#c8a96e','#7a9e8c','#7f8fa0',
    '#b088c8','#6ab0c0','#d4a76a','#9cb87e']` (cycle per group).
- `.bottom-bar`: left `.info` (`#routeInfoAssigned`/`#routeInfoTotal`,
  Structure `#routeInfoMode`, Media `#routeInfoEssence`); right: `#routeUndoBtn`
  ↺ Undo + `#routeRedoBtn` ↻ Redo (`.btn-undo/.btn-redo`, disabled unless
  snapshots), `+ Import` `.btn-secondary`, `⤓ Export for Avid` `.btn-primary`
  (nav to export).
- Undo/redo via snapshot stack (`pushSnapshot/undoAction/redoAction`),
  Ctrl+Z / Ctrl+Shift+Z.

**BATCH ADDITION:** `.batch-strip` under the tab bar: folder chip
(`D:\…\audio · N WAV detected`), take chips (`.take` T01..T06 + channel
counts, `.take.sel` = selected), right hint. Routing table = shared template
per selected take; every take renders the same rows; newly selected take with
more channels appends extra ISO rows. "Applied" semantics: template applies to
all takes (6→6 AAFs at export).

## Tab: Patch

- Card "Routing map": `.patch-map-head` with h2 + `.legend` (9 `.legend-item`
  swatches: tracks 1-8 #c4664a, 9-16 #c8a96e, 17-24 #7a9e8c, 25-32 #7f8fa0,
  33-40 #b088c8, 41-48 #6ab0c0, 49-56 #d4a76a, 57-64 #9cb87e, Unassigned
  dashed #ccc) + `.patch-undo-bar` (Undo/Redo).
- `.patch-map-wrap` 3 lanes:
  1. `.patch-lane#patchSrcLane` — "Source channels" + `#patchSrcList` chips,
     `.patch-drag-hint` "⇆ Drag to reorder · Drag to track to patch".
  2. `.patch-svg` middle — `#patchSvgEl` SVG bezier flow paths from source to
     group (`.patch-group-target`), drawn by `drawFlowPaths()`.
  3. Right `.patch-lane` — "Avid tracks" `#patchGroups` (`.patch-group` boxes,
     `.grp-label`, drop targets, channel chips), plus `#patchUnrouted`
     ".patch-unrouted-box" (Unassigned + `.unrouted-chips`).
- DnD: `setupPatchDnD()` HTML5 drag; temp cable follows mouse
  (`createTempCable/updateTempCable/removeTempCable`).

**Batch delta:** strip present; drag routing edits the template.

## Tab: Export

`.export-panel` grid (left column cards + right column cards + footer):

- Left: "Output summary" card — `.export-summary` `.line-item` rows
  (`#exportTotalChannels`, `#exportAssigned`, `#exportOutputTracks`,
  `#exportMode`, `#exportEssence`, `#exportSampleRate`, `#exportBitDepth`,
  `.total-row` `#exportSize` ~est GB). "Output destination" card —
  `#outputAafDir` + Browse `#browseAafDirBtn`, preview `#outputAafPreview`
  path; `#outputMxfDir` + `#browseMxfDirBtn`. "CLI command" card —
  `#exportCLI` code block + `#copyCliBtn` 📋 Copy (built by `buildCLICommand`).
- Right: "Export options" card — 3 radio labels `.export-option`
  (`input[type=radio]` + `.export-label/.export-desc`): Embedded in AAF /
  AAF + WAV / Avid MXF (OP-Atom). "Naming convention" card —
  `#output-template`-style text (default `{show}_{episode}_{prefix}_{role}_{num}`)
  + hint vars + preview (e.g. `MKR_104_HST_Host_1`). "Export log" card —
  `#exportStatusBadge` (ready/running/done/error), `.export-progress` bar,
  `#exportLog` mono scroll lines (from `export:progress` events).
- `.export-footer`: "Back to Route" secondary, `#exportBtn` ⤓ Export for Avid
  primary. `doExport()` builds config → `electronAPI.exportStart(config)`;
  confirm dialog when `SETTINGS.confirmExport`.

Config shape (IPC exportStart): `{ clipName, routing, mode, sampleRate,
subtype, essence, mxfDir, inputPath, outputPath }`.

**Batch delta:** summary shows per-take totals; footer shows "N takes → N AAFs";
export loop fires one job per take (queue, single job at a time).

## State contract (app.js)

`DEFAULT_SETTINGS` keys (see REACT-MIGRATION §3): mode, essence, sampleRate,
bitDepth, presetName, namingTemplate, mixGain(-3), outputAafDir('./output'),
outputMxfDir('./output/mxf'), showRawBext, autoAssign, showToasts,
confirmExport. Storage keys: `polywav-settings`, `polywav-recents`.

Engine data: `ROUTING_DATA` rows `{ch, group, track, …}`;
`HISTORY_STACK` undo/redo snapshots; `rawChannels[]` per file with
`caps = parseName(raw)`.

## IPC (preload v1.1; v1.2 adds unsubscribe returns)

- invoke: window controls ×3; openDirectory / openDirectoryWithDefault(path) /
  openFile; presetsList/Read/Save/Delete/Export/ImportOpen; probeFile(path)
  → `{channels,sampleRate,bitsPerSample,frames,format,channelNames?}`;
  readFileHeader(path) → fmt/data summary; exportStart(config) →
  `{jobId}`|`{error}`; exportCancel.
- push: window:maximize-change(bool); export:progress `{jobId,line}`;
  export:complete `{jobId,outputPath,stdout}`; export:error
  `{jobId,message,stderr}`; export:cancelled.
- back-ticks: none. Main engine: `polywav.cli` module or frozen exe; export
  cancel = taskkill /T /F.

## Clone rules for React (from Liam 2026-08-22)

1. Current app's look is the look: orbs, dot grid, cards 8px, uppercase
   mono labels, centered uppercase icon tab bar, tomato accent
   (#c4664a accent vs #d0714f lighter in earlier sketches — use #c4664a).
2. Build it as close as possible in ALL aspects; changes come AFTER parity.
3. Batch ingest (folder → takes → template routing → N AAFs) is the single
   planned addition; keep it visually quiet (strip under tab bar).