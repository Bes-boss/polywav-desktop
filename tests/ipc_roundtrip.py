"""Live IPC round-trip: real Electron React shell + real WAV files.

Verifies the parity-fix bridge additions actually work in a live shell:
  - fs:listWavs (directory scan) via window.electronAPI.listWavs
  - file:probe via window.electronAPI.probeFile (engine probe on a real file)

Run: python tests/ipc_roundtrip.py  (hermes venv python, playwright installed)
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

DESKTOP = Path(__file__).resolve().parent.parent
ELECTRON = DESKTOP / "node_modules" / "electron" / "dist" / "electron.exe"
PORT = 9333

def wait_port(port: int, timeout: float = 45.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2)
            return True
        except Exception:
            time.sleep(0.5)
    return False

def main() -> int:
    ud = DESKTOP / "tests" / ".user-data" / "roundtrip"
    ud.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "POLYWAV_UI": "react", "POLYWAV_USER_DATA": str(ud)}
    proc = subprocess.Popen(
        [str(ELECTRON), ".", f"--remote-debugging-port={PORT}"],
        cwd=str(DESKTOP), env=env,
    )
    try:
        if not wait_port(PORT):
            print("FAIL: devtools port never came up")
            return 1
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{PORT}")
            ctx = browser.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.wait_for_load_state("load")
            page.wait_for_timeout(1500)

            # Direct bridge calls — no UI interaction needed.
            listing = page.evaluate(
                "async (d) => await window.electronAPI.listWavs(d)",
                r"C:\Users\Liam\workspace\polywav\desktop\tests\.probe-files",
            )
            print("listWavs result:", json.dumps(listing))
            assert "wavs" in listing and len(listing["wavs"]) == 2, "listWavs broken"

            probe = page.evaluate(
                "async (f) => await window.electronAPI.probeFile(f)",
                r"C:\Users\Liam\workspace\polywav\desktop\tests\.probe-files\SHOT_A.wav",
            )
            print("probeFile result:", json.dumps(probe))
            assert probe.get("channels") == 2 and probe.get("sampleRate") == 48000, "probe broken"

            bad_dir = page.evaluate(
                "async (d) => await window.electronAPI.listWavs(d)",
                r"C:\Users\Liam\workspace\polywav\desktop\tests\does-not-exist",
            )
            print("listWavs bad-dir result:", json.dumps(bad_dir))
            assert "error" in bad_dir, "listWavs should error on missing dir"

            print("PASS — live bridge round-trip ok")
            return 0
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=8)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

if __name__ == "__main__":
    sys.exit(main())