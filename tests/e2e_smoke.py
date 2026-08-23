"""E2E smoke test for the Polywav desktop app (additive, pre-switch gate).

Launches the REAL Electron app twice:
  1. default env  -> shipping shell (validates preload v1.2 + main.js additive edits)
  2. POLYWAV_UI=react -> React shell (validates env gating + file:// load of dist)

Run: python tests/e2e_smoke.py   (needs the hermes venv python with playwright)
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
SHOTS = Path(r"C:\Users\Liam\workspace\polywav\sketches\002-routing-wireframe\shots\react")

results = []


def wait_port(port: int, timeout: float = 45.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def close_tree(proc) -> None:
    try:
        proc.terminate()
        proc.wait(timeout=8)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def launch(env_extra: dict, port: int, mode: str) -> None:
    # Isolated userData per shell (single-instance lock scopes to userData).
    ud = DESKTOP / "tests" / ".user-data" / ("smoke-" + mode)
    ud.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, **env_extra, "POLYWAV_USER_DATA": str(ud)}
    proc = subprocess.Popen(
        [str(ELECTRON), ".", f"--remote-debugging-port={port}"],
        cwd=str(DESKTOP), env=env,
    )
    out = {"mode": mode, "ok": False, "checks": [], "errors": []}
    try:
        if not wait_port(port):
            out["errors"].append("devtools port never came up")
            results.append(out)
            close_tree(proc)
            return

        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
            ctx = browser.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            console_errors = []
            page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

            page.wait_for_load_state("load")
            page.wait_for_timeout(1500)

            title = page.title()
            out["title"] = title

            if mode == "react":
                h1 = page.locator("h1").first.inner_text()
                out["checks"].append(("h1", h1, "Polywav Ingest" in h1))
                tabs = page.locator(".tab-bar .tab").count()
                out["checks"].append(("tabs", tabs, tabs == 5))
                orbs = page.locator(".orb").count()
                out["checks"].append(("orbs", orbs, orbs == 3))
                root_ok = page.locator("#root > *").count() > 0
                out["checks"].append(("root-rendered", None, root_ok))
                page.screenshot(path=str(SHOTS / "e2e-react.png"))
            else:
                h1 = page.locator("h1").first.inner_text()
                out["checks"].append(("h1", h1, "Polywav Ingest" in h1))
                surface = page.evaluate(
                    "() => ({"
                    " bridge: typeof window.electronAPI === 'object',"
                    " probe: typeof window.electronAPI?.probeFile === 'function',"
                    " unsub: typeof window.electronAPI?.onExportProgress() === 'function',"
                    "})"
                )
                for k, v in surface.items():
                    out["checks"].append((k, v, v is True))
                page.screenshot(path=str(SHOTS / "e2e-default.png"))

            out["checks"].append(("console-errors", len(console_errors), len(console_errors) == 0))
            out["errors"].extend(console_errors[:3])
            out["ok"] = all(c[2] for c in out["checks"])
    except Exception as e:  # noqa: BLE001
        out["errors"].append(repr(e))
    finally:
        results.append(out)
        close_tree(proc)


if __name__ == "__main__":
    launch({}, 9225, "default")
    launch({"POLYWAV_UI": "react"}, 9226, "react")

    print(json.dumps(results, indent=2))
    failed = [r for r in results if not r["ok"]]
    print(f"\n{'PASS' if not failed else 'FAIL'} — {len(results) - len(failed)}/{len(results)} shells ok")
    sys.exit(1 if failed else 0)