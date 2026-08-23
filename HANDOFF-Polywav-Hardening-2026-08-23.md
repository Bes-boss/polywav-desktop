# Handoff — Polywav Desktop Hardening & React Parity

**Date:** 2026-08-23 · **Source session:** WebUI 843f09b2c954

## TL;DR

React parity pass done, visual sign-off passed, 6 cross-shell diffs fixed. Backend
hardened with 12 structural protections (single-instance lock, atomic writes, probe
timeout, bounded fan-out, export validation, permission lockdown, more). All gates
green: 87 contracts, 26/26 flow, 2/2 smoke, live IPC, 21/21 parity × 2 shells.
The shell is flip-ready; the flip itself needs your eyeballs on a real shoot folder.

## PRE-APPROVED (next session can do without asking)

- Run any/all test suites (commands in RELEASE-CHECKLIST.md)
- Run `npx electron-builder --win` to produce the NSIS installer
- Push commits if you've reviewed the diff
- Update the `.hermes/plans/20260823_190000-polywav-hardening-continuation.md` plan doc

## STILL NEEDS HUMAN

- **Flipping POLYWAV_UI=react** — change the default in `main.js` (search
  `POLYWAV_UI`) after you've run `START-REACT-SHELL.cmd` on a real shoot folder
- **Deleting the legacy one-off audit scripts** in `tests/` (see plan P3)
- **Publishing to remote** — no remote configured in my scope
- Any changes outside `polywav/desktop/`

## What was done this session

### React parity fixes (6 diffs found + fixed)

1. **Cross-shell localStorage corruption** — zustand persist envelope vs
   shipping bare-values format. New `raw*Storage` adapters byte-compatible both
   ways for `polywav-settings`, `polywav-recent`, `polywav-theme`.
2. **Settings never rehydrated** — merge hook read the wrong layer.
3. **Hero/drop-zone stayed after load** — now unmount like shipping; recents
   stay visible above card.
4. **Toast bottom-right → bottom-center** (shipping placement).
5. **Load-time auto-assign + demo names** — real shell now uses neutral
   `Channel 0N` fallback and no auto-assign on load (wizard/Auto-assign button
   only).
6. **Preset dropdown raw stems → YAML names** with optgroup tiers and CRLF-safe
   label extraction.

### Backend hardening (main.js + session.ts)

| # | Area | Fix |
|---|------|-----|
| 1 | Concurrency | Single-instance lock via `requestSingleInstanceLock` |
| 2 | Data integrity | `atomicWriteFileSync` — no truncated config/preset on crash |
| 3 | Engine timeout | `file:probe` kills child after 20s, resolves clean error |
| 4 | Fan-out | Probe concurrency capped at 4 parallel workers |
| 5 | Export safety | `export:start` validates input exists + creates output dir |
| 6 | Cancel | `export:cancel` now sends `export:cancelled` event to renderer |
| 7 | Permissions | `setPermissionRequestHandler` → deny all |
| 8 | Navigation | `will-navigate` locked to our own `index.html` |
| 9 | Portability | `POLYWAV_USER_DATA` env for test/portable isolation |
| 10 | Directory scan | `fs:listWavs` uses `withFileTypes` to skip subdirectories |
| 11 | Dead channels | `shell:openPath` removed from main.js + preload.js |
| 12 | Test isolation | All test harnesses set isolated `POLYWAV_USER_DATA` |

### New test files

- `tests/contract_backend.test.js` — 12 checks pinning every hardening item
- `tests/visual_parity.py` — 8 states × 2 shells, 21-feature probe, console sweep
- `tests/ipc_roundtrip.py` — live Electron + real WAVs through every bridge method
- `tests/.probe-files/` — 2 real WAVs with bext metadata (fixtures)
- `RELEASE-CHECKLIST.md` — Monday studio install procedure
- `START-REACT-SHELL.cmd` — one-double-click React shell launcher

### Updated files

- `main.js` — 12 hardening items (above)
- `preload.js` — `openPath` removed (dead channel)
- `react/src/store/settings.ts` — raw*Storage adapters + merge fix + migrate fn
- `react/src/store/ui.ts` — rawThemeStorage adapter + migrate fn
- `react/src/store/session.ts` — bounded probe concurrency, buildRows parity fix
- `react/src/styles/app.css` — toast position (bottom-center)
- `react/src/routes/HomeView.tsx` — hero collapse, recents above card
- `react/src/components/SettingsOverlay.tsx` — preset dropdown (optgroups, YAML names)
- `tests/visual_parity.py` — isolated userData per shell
- `tests/e2e_smoke.py` — isolated userData per shell
- `tests/ipc_roundtrip.py` — isolated userData
- `tests/e2e_flow.py` — hero unmount fixes (recent click, wizard reload)
- `.gitignore` — test artifacts + shots
- `package.json` — launcher in files array
- `.hermes/wayfinder/polywav-desktop/tickets/react-parity.md` — resolved + sign-off

### Verification state (last complete run)

| Gate | Result |
|------|--------|
| `node --check main.js` | PASS |
| `node tests/contract.test.js` | 70/70 |
| `node tests/contract-react.test.js` | 5/5 |
| `node tests/contract_backend.test.js` | 12/12 |
| `python tests/e2e_flow.py` (preview server) | 26/26 |
| `python tests/e2e_smoke.py` | 2/2 shells |
| `python tests/ipc_roundtrip.py` | PASS |
| `python tests/visual_parity.py` | 21/21 × 2 shells, console clean |
| `npm run build` (React) | ✓ 228 kB JS, 35 kB CSS |

## RETRACTED findings (don't chase these)

1. ~~React settings never persisted at all~~ — they did, but the merge hook
   read the wrong layer (raw payload vs persisted envelope). Fixed in same pass.
2. ~~Will-navigate hardening was sufficient~~ — it blocked `http://` but allowed
   any `file://` URL, meaning a crafted renderer XSS could load arbitrary local
   HTML. Now locked to `index.html` only.
3. ~~loadFolder runs all probes simultaneously~~ — was `Promise.all(probeFile)`.
   Now bounded at 4 concurrent workers. Noticed during the hardening pass.

## Parked items (don't get pulled in)

- **Ingestigator HEADLESS-WEBAPP transfer** — separate repo, separate context.
  The studio machine Monday plan includes both tools but this handoff is
  **Polywav only**.
- **Wayland/Linux support** — frameless window + `backgroundColor` are
  Electron-API only; would need a platform guard when cross-platform starts.
- **Auto-updater** — not wired. electron-builder NSIS generates no auto-update.
  If needed later, `electron-updater` is the standard path.

## How to resume

1. Read `RELEASE-CHECKLIST.md` for the studio install procedure
2. Run `START-REACT-SHELL.cmd` against a real shoot folder
3. If satisfied, flip `POLYWAV_UI` default in `main.js` (one line)
4. Run `npx electron-builder --win` for the installer (pre-approved)
5. Clean up legacy test scripts if desired (P3 in the plan doc)

The full continuation plan: `.hermes/plans/20260823_190000-polywav-hardening-continuation.md`