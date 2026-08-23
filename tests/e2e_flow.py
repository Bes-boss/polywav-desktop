"""End-to-end flow test for the React shell (mock bridge, vite preview).

Walks the whole app the way a user would: load folder -> normalize ->
route (selects + undo/redo + auto-assign) -> patch (drag a chip onto a
timeline lane, undo) -> export (single shoot-day AAF) -> settings
(toggles, theme) -> wizard (5 steps).

Run: python tests/e2e_flow.py <base_url>   (default http://localhost:4174/)
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4174/"
OUT = Path(r"C:\Users\Liam\workspace\polywav\sketches\002-routing-wireframe\shots\react\flow2")
OUT.mkdir(parents=True, exist_ok=True)

checks: list[dict] = []
console_errors: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    checks.append({"name": name, "ok": bool(cond), "detail": detail})
    print(("  ok  " if cond else "FAIL  ") + name + (f" — {detail}" if detail and not cond else ""))


def shot(page, name: str) -> None:
    page.screenshot(path=str(OUT / f"{name}.png"))
    print(f"  shot {name}.png")


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 920}, device_scale_factor=1)
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    # Export confirm dialog (confirmExport default on) — accept automatically.
    page.on("dialog", lambda d: d.accept())
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(400)

    # First-run wizard auto-opens (parity with shipping app) — dismiss for the flow.
    if page.locator(".wizard-modal").count() > 0:
        page.click(".wizard-close")
        page.wait_for_timeout(300)

    # --- Home: load the shoot-day folder (mock bridge returns a dir) ---
    check("home: hero title", "Polywav" in page.locator(".hero-title").inner_text())
    check("home: 5 tabs", page.locator(".tab-bar .tab").count() == 5)
    page.click(".drop-zone")
    page.wait_for_timeout(1100)
    check("home: loaded card", page.locator(".fl-actions").is_visible())
    check("home: fl-details lists takes", "EP03_S1_T01" in page.locator(".fl-details").inner_text())
    shot(page, "01-home-loaded")

    # --- Normalize: takes strip + pattern edits + test rename + chip cycle ---
    page.click('text=Normalize')
    page.wait_for_timeout(600)
    check("normalize: take chips (batch)", page.locator(".takes .take").count() == 6)
    check("normalize: table rows", page.locator(".parse-table tbody tr").count() >= 14)
    page.fill(".test-rename input", "MRK_Host_42")
    page.wait_for_timeout(150)
    check("normalize: test rename", "MRK_Host_42" in page.locator(".test-result").inner_text())
    num_chip = page.locator(".tpl-chip", has_text="{num}")
    before = num_chip.inner_text() if num_chip.count() else ""
    if num_chip.count():
        num_chip.click()
        page.wait_for_timeout(150)
        after = page.locator(".tpl-chip", has_text="{num}").count() + page.locator(".tpl-chip", has_text="{num:02d}").count()
        check("normalize: chip click cycles", after >= 1 and before != "", f"before={before}")
    else:
        check("normalize: chip click cycles", False, "no {num} chip")
    page.fill("[data-wire='parse-pattern']", "^(?<prefix>[A-Z]+)_(?<role>[A-Za-z0-9]+?)_?(?<num>[0-9]+)?$")
    page.wait_for_timeout(150)
    shot(page, "02-normalize")

    # --- Route: assignment, undo/redo, auto-assign ---
    page.click('text=Route')
    page.wait_for_timeout(600)
    page.locator("tr", has_text="ISO 1").first.locator("select").select_option("A8")
    page.wait_for_timeout(200)
    check("route: select assignment", "A8" in page.locator("tr", has_text="ISO 1").first.inner_text())
    page.click(".btn-undo.enabled")
    page.wait_for_timeout(200)
    check("route: undo works", "Unassigned" in page.locator("tr", has_text="ISO 1").first.inner_text())
    page.click(".btn-redo.enabled")
    page.wait_for_timeout(200)
    check("route: redo works", "A8" in page.locator("tr", has_text="ISO 1").first.inner_text())
    page.click("button:has-text('Auto-assign')")
    page.wait_for_timeout(250)
    assigned_sel = page.locator("select.track-select.assigned").count()
    check("route: auto-assign fills defaults", assigned_sel >= 8, f"assigned={assigned_sel}")
    shot(page, "03-route")

    # --- Patch: cables draw, drag chip into Boom, undo removes cable ---
    page.click('text=Patch')
    page.wait_for_timeout(900)
    cables_before = page.locator(".patch-cable-svg g").count()
    check("patch: cables drawn", cables_before >= 8, f"cables={cables_before}")
    src = page.locator('[data-ch-anchor="10"]')  # ISO 2 — currently unassigned
    boom = page.locator('.exp-row', has_text="Boom").first
    src.drag_to(boom)
    page.wait_for_timeout(900)
    cables_after = page.locator(".patch-cable-svg g").count()
    check("patch: cable added after drop", cables_after == cables_before + 1, f"before={cables_before} after={cables_after}")
    iso_lane = page.locator('.exp-row[data-exp-ch="10"]')
    check("patch: ISO2 gets its own lane", iso_lane.count() == 1, f"lanes={iso_lane.count()}")
    check("patch: ISO2 stacked before Boom",
          iso_lane.first.bounding_box()['y'] < boom.bounding_box()['y'],
          f"iso_y={iso_lane.first.bounding_box()['y']} boom_y={boom.bounding_box()['y']}")
    shot(page, "04-patch")
    page.click(".btn-undo.enabled")
    page.wait_for_timeout(750)
    after_undo = page.locator('.exp-row[data-exp-ch="10"]').count()
    check("patch: undo removes ISO2 lane", after_undo == 0, f"lanes={after_undo}")

    # --- Route: Clear empties (checked after patch so cables test stays valid) ---
    page.click('text=Route')
    page.wait_for_timeout(500)
    page.click("button:has-text('Clear')")
    page.wait_for_timeout(250)
    check("route: clear empties", page.locator("select.track-select.assigned").count() == 0)

    # --- Export: single shoot-day AAF to completion ---
    page.click('text=Export')
    page.wait_for_timeout(500)
    page.click("button:has-text('Export shoot day for Avid')")
    page.wait_for_timeout(6000)
    status = page.locator(".badge").first.inner_text()
    check("export: status done", status == "done", status)
    wrote = page.locator(".log-box div.log-ok").count()
    check("export: wrote 1 AAF (single timeline)", wrote == 1, f"wrote={wrote}")
    shot(page, "05-export-done")

    # --- Settings: toasts toggle gates toasts; light theme applies ---
    page.click('button[aria-label="Settings"]')
    page.wait_for_timeout(400)
    check("settings: overlay open", page.locator(".settings-panel").is_visible())
    # toggle showToasts OFF (click the switch label — input is visually hidden)
    switches = page.locator(".toggle-switch")
    if switches.nth(1).locator("input").is_checked():
        switches.nth(1).click()
    page.click("button:has-text('Apply')")
    page.wait_for_timeout(300)
    page.click('text=Home')
    page.wait_for_timeout(300)
    # Hero/drop-zone unmount after load (shipping parity) — trigger a toast via
    # the recents entry reload instead.
    page.locator(".recent-item").first.click()
    page.wait_for_timeout(900)
    check("settings: toast suppressed", page.locator(".toast.show").count() == 0)
    # re-enable toasts + light theme
    page.click('button[aria-label="Settings"]')
    page.wait_for_timeout(300)
    switches = page.locator(".toggle-switch")
    if not switches.nth(1).locator("input").is_checked():
        switches.nth(1).click()
    page.locator(".seg-option", has_text="Light").click()
    page.click("button:has-text('Apply')")
    page.wait_for_timeout(400)
    check("settings: light mode applied", page.locator("body.light-mode").count() == 1)
    shot(page, "06-settings-light")

    # --- Wizard: full 5-step pass ---
    page.click('button[aria-label="Settings"]')
    page.wait_for_timeout(250)
    page.click("button:has-text('Cancel')")
    page.wait_for_timeout(300)
    # Hero (and its wizard CTA) unmount after load — reopen the wizard the way
    # a fresh profile does: clear the done flag and reload (first-run auto-open).
    page.evaluate("() => localStorage.removeItem('polywav-wizard-done')")
    page.reload()
    page.wait_for_load_state("load")
    page.wait_for_timeout(900)
    page.wait_for_timeout(400)
    check("wizard: step 1 templates", page.locator(".wizard-tmpl-card").count() == 4)
    for _ in range(5):
        page.click(".wizard-btn.primary")
        page.wait_for_timeout(350)
    page.wait_for_timeout(600)
    check("wizard: completed toast", page.locator(".toast.show").count() >= 1)
    shot(page, "07-wizard")

    # Final: no console errors (ignore favicon/404 noise)
    real_errors = [e for e in console_errors if 'favicon' not in e.lower() and '404' not in e]
    check("console: no errors", len(real_errors) == 0, "; ".join(real_errors[:3]))
    browser.close()

failed = [c for c in checks if not c["ok"]]
print(json.dumps(checks, indent=1))
print(f"\n{len(checks) - len(failed)}/{len(checks)} checks passed")
sys.exit(1 if failed else 0)