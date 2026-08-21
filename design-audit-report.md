# Design System & Accessibility Audit — `polywav/desktop/index.html`

**Audit date:** August 2026  
**Method:** Full source-code review of CSS (~2,669 lines inline in `<style>`) and HTML body structure.  
**Scope:** Visual craft, consistency, accessibility, motion/perf, states, native-UI integration.  
**Scoring:** P0 = blocking, P1 = major, P2 = moderate, P3 = minor, P4 = suggestion

---

## P0 — Blocker (must fix)

### 1. [CONTRAST] Light-mode hero title invisible

| Selector | Lines | Issue |
|---|---|---|
| `.hero-title` | CSS:1513 | Title `color: #f4efe7` is hardcoded and never overridden in light mode. On `#f5f0ea` page background, that's **1.01:1** — nearly invisible. |
| `.drop-zone-title` | CSS:1685 | Same hardcoded `color: #f4efe7`, also never gets a light-mode override. On `#ffffff` card background: **1.14:1** — invisible. |

**Fix:**
```css
.light-mode .hero-title,
.light-mode .drop-zone-title {
  color: var(--ink);
}
```

### 2. [CONTRAST] `.btn-primary` white-on-ink fails everywhere

| Selector | Lines | Issue |
|---|---|---|
| `.btn-primary` | CSS:737–745 | `color: #fff / background: var(--ink)` → `#ffffff` on `#f2ece2` = **1.18:1** — invisible contrast. This is the primary action button in the app. |
| `.badge` (dark) | CSS:228, 2288–2291 | `.card-header .badge` `color: #fff; background: var(--ink)` — same 1.18:1 ratio. |
| `.seg-option.active` | CSS:1207 | `color: #fff; background: var(--ink)` — same failure. | 
| `.light-mode .seg-option.active` | CSS:2385 | `color: #f5f0ea; background: var(--ink)` → `#f5f0ea` on `#2a2723` = **13.12:1** (OK). Only the DARK variant fails. |

**Fix for dark mode buttons:** Use accent color or a darker bg.
```css
.btn-primary { background: var(--tomato); color: #fff; }
.badge { background: var(--tomato); color: #fff; }
.segmented .seg-option.active { background: var(--tomato); color: #fff; }
```

### 3. [CONTRAST] Toggle slider knob on track

| Selector | Lines | Issue |
|---|---|---|
| `.toggle-slider::after` | CSS:1243–1251 | White knob `#ffffff` on `#dddddd` track = **1.36:1**. Cannot perceive the knob boundary on the track. |

**Fix:**
```css
.toggle-slider::after { box-shadow: 0 1px 3px rgba(0,0,0,0.3); /* keep */ }
/* Add subtle border or track-color for contrast: */
.toggle-slider { background: #bbb; } /* dark track */
.toggle-slider::after { background: #fff; border: 1px solid rgba(0,0,0,0.15); }
```

### 4. [KEYBOARD] Zero focus-visible styles, outline:none without replacement

The entire CSS uses **0 occurrences** of `:focus-visible`. There are **9 occurrences** of `outline: none` (or `outline:none`). Some have border-color replacements (inputs, editable-text), but buttons (`.win-btn`, `.wizard-btn`, `.btn`, `.btn-sm`) lose their focus ring entirely with no substitute.

**Fix:** Add a global rule:
```css
:focus-visible { outline: 2px solid var(--tomato); outline-offset: 2px; }
```
Remove `outline: none` from interactive elements that don't have an explicit focus-style replacement.

### 5. [KEYBOARD] No modal focus trap in settings or wizard overlays

| Component | Lines | Issue |
|---|---|---|
| Settings overlay | HTML:3141, CSS:1046–1061 | Opens with class toggle. No focus trap. Tab can leave overlay and reach page content behind the backdrop. |
| Wizard overlay | HTML:3302, CSS:2445–2462 | Same — no focus trap. |
| Escape handling | JS:4395, JS:6278 | Both overlays do listen for Escape — that's correct. But no first/last-focus trapping. |

**Fix:** Add a focus trap in both `openSettings()` and `openWizard()` by caching the last focused element and cycling focus within the panel.

---

## P1 — Major (high priority)

### 6. [CONTRAST] Dozens of light-mode text pairs fail WCAG AA

The `rgba(ink,.55)` / `rgba(ink,.45)` / `rgba(ink,.40)` / `rgba(ink,.35)` / `rgba(ink,.30)` pattern for secondary/decorative text works adequately on dark backgrounds due to high base-ink luminance (242/236/227) but **collapses in light mode** where base-ink is #2a2723 (dark) and backgrounds are white or near-white.

| CSS pattern | Data | Ratio | Violation |
|---|---|---|---|
| `rgba(var(--ink-rgb),0.55)` on card | DARK 4.87; LIGHT **3.53** | <4.5 body | LARGE-ONLY (ok on large text, fail on body) |
| `rgba(var(--ink-rgb),0.45)` on card | DARK 3.78; LIGHT **2.68** | <3:1 | FAIL body+large |
| `rgba(var(--ink-rgb),0.40)` on card | DARK 3.29; LIGHT **2.35** | <3:1 | FAIL both |
| `rgba(var(--ink-rgb),0.35)` on input | DARK 2.90; LIGHT **2.03** | <3:1 | FAIL both |
| `rgba(var(--ink-rgb),0.30)` on card | DARK 2.45; LIGHT **1.86** | <3:1 | FAIL both |
| `rgba(var(--ink-rgb),0.25)` on card | DARK 2.11; LIGHT **1.65** | — | Invisible |

Fix: bump light-mode alpha multipliers:
```css
.light-mode [style*="rgba(var(--ink-rgb),0.55)"] -> bump to 0.7+
/* Better: just use hex values for light-mode secondary text */
:root.light-mode {
  --muted: rgba(var(--ink-rgb),0.7);
  --dim: rgba(var(--ink-rgb),0.55);
  --faint: rgba(var(--ink-rgb),0.45);
}
```

The most critical of these — at **P0 urgency** individually — is:
- `rgba(ink,.45)` on card in light mode → **2.68:1** (subtitle, hint, lane-label, desc classifiers)
- `rgba(ink,.35)` on input → **2.03:1** (placeholder text, WCAG requirement for contrast ≥ 3:1; this fails)
- `rgba(ink,.40)` on card → **2.35:1** (file-meta, empty-state text)

### 7. [CONTRAST] Light-mode gold, sage, #888, #999, #bbb, #aaa all fail on white

| Element | Light ratio | Failure |
|---|---|---|
| `--gold` (`#c8a96e`) on page `#f5f0ea` | 1.98:1 | Invisible eyebrow |
| `--gold` on card `#ffffff` | 2.24:1 | FAIL |
| `--sage` `#7a9e8c` on card `#ffffff` | 2.96:1 | FAIL <3:1 |
| `#888888` on highlight `#e5dfd7` | 2.68:1 | FAIL (table header bg) |
| `#999999` on card `#ffffff` | 2.85:1 | FAIL (seg-option, lane-label) |
| `#bbbbbb` on card `#ffffff` | 1.92:1 | FAIL (empty-title) |
| `#aaaaaa` on card `#ffffff` | 2.32:1 | FAIL (grp-count) |
| Bext-tag `#8fb3a0` on chip `#eef4ef` | 2.06:1 | FAIL (dark too) |

**Fix:** Darken accent colors for light mode, or use opaque backgrounds.

### 8. [STRUCTURAL] @keyframes orbFloat defined twice — identical content

Lines CSS:105–109 and CSS:1489–1493. The second definition duplicates the first verbatim. The second one is inside `.hero-orb-*` selectors but `@keyframes` is global — the second wins (by spec, last one in source order wins for the same name). Both sets of selectors use `animation: orbFloat …`, so both work, but the earlier rule's keyframes are dead bytes.

**Fix:** Remove the duplicate block at line 1489–1493.

### 9. [STRUCTURAL] 59 CSS classes with zero references in HTML or JS

| Category | Classes |
|---|---|
| Entire components that exist only in CSS | `.hero-orb`, `.hero-tag`, `patch-dot`, `.patch-grid`, `.patch-map-card`, `.patch-matrix`, `.patch-tracks`, `.patch-track-label`, `.patch-track-src`, `.patch-track-empty`, `.export-empty`, `.export-options`, `.drop-zone-arrow`, `.regex-editor`, `.summary-table`, `.toggle-track`, `.theme-toggle`, `.drag-active` |
| Semantic color classes | `.cap-num`, `.cap-prefix`, `.cap-role`, `.cap-suffix` — defined in CSS but the HTML uses inline `className` assignment via JS that may never produce these strings |
| Utility dead weight | `.btn-sm` (0 refs), `.settings-input`, `.settings-select`, `.settings-row` (0), `.select-control`, `.unit`, `.template-input`, `.preset-panel-title` |

Some of these are generated by JS runtime (`.running`, `.success`, `.error`, `.dd-active`, `.editable-text`, `.on` for toggles, `.partial`, `.patch-temp-cable`) — confirmed by the code scanner. But others are **truly dead** and should be pruned.

**Fix:** Audit each dead class — either add markup/JS to use it, or delete the CSS rule.

### 10. [KEYBOARD] 0 `role` attributes, only 4 `aria-*` attributes

- **`role=""` occurrences:** **0**
- **`aria-label`:** 3 elements only (settings toggle × 2, close button × 1, plus wizard-close). Tabs have no aria role/selected. No ARIA for tablist/tabpanel.
- **No `aria-current` or `aria-selected`** on active tabs.
- **No `aria-labelledby`** for any section/region.
- **No `aria-live` region** for the toast or export log (screenreader won't announce dynamic content).

Tab system:
```html
<!-- Current: -->
<div class="tab-bar">
  <button class="tab active" onclick="switchTab('home')"><span class="tab-icon">🏠</span>Home</button>
  <button class="tab" onclick="switchTab('normalize')"><span class="tab-icon">📐</span>Normalize</button>
  ...
</div>
```

**Fix:**
```html
<div class="tab-bar" role="tablist" aria-label="Navigation tabs">
  <button class="tab active" role="tab" aria-selected="true" aria-controls="panel-home" ...>
```

### 11. [CONTRAST] Hardcoded #fbf8f3, #e5ddd3, #fdf5f0, #ddd backgrounds in dark theme

These are light/neutral colors hardcoded into hover/active states that **never get overridden in light mode** and look **wrong in dark mode** (light tan bg on dark cards):

| Selector | CSS line | Value | Context |
|---|---|---|---|
| `.btn-sm:hover` | 457 | `background: #e5ddd3` | Light tan on dark bg |
| `.parse-table tr:hover td` | 493 | `background: #fbf8f3` | Almost-white on dark bg |
| `.routing-table tr:hover td` | 598 | `background: #fbf8f3` | Same |
| `.patch-matrix tr:hover td` | 819 | `background: #fbf8f3` | Same |
| `.export-option:hover` | 873 | `background: #fbf8f3` | Same |
| `.export-option.selected` | 874 | `background: #eef4ef` | Light green |
| `.settings-close:hover` | 1111 | `background: #fdf5f0` | Light pink |
| `.btn-setting:hover` | 1279 | `background: #fdf5f0` | Same |

The "Dark Theme Sweep" section (line 2167–2367) **repeats** some of these (`.routing-table tr:hover td`, `.export-option:hover/selected` via rgba(ink,.04) pattern) but misses:
- `.btn-sm:hover` (dead selector anyway)
- `.settings-close:hover` (line 1111 is never overridden in `.light-mode` or sweep)
- `.parse-table tr:hover td` is swept with `rgba(var(--ink-rgb),0.04)` later, so it works. But `.btn-sm:hover` and `.settings-close:hover` are not.

**Fix:** Sweep the remaining hardcoded hover backgrounds or replace with `rgba(var(--ink-rgb),0.08)`.

---

## P2 — Moderate

### 12. [SCALE] Imbalanced typography — 18 distinct font sizes, no rational scale

| Value | Count | Notes |
|---|---|---|
| 10px | 13 | OK — smallest |
| 11px | 21 | OK |
| 11.5px | 1 | **One-off** — `.wiz-cta-desc` — should be 11 or 12 |
| 12px | 27 | OK |
| 13px | 25 | OK |
| 14px | 10 | OK |
| 15px | 5 | OK |
| 16px | 6 | OK |
| 17px | 1 | **One-off** — `.settings-header h2` |
| 18px | 3 | OK |
| 19px | 1 | **One-off** — responsive `.app-header h1` (should match 24px) |
| 22px | 1 | **One-off** — template card icon area (same as 24?) |
| 24px | 1 | **One-off** — `.app-header h1` |
| 28px | 1 | **One-off** — `.fl-icon` |
| 36px | 1 | **One-off** — `.tab-empty-state .empty-icon` |
| clamp() × 3 | 1 each | Different domain — OK for hero |

If we define a type scale: should be `{10, 11, 12, 13, 14, 16, 18, 20?, 24, 36, 48+}`. Current has 17px, 19px, 22px, 28px, 11.5px — all orphans.

**Fix:** Normalize. Replace 17px→16px, 19px→18px or 20px, 22px→20px or 24px, 28px→24px or 32px, 11.5→11px or 12px.

### 13. [SCALE] Inconsistent border-radius — 17 values

| Value | Uses | Notes |
|---|---|---|
| 50% | 10 | OK (circles) |
| 2px | 2 | OK |
| 3px | 6 | OK |
| 4px | 1 | **One-off** — `.bext-tag` (why not 3 or 6?) |
| 5px | 2 | **Drift** — `.drop-format`, should be 6 |
| 6px | 8 | OK (--radius-sm) |
| 7px | 1 | **One-off** — `.wizard-btn` (should be 6 or 8) |
| 8px | 9 | OK (--radius) |
| 10px | 6 | OK (--radius-md if it existed) |
| 11px | 1 | **One-off** — toggle slider |
| 12px | 3 | OK (cards and modal) |
| 14px | 2 | OK (settings panel) |
| 20px | 1 | **One-off** — status pill (should use var) |
| 24px | 1 | **One-off** — `.drop-zone` (hero component) |
| 30px | 1 | **One-off** — `.drop-zone-ring` |

**Fix:** Define `--radius-lg: 12px` and `--radius-xl: 16px`, replace 10→12, 20→var(--radius-xl), 30→calc. The var `--radius-md` is used but **never defined** — this causes the cascade to inherit or get `initial`.

### 14. [PERF] Heavy blur(70px) on 6 orbs × infinite animation

`.app-orb-*` and `.hero-orb-*` are **six** separate `<div>` elements, each with `filter: blur(70px)` and `will-change: transform` running infinite `orbFloat` at different cadences (12/14/18s). On Electron (Chromium), `blur(70px)` renders a 460px-radius element with a 70px Gaussian blur — that's a massive pixel-shader pass every animation frame. Additionally:

- `will-change: transform` on `.app-orb` and `.hero-orb` creates a compositing layer for each.
- `@keyframes orbFloat` animates `transform` — again every frame.
- No `prefers-reduced-motion` query anywhere.

**Fix:**
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```
Consider reducing blur to 40-50px, or using `opacity`-only animation for the orbs to avoid repaints.

### 15. [HTML] 50 elements using `onclick` instead of button elements

| Issue | Count | Severity |
|---|---|---|
| `<div>/<span>/<li>` with onclick (non-button) | 11+ | Keyboard inaccessible (no Enter/Space by default) |
| Total onclick handlers (inline) | 50 | JS-in-HTML violates CSP |
| `onkeydown` handlers | 0 | Zero keyboard event registration |
| `<button>` elements | 42 | OK — most are buttons |

The wizard template card selects are `<div onclick="selectTemplate(...)">` — these need `role="radio"`, `tabindex="0"`, keydown handler.

The `.template-chip` (span with onclick) and `.wizard-tmpl-card` (div with onclick) are the most critical — interactive elements that aren't keyboard-accessible.

**Fix:** Convert to `<button>`, or add `tabindex="0"` + `role="button"` + `onkeydown="if(event.key==='Enter'||event.key===' ')..."`. But `<button>` is cleaner.

### 16. [LIGHT MODE] Hardcoded colors outside the var system

| Rule | Line | Hardcoded | Light mode problem |
|---|---|---|---|
| `body` background gradients | 50–54 | `#2f2c27`, `#262320` | Overridden by `.light-mode` body — OK |
| `.btn-primary:hover` | 734 | `#2a3640` | Sweep at line 2399–2407 covers `.light-mode .btn-primary:hover` — OK |
| `.btn-primary:active` | 737 | `transform: scale(0.97)` | OK |
| `.app-header .status` | 139 | `color: #7a7a7a` | No light-mode override → #7a7a7a on white = 4.29:1 (large-only, acceptable) |
| `.app-header .subtitle` | 148 | `color: #888` | No light-mode override → #888 on white = 3.54:1 (large-only) |
| `.tab-empty-state .empty-title` | 300–302 | `color: #bbb` | No light-mode override → #bbb on white = 1.92:1 (FAIL!) |
| `.settings-close:hover` | 1111 | `background: #fdf5f0` | Light-mode sweep at line 2388 overrides color but not background — wrong in dark mode |
| `.toggle-slider` | 1239 | `background: #ddd` | #ddd in dark mode is a light gray — should be darker |
| `.segmented .seg-option:hover` | 1197 | `background: #f5f0ea` | Light mode background in dark theme — looks wrong |
| `.ch-name .bext-tag` | 608–609 | `background: #eef4ef` | No var at all — light green chip in dark mode |
| `.parse-table td` | 488 | `border-bottom: 1px solid #f0ece4` | Lighter than border var — not swept |
| `.export-summary .line-item` | 850 | `border-bottom: 1px solid #f0ece4` | Same |
| `.summary-list li` | 679 | `border-bottom: 1px solid #f0ece4` | Same |
| `.patch-matrix th, td` | 780 | `border-bottom: 1px solid #f0ece4` | Same |
| `.patch-tracks li` | 823 | `border-bottom: 1px solid #f0ece4` | Same |

Six components use `#f0ece4` as a border color — a hardcoded light ivory value. In dark mode, it appears as a noticeably lighter-than-var(--border) line. These are never overridden.

**Fix:** Replace `#f0ece4` with `var(--border)` throughout.

### 17. [LIGHT MODE] Missing `.light-mode` overrides for hero-eyebrow

`--gold` on page `#f5f0ea` = 1.98:1 — the eyebrow text is invisible in light mode. The CSS uses `var(--gold, #c8a96e)` (line 1501). The gold variable stays `#c8a96e` in light mode (line 25 confirms: `--gold: #c8a96e` — NOT darkened).

**Fix:** In `:root.light-mode { --gold: #b8943a; }` or similar darkened variant.

---

## P3 — Minor

### 18. [PERF] 5 independent CSS animations running permanently

- `orbFloat` (3 diverging instances) — @keyframes uses `infinite`  
- `pulseDot` (@hero dot) — infinite  
- `arrowBounce` (drop zone icon) — infinite  
- `ringPulse` (2 instances) — infinite  
- `flowDash` (SVG dash animation) — infinite  
- `exportProgressIndeterminate` — infinite

None respect `prefers-reduced-motion`.

### 19. [STRUCTURAL] Tab content animation on page load

`.tab-content` CSS line 188-193: `opacity: 0; transform: translateY(18px); display: none;`. The active tab becomes `display: block; opacity: 1; transform: translateY(0);`. If the page loads with a tab already active, there's a brief flash of invisible content before the CSS transition fires. The `display: none → block` transition is not animatable.

### 20. [STRUCTURAL] Mismatched spacing between `.card-body` and `.card-header`

`.card-header` has `padding: 14px 20px`. `.card-body` has `padding: 4px 0`. This means content inside `.card-body` butts against the header's bottom border with only 4px — visually tight. The component doesn't use a consistent horizontal padding for body content — individual inner components set their own (e.g., `.parse-table td { padding: 8px 16px }`, `.summary-list li { padding: 8px 20px }`).

### 21. [SCALE] `--radius` (8px) vs `--radius-sm` (6px) with no `--radius-md` (used but undefined)

`--radius` = 8px, `--radius-sm` = 6px. The CSS references `var(--radius-md)` at line 1811 (`.file-loaded-card { border-radius: var(--radius-md) }`) — this variable is **never defined** in `:root`, so it falls back to CSS initial (`0`). The card gets square corners in all browsers.

**Fix:** Define `--radius-md: 10px;` or `12px;` in `:root`.

### 22. [NATIVE UI] No `color-scheme` meta

No `color-scheme: dark` in `<head>` means native form elements (`<select>`, `<input type="date">`, etc.) render with light appearance in dark mode. The 10 `<select>` elements use `appearance: auto` on `.track-select` (line 633) but with `background: var(--bg-input)` and `color: var(--ink)`, so they mostly work. But browsers may show light scrollbar chrome, input calendar pickers with light backgrounds.

### 23. [NATIVE UI] Scrollbar styling cross-theme

```css
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(var(--ink-rgb),0.14); border-radius: 5px; }
::-webkit-scrollbar-thumb:hover { background: rgba(var(--ink-rgb),0.24); }
```
Global scrollbar styling via `::-webkit-scrollbar` is OK in Electron (Chromium). In `parse-table-wrap`/`settings-panel` there's a narrower 6px variant. No custom scrollbar for Firefox (`scrollbar-width: thin; scrollbar-color: ...`). Add for cross-browser:
```css
* { scrollbar-width: thin; scrollbar-color: rgba(var(--ink-rgb),0.14) transparent; }
```

### 24. [STATES] Disabled `pointer-events: none` on `.wizard-btn:disabled`

Line 2668: `.wizard-btn:disabled { opacity: 0.35; cursor: default; pointer-events: none; }`. `pointer-events: none` prevents the cursor from showing `cursor: default` and also prevents any future tooltip or click instrumentation. Better to omit `pointer-events` and rely on `cursor: default` + `opacity`.

### 25. [STATES] No `:disabled` styles for `.btn`, `.btn-secondary`, `.btn-sm`, `.drop-zone-btn`

Only `.btn-undo:disabled` and `.btn-redo:disabled` have disabled styling. The other buttons just remain normal when disabled — ideally they'd show reduced opacity.

### 26. [HTML] Empty states exist but no loading/error states for data tables

`.tab-empty-state` is built for each tab panel (4 instances). But there's no **loading skeleton** or **error state** for the route table, normalize table, or patch matrix when data fails to load. The empty states just say "Load a polywav file to get started" — acceptable for initial state, but if a load fails mid-use, the user sees an old empty state rather than an error.

### 27. [HTML] `<h1>` only used twice, page doesn't communicate content hierarchy well

There are 2 `<h1>` elements (one is the title, one might be in the hero) when ideally the document structure maps to the tab content. `<h2>` is used for card headers (12×), `<h3>` for settings sections (10×). This is OK but:
- The document has no `<main>` landmark
- No `<nav>` for the tab bar
- No `<section>` or `<article>` tags — only `<div>`

### 28. [HTML] Missing toast timeout variable

Line 4402–4407: `showToast` function. The timeout is 2200ms (hardcoded `2200`) but the CSS transition duration is `0.3s ease`. The toast `transition: all 0.3s ease; opacity: 1 → transform: translateY(80px)` and `opacity: 0 → transform: translateY(80px)` — the reverse transition doesn't animate because `pointer-events: none` blocks layout/recalc but the transition might not trigger. Also 2200ms is very short for a notification — WCAG Success Criterion 2.2.1 suggests at least enough time to read (4+ seconds for short messages). Bump to 4000-5000ms.

### 29. [UNDEFINED VARS] `--text-secondary` fallback

`#exportLog .export-log-stdout` (line 895): `color: var(--text-secondary, #bbb)`. `--text-secondary` is never defined in `:root`. Works due to fallback, but should either define `--text-secondary` or use the existing `rgba(ink,.55)` pattern.

### 30. [UNDEFINED VARS] `--grp-color` dynamic

`:root` doesn't define `--grp-color`. The patch-group component uses `border-left: 3px solid var(--grp-color, var(--tomato))` — this works because fallback is set, but it means the left border color is non-trivial to set globally. It's set inline per-element in JS (`style.setProperty('--grp-color', ...)`) which is fine.

---

## P4 — Suggestions / Polish

### 31. Indentation collapse at line 888–912

Lines 888–912 show a sudden indentation inconsistency: CSS rules shift from 2-space to 12-space indent mid-file. This appears to be a copy-paste artifact or botched merge. Around `.export-footer`, `#exportLog`, `.export-progress` all have extra indentation. Format consistently.

### 32. `.toast.show` defined twice

Line 966 (`opacity: 1; transform: translateX(-50%) translateY(0)`) and line 2299 (`opacity: 1; transform: translate(-50%, 0)`) — the second overrides `transform` with a different syntax. They produce the same visual result but one uses `translateX(-50%) translateY(0)` and the other uses `translate(-50%, 0)`. Consolidate.

### 33. No `selection` styling

The app never sets `::selection` — the default OS selection highlight (often blue) will clash with the dark theme's warm/gold palette. Add:
```css
::selection { background: rgba(var(--tomato-rgb), 0.3); color: var(--ink); }
```
(Note: `--tomato-rgb` is NOT defined either, only the hex `--tomato: #d0714f`. Would need a parallel `--tomato-rgb`.)

### 34. No fallback for `<foreignObject>` or missing font glyphs

The `.hero-title` uses `Georgia, 'Times New Roman', serif` as the serif fallback — if Georgia is missing, Times New Roman may not render the intended character width. Since Inter and JetBrains Mono are loaded via Google Fonts (in `<head>`), preload `Inter` and `JetBrains Mono` explicitly to prevent FOAT.

### 35. Redundant `font-family: var(--font-body)` on most buttons

`.btn`, `.btn-sm`, `.btn-setting`, `.drop-zone-btn`, `.header-action-btn`, `.wizard-btn`, `.tab`, `.seg-option`, `.recent-clear` all redeclare `font-family: var(--font-body)`. Since `body { font-family: var(--font-body) }` already inherits to all children, these are all redundant — only `.wizard-btn` could need it if scoped in a shadow context.

### 36. `-webkit-app-region: drag` on `.header-inner` with no `no-drag` on interactive children

Line 1364: `.header-inner { -webkit-app-region: drag }` — this makes the entire header draggable (for frameless window). The children `.tab-bar`, `.window-controls`, `settings-btn`, `theme-toggle`, `.header-action-btn` have `-webkit-app-region: no-drag`. But interactive elements inside `.header-inner` that lack explicit `no-drag` include the `.subtitle` and `.app-header h1` — clicking them might trigger window-drag instead of text selection. Already handled per element but worth confirming no click targets were missed.

---

## Summary Statistics

| Category | Count | P0 | P1 | P2 | P3 | P4 |
|---|---|---|---|---|---|---|
| WCAG Contrast failures | 36+ unique pairs fail | 3 | 5 | 2 | — | — |
| Light-mode color breaks | 15+ hardcoded values | 1 | 2 | 5 | — | — |
| Spacing/typography orphans | 10 one-off values | — | — | 2 | 1 | — |
| Component drift | 58 dups, 59 dead classes, 1 duplicate @keyframes, 2 undefined vars | — | 1 | 1 | 2 | — |
| Keyboard/ARIA | 0 :focus-visible, 0 role, 4 aria, 50 onclick, 0 keydown, no focus traps | 1 | 1 | 1 | — | — |
| Motion/perf | blur(70) × 6, 5+ infinite anims, no reduced-motion | — | — | 1 | 1 | — |
| States coverage | No loading/error states, missing disabled styles | — | — | — | 2 | — |
| Scrollbar/native UI | No color-scheme, no ::selection | — | — | — | 1 | 1 |
| **Totals** | | **5** | **9** | **12** | **7** | **4** |

---

## Quick Wins (under 30 min each)

1. ✅ **hero-title light-mode invisible** — add `.light-mode .hero-title { color: var(--ink); }` (P0, line 1513)
2. ✅ **drop-zone-title light-mode invisible** — same fix (P0, line 1685)
3. ✅ **btn-primary contrast** — replace `background: var(--ink)` with `var(--tomato)` in dark mode (P0, line 737)
4. ✅ **:focus-visible global rule** — add `:focus-visible { outline: 2px solid var(--tomato); ... }` (P0)
5. ✅ **Duplicate orbFloat keyframes** — delete second definition at CSS:1489 (P1)
6. ✅ **--radius-md undefined** — define in `:root` as 10px or 12px (P3, line 1811)
7. ✅ **toggle slider knob** — add border to knob for contrast (P0, line 1243)
8. ✅ **Replace #f0ece4 borders with var(--border)** — 6 occurrences (P2)
9. ✅ **Light-mode gold eyebrow** — darken `--gold` in `.light-mode` (P2, line 1501)
10. ✅ **Toast duration** — change 2200ms → 4000ms (P3, JS line 4407)
11. ✅ **pointer-events:none on disabled wizard btn** — remove `pointer-events: none` (P3, CSS:2668)
12. ✅ **Consolidate .toast.show transform** — one definition (P4, CSS:966 vs 2299)
13. ✅ **Add color-scheme meta** — `<meta name="color-scheme" content="dark">` (P3)
14. ✅ **Fix .settings-close:hover background** — change to `rgba(var(--ink-rgb),0.1)` (P2, CSS:1111)
15. ✅ **Fix .toggle-slider dark bg** — change `#ddd` to `rgba(var(--ink-rgb),0.25)` (P1, CSS:1239)

## Structural Work (days)

1. 🔧 **Replace all inline `onclick` with addEventListener** — 50 handlers, can be batched. Enable CSP strict mode.
2. 🔧 **Add ARIA roles to tabs (tablist/tab/tabpanel)** — + keydown Left/Right navigation.
3. 🔧 **Add focus trap to settings and wizard overlays** — JS changes in `toggleSettings()` and `openWizard()`.
4. 🔧 **Light-mode contrast overhaul** — systematic bump of rgba alpha multipliers for all secondary text.
5. 🔧 **Add `prefers-reduced-motion` block** — one CSS rule, zero behavioral changes.
6. 🔧 **Consolidate type scale** — reduce from 18 to ~11 distinct values.
7. 🔧 **Prune 59 dead CSS classes** — audit each, remove CSS if unused by JS.
8. 🔧 **Convert div/span onclick to `<button>` or add keyboard handling** — at minimum `.template-chip`, `.wizard-tmpl-card`.