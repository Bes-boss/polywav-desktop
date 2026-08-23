"""Visual parity harness: shipping shell vs React shell, side-by-side.

Launches the REAL Electron app twice (default shell + POLYWAV_UI=react), seeds
identical localStorage, loads the same fixture data, then captures screenshots
of every view + overlay at a fixed 1440x900 viewport and probes the DOM feature
matrix. Screenshots land in shots/parity/<shell>/ for review.

Run: python tests/visual_parity.py  (hermes venv python, playwright installed)
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

DESKTOP = Path(__file__).resolve().parent.parent
ELECTRON = DESKTOP / "node_modules" / "electron" / "dist" / "electron.exe"
FIXTURES = DESKTOP / "tests" / ".probe-files"
SHOT_A = FIXTURES / "SHOT_A.wav"
ONE_DIR = FIXTURES / "one"
OUT = DESKTOP / "sketches" / "002-routing-wireframe" / "shots" / "parity"

VIEWPORT = {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False}

# DOM feature matrix: selector -> what it proves. Applied per shell on the live DOM.
FEATURES = {
    "shipping": {
        "hero": ".hero-title", "wizard-cta": "#wizardCta", "drop-zone": "#dropZone",
        "recents": "#recentList .recent-item", "loaded-card": "#fileLoadedCard",
        "norm-regex": "#regex-pattern", "norm-chips": "#template-chips",
        "norm-table": "#parse-table", "norm-test": "#test-raw",
        "route-table": "#routeTableBody", "route-summary": "#routeSummaryList",
        "route-bar": "#routeBarInfo", "route-undo": "#routeUndoBtn",
        "patch-lane-src": "#patchSrcLane", "patch-svg": "#patchSvg",
        "patch-lane-dst": "#patchGroups", "patch-unrouted": "#patchUnrouted",
        "patch-undo": "#patchUndoBtn",
        "exp-aaf-dir": "#outputAafDir", "exp-mxf-dir": "#outputMxfDir",
        "exp-cli": "#exportCLI", "exp-log": "#exportLog",
        "exp-btn": "#exportBtn", "exp-progress": "#exportProgress",
        "set-theme": "#themeDarkOpt", "set-sr": "#srSelect", "set-bd": "#bdSelect",
        "set-presets": "#presetSelect", "set-preset-actions": "#presetSaveBtn",
        "set-naming": "#namingTemplateInput", "set-bext": "#rawBextToggle",
        "set-toast": "#toastToggle",
        "wiz-steps": ".wizard-step-panel", "wiz-templates": ".wizard-tmpl-card",
        "wiz-summary": "#wizSummary", "fatal": "#fatalError", "toast": "#toast",
    },
    "react": {
        "hero": ".hero-title", "wizard-cta": ".wizard-cta", "drop-zone": ".drop-zone",
        "recents": ".recent-item", "loaded-card": ".file-loaded-card",
        "norm-regex": ".preset-field input", "norm-chips": ".template-chips",
        "norm-table": ".parse-table", "norm-test": ".test-rename",
        "route-table": ".routing-table", "route-summary": ".summary-list",
        "route-bar": ".bottom-bar", "route-undo": ".btn-undo",
        "patch-lane-src": ".patch-lane", "patch-svg": ".patch-cable-svg",
        "patch-lane-dst": ".patch-chips", "patch-unrouted": ".exp-un-chips",
        "patch-undo": ".patch-undo-bar",
        "exp-aaf-dir": ".out-dir-row input", "exp-mxf-dir": ".out-dir-row",
        "exp-cli": ".cli-code", "exp-log": ".log-box",
        "exp-btn": ".export-footer .btn-primary", "exp-progress": ".export-progress",
        "set-theme": ".segmented", "set-sr": "select", "set-bd": "select",
        "set-presets": "select", "set-preset-actions": ".preset-actions-row",
        "set-naming": "input", "set-bext": ".toggle-switch",
        "set-toast": ".toggle-switch",
        "wiz-steps": ".wizard-step-panel", "wiz-templates": ".wizard-tmpl-card",
        "wiz-summary": ".wizard-summary", "fatal": ".fatal-overlay", "toast": ".toast",
    },
}

TABS = ["home", "normalize", "route", "patch", "export"]


def wait_port(port: int, timeout: float = 45.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def launch(env_extra: dict, port: int) -> subprocess.Popen:
    # Isolated userData per shell: the single-instance lock scopes to the
    # userData dir, so side-by-side shells need separate dirs (also keeps
    # test state out of the real user profile).
    tag = "shipping" if port == 9341 else "react"
    ud = DESKTOP / "tests" / ".user-data" / tag
    ud.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, **env_extra, "POLYWAV_USER_DATA": str(ud)}
    return subprocess.Popen(
        [str(ELECTRON), ".", f"--remote-debugging-port={port}"],
        cwd=str(DESKTOP), env=env,
    )


def close_tree(proc) -> None:
    try:
        proc.terminate()
        proc.wait(timeout=8)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def seed_and_load(page, shell: str) -> None:
    page.wait_for_load_state("load")
    page.wait_for_timeout(800)
    if shell == "shipping":
        entry = json.dumps({"name": "SHOT_A.wav", "size": "0.0 MB", "time": int(time.time() * 1000), "path": str(SHOT_A)})
    else:
        entry = json.dumps({"name": "one", "path": str(ONE_DIR)})
    page.evaluate("""(entry) => {
      localStorage.setItem('polywav-wizard-done', '1');
      localStorage.removeItem('polywav-settings');
      localStorage.removeItem('polywav-theme');
      localStorage.setItem('polywav-recent', '[' + entry + ']');
    }""", entry)
    page.reload()
    page.wait_for_load_state("load")
    page.wait_for_timeout(800)
    # Load the fixture via the recents entry (real bridge path in both shells).
    page.locator(".recent-item").first.click()
    page.wait_for_timeout(1200)


# Per-state feature probes: state -> selector map, applied per shell right after
# that state's screenshot. React mounts views conditionally, so each view's
# features must be probed while it is active.
STATE_PROBES: dict[str, dict[str, str]] = {
    "01-home-loaded": {"loaded-card": ".file-loaded-card|#fileLoadedCard"},
    "02-normalize": {"norm-regex": ".preset-field input|#regex-pattern",
                     "norm-chips": ".template-chips|#template-chips",
                     "norm-table": ".parse-table|#parse-table"},
    "03-route": {"route-table": ".routing-table|#routeTableBody",
                 "route-summary": ".summary-list|#routeSummaryList",
                 "route-bar": ".bottom-bar|#routeBarInfo",
                 "route-undo": ".btn-undo|#routeUndoBtn"},
    "04-patch": {"patch-lane-src": ".patch-lane|#patchSrcLane",
                 "patch-svg": ".patch-cable-svg|#patchSvg",
                 "patch-unrouted": ".exp-un-chips|#patchUnrouted"},
    "05-export": {"exp-aaf-dir": ".out-dir-row input|#outputAafDir",
                  "exp-cli": ".cli-code|#exportCLI",
                  "exp-log": ".log-box|#exportLog",
                  "exp-btn": ".export-footer .btn-primary|#exportBtn"},
    "06-settings": {"set-theme": ".segmented|#themeDarkOpt",
                    "set-presets": "select|#presetSelect",
                    "set-naming": "input|#namingTemplateInput",
                    "set-bext": ".toggle-switch|#rawBextToggle"},
    "08-home-light": {},
    "09-wizard": {"wiz-templates": ".wizard-tmpl-card|.wizard-step-panel",
                  "wiz-summary": ".wizard-summary|#wizSummary"},
}


def probe(page, shell: str) -> dict:
    out = {}
    for key, sel in FEATURES[shell].items():
        try:
            n = page.locator(sel).count()
            out[key] = n if n else 0
        except Exception:
            out[key] = -1
    return out


def probe_state(page, shell: str, state_name: str) -> dict:
    """Probe this state's features using EITHER shell's selector (a|b form)."""
    out = {}
    for key, sel in STATE_PROBES.get(state_name, {}).items():
        found = 0
        for alt in sel.split("|"):
            try:
                found = max(found, page.locator(alt).count())
            except Exception:
                pass
        out[f"{state_name}:{key}"] = found
    return out


def capture_shell(page, shell: str, name: str) -> None:
    d = OUT / shell
    d.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(d / f"{name}.png"))
    print(f"  shot {shell}/{name}.png")


def main() -> int:
    if not SHOT_A.exists():
        print("FAIL: fixture SHOT_A.wav missing")
        return 1
    ONE_DIR.mkdir(exist_ok=True)
    target = ONE_DIR / "SHOT_A.wav"
    if not target.exists():
        shutil.copy2(SHOT_A, target)

    procs = {
        "shipping": launch({}, 9341),
        "react": launch({"POLYWAV_UI": "react"}, 9342),
    }
    summary = {}
    try:
        with sync_playwright() as p:
            for shell, proc in procs.items():
                port = 9341 if shell == "shipping" else 9342
                if not wait_port(port):
                    print(f"FAIL: {shell} shell never came up")
                    summary[shell] = {"error": "no devtools"}
                    continue
                browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
                ctx = browser.contexts[0]
                page = ctx.pages[0] if ctx.pages else ctx.new_page()
                console_errors = []
                page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
                page.on("pageerror", lambda e: console_errors.append(str(e)))

                cdp = ctx.new_cdp_session(page)
                cdp.send("Emulation.setDeviceMetricsOverride", VIEWPORT)
                page.wait_for_timeout(300)

                seed_and_load(page, shell)
                print(f"== {shell}: loaded ==")
                feature_results: dict[str, int] = {}

                def state(fn, label):
                    try:
                        fn()
                        capture_shell(page, shell, label)
                        feature_results.update(probe_state(page, shell, label))
                    except Exception as e:
                        print(f"  !! {shell} {label} FAILED: {str(e)[:160]}")

                # 1. Home (loaded state)
                capture_shell(page, shell, "01-home-loaded")
                feature_results.update(probe_state(page, shell, "01-home-loaded"))
                # 2. Normalize
                state(lambda: (page.locator(".tab").nth(1).click(), page.wait_for_timeout(600)), "02-normalize")
                # 3. Route
                state(lambda: (page.locator(".tab").nth(2).click(), page.wait_for_timeout(600)), "03-route")
                # 4. Patch
                state(lambda: (page.locator(".tab").nth(3).click(), page.wait_for_timeout(600)), "04-patch")
                # 5. Export
                state(lambda: (page.locator(".tab").nth(4).click(), page.wait_for_timeout(600)), "05-export")
                # 6. Settings overlay — probe + capture BEFORE closing.
                state(lambda: (
                    (page.locator("#settingsToggle").click() if shell == "shipping" else page.locator('[aria-label="Settings"]').click()),
                    page.wait_for_timeout(500),
                ), "06-settings")
                try:
                    page.keyboard.press("Escape"); page.wait_for_timeout(400)
                except Exception:
                    pass
                # 7. Light theme (home)
                state(lambda: (
                    page.locator(".tab").nth(0).click(),
                    page.wait_for_timeout(400),
                    (page.locator("#settingsToggle").click(), page.locator("#themeLightOpt").click(),
                     page.locator("#settingsApplyBtn").click()) if shell == "shipping" else
                    (page.locator('[aria-label="Settings"]').click(),
                     page.locator(".segmented").first.locator("button", has_text="Light").click(),
                     page.keyboard.press("Escape")),
                    page.wait_for_timeout(500),
                ), "08-home-light")
                # 8. Wizard (auto-opens on fresh profile); walk to step 05 for summary parity.
                def open_wizard():
                    page.evaluate("() => localStorage.removeItem('polywav-wizard-done')")
                    page.reload()
                    page.wait_for_timeout(900)
                    nxt = "#wizNextBtn" if shell == "shipping" else ".wizard-footer-right .wizard-btn.primary"
                    for _ in range(4):
                        page.locator(nxt).click()
                        page.wait_for_timeout(350)
                state(open_wizard, "09-wizard")

                summary[shell] = {
                    "features": feature_results,
                    "console_errors": console_errors,
                }
                browser.close()
    finally:
        for proc in procs.values():
            close_tree(proc)

    print("\n===== FEATURE MATRIX =====")
    for shell, data in summary.items():
        if "error" in data:
            print(f"{shell}: ERROR {data['error']}")
            continue
        missing = [k for k, v in data["features"].items() if v == 0]
        print(f"{shell}: {len(data['features']) - len(missing)}/{len(data['features'])} features present")
        if missing:
            print(f"  MISSING: {missing}")
        if data["console_errors"]:
            print(f"  CONSOLE ERRORS ({len(data['console_errors'])}):")
            for e in data["console_errors"][:10]:
                print(f"    - {e[:200]}")
        else:
            print("  console: clean")
    print("\nScreenshots in", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())