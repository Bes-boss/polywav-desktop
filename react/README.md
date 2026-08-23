# PolyWAV React Shell (`desktop/react/`)

Parallel React + TypeScript + zustand implementation of the shipping HTML app
(`desktop/index.html` + `desktop/app.js`), per `desktop/REACT-MIGRATION.md`.

**Status (2026-08-22):** scaffolded, all screens built, builds green, contract
tests green. Cutover (`POLYWAV_UI=react`) NOT yet flipped — parity side-by-side
review comes first (see Sequencing §7 in REACT-MIGRATION.md).

## Run

```bash
cd desktop/react
npm install
npm run dev        # vite dev server :5173 (mock bridge, no Electron needed)
npm run build      # tsc + vite build → dist/
npm run preview    # serve the built dist (used for offline review)
```

In Electron: `POLYWAV_UI=react npm start` loads `react/dist/index.html`
(packaged: `react-dist/index.html`); `POLYWAV_DEV_SERVER=http://localhost:5173`
loads the dev server (both env-gated in `main.js`).

## Layout

```
src/
  api/electron.ts      typed bridge over window.electronAPI + MockBridge fallback
  store/settings.ts    zustand+persist → localStorage['polywav-settings'] (exact keys)
                       + recents → localStorage['polywav-recents'] (cap 10)
  store/session.ts     folder/takes/routing rows/export queue/toasts
  store/ui.ts          tab, overlays, theme
  lib/normalize.ts     parseName / applyTemplate (mirrors app.js)
  data/demo.ts         EP03 shoot day mock (T01-T05 14ch, T06 94ch), groups, AO colors
  routes/              HomeView, NormalizeView, RouteView, PatchView, ExportView
  components/          BatchStrip, SettingsOverlay, IngestWizard, ToastStack
  styles/app.css       shipping app's dark UI vocabulary + self-hosted fonts
```

## Contract compliance

- **One bridge:** privileged access only through `api/electron.ts` →
  `window.electronAPI`. No ipcRenderer/Node/fs in src (B11c lints this).
- **Same storage keys:** `polywav-settings`, `polywav-recents` with merge-
  saved-over-defaults semantics (unknown keys dropped).
- **CSP:** `script-src 'self'`; fonts self-hosted (bundled .woff2); no remote
  origins in the built bundle.
- **Batch (design decision 2026-08-22):** drop zone accepts a shoot-day folder;
  `BatchStrip` (folder chip + take chips) sits above Normalize/Route/Patch/
  Export; one routing template applies to every take; export queues one job per
  take (6 takes → 6 AAFs). Mock bridge simulates the engine.

## Tests

```bash
node tests/contract.test.js        # 70 shipping contracts (root desktop/tests)
node tests/contract-react.test.js   # 5 React-shell contracts (B11.*)
cd react && npm run build            # must succeed before contract check

# End-to-end: full user journey against the built shell (browser + mock bridge)
python tests/e2e_flow.py http://localhost:4174/     # 25 checks: load→normalize→route→patch→export→settings→wizard

# Real Electron smoke: launches the app twice (default + POLYWAV_UI=react),
# asserts both shells render with zero console errors
python tests/e2e_smoke.py             # needs: python + playwright in PATH (use hermes venv python)
```

Status (2026-08-22 night): all suites green — 70/70, 5/5, 25/25, 2/2.

## Polish pass (same night, per Liam's morning goal)

- Custom SVG icon set (`src/components/icons.tsx`) — no glyphs/emoji anywhere;
  includes hand-drawn patch-bay, route, normalize, sparkle, window controls.
- Tab transitions: fade/slide view enters, staggered card reveals, animated
  tab underline, icon lift on hover, drop-zone pulse ring, live status dot.
  Respects `prefers-reduced-motion`.
- Patch bay rewired: cables are measured from actual chip/track pill DOM
  positions (ResizeObserver + re-measure on routing change), gravity sag,
  one landing jack per track with fan-in, temp cable follows the drag.
- Undo/redo history stack (Route + Patch, buttons + Ctrl+Z / Ctrl+Shift+Z),
  Auto-assign/Clear header buttons.
- Empty states per tab, fatal ErrorBoundary, toast gating via showToasts,
  maximize-state swap, export Cancel, light theme actually flips the page
  background + boosted contrast.

## Known gaps (after clone, for the change pass)

- Real engine calls flow through the same `api` surface (MockBridge in
  browser); per-take Q is wired, verify against a real polywav in Electron.
- Patch SVG is pixel-based on measured rects; on very narrow windows the
  source lane may clip — acceptable to date (min app width 1100px).
- AAF stacking (one timeline per shoot day, one track per clip, time-of-day)
  is implemented in the mock/UI layer; the real exporter flag is `--stack`.
- Export options panel still shows the MXF folder field in Embedded mode
  (UI only hides it in the real shell); naming template input truncates in
  the 340px card on longer templates.