# Polywav Desktop — Studio Machine Release Checklist

**Date:** 2026-08-23 (last hardened before Monday install)
**Branch:** current local commits (no pushes needed for install — run from workspace)

## Pre-install checks (on studio machine)

```bash
# 1. Ensure Node 20+ and npm
node --version   # need >=18

# 2. Install Electron + builder deps (one-time)
cd C:\path\to\polywav\desktop
npm install      # ~60s

# 3. Verify the engine sidecar exists
ls ..\dist\polywav-engine\   # should show polywav-engine.exe + raw2bmx.exe

# 4. Verify the React dist exists (already built)
ls react\dist\index.html
```

## Test gates to run (in this order)

```bash
cd C:\path\to\polywav\desktop

# 5. Backend syntax + contracts (12 checks)
node tests/contract_backend.test.js

# 6. Shipping contracts (70 checks)
node tests/contract.test.js

# 7. React contracts (5 checks)
node tests/contract-react.test.js

# 8. Electron smoke (both shells, 2/2)
python tests/e2e_smoke.py            # from hermes-agent venv

# 9. Live IPC round-trip (real bridge + real WAVs)
python tests/ipc_roundtrip.py        # from hermes-agent venv

# 10. Build the React shell (verify Vite builds clean)
cd react && npm run build
cd ..

# 11. Visual parity harness (21/21 features both shells + screenshots)
python tests/visual_parity.py

# 12. Flow test against preview server
cd react && npm run preview -- --port 4174 --strictPort &
cd .. && python tests/e2e_flow.py http://localhost:4174/   # expect 26/26
```

## Eyeball steps (need human judgement)

1. **Default shell** — `npm start` → load a real shoot folder → verify:
   - Recents work
   - Wizard walks 5 steps
   - Route table shows selectable tracks
   - Patch view lanes + cables
   - Export produces an AAF (check engine runs)

2. **React shell** — double-click `START-REACT-SHELL.cmd` → same tests:
   - Load same shoot folder
   - Compare every tab against the default shell
   - Check settings overlay (presets, theme, toggles)
   - Export test AAF

3. **Light theme** — toggle in settings on both shells, verify contrast

4. **Resize down to 900×600** — verify minimum size constraints work

## If both shells pass

```bash
# To make React the permanent default:
#   main.js line ~150: change the fallback from shipping to react
#   (search for 'POLYWAV_UI' — one env-GATE line, git-revertable)
```

## Known quirks (non-blocking)

- Toast: bottom-center (shipping parity)
- Batch ingest (React): probes 4 files at a time (concurrency limit), larger folders take a few seconds
- Single-instance lock: running two copies simultaneously requires `set POLYWAV_USER_DATA=...` to isolate
- Engine logs are capped at 5MB per export job
- CSP: strict `script-src 'self'` — inline event handlers in presets won't execute (intentional)