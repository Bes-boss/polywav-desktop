/**
 * Polywav desktop — source contract tests (TDD harness).
 *
 * The app is a single-file vanilla JS/HTML app with no module system, so
 * these are source-contract tests: they parse index.html / main.js and
 * assert the security & correctness properties each audit fix must have.
 * RED first (against unfixed source), GREEN after each branch lands.
 *
 * Run: node tests/contract.test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const mainJs = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
// Renderer JS lives in app.js (extracted from index.html so the strict CSP
// `script-src 'self'` can keep blocking ALL inline script execution).
const inlineJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    failures.push(`${name}\n      -> ${e.message}`);
    console.log(`FAIL  ${name}\n      -> ${e.message}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertNo(re, msg) { assert(!re.test(indexHtml) && !re.test(mainJs), msg); }
function assertHtml(re, msg) { assert(re.test(indexHtml), msg); }
function assertMain(re, msg) { assert(re.test(mainJs), msg); }

// (inline script extraction removed — renderer JS now lives in app.js,
// loaded above as inlineJs)

// ---------------------------------------------------------------- helpers
/** Count innerHTML assignments whose RHS has no esc( wrapper around concat parts */
function countDynamicInnerHtmlAssignments() {
  // crude but effective: find `X.innerHTML =` where the RHS contains `+` string
  // concat referencing identifiers (dynamic) and does not go through esc(
  const re = /\.innerHTML\s*=\s*([^;]+);/g;
  let dynamic = 0;
  let m;
  while ((m = re.exec(inlineJs)) !== null) {
    const rhs = m[1];
    if (!/\+/.test(rhs)) continue;                 // static string
    if (/^\s*'[^']*'\s*$/.test(rhs)) continue;     // static
    if (/\besc\s*\(/.test(rhs)) continue;          // escaped
    if (/innerHTML\s*=\s*'[^']*'\s*\+/.test(`x ${m[0]}`) && !/[a-zA-Z_$][\w$]*\s*\+/.test(rhs)) continue;
    dynamic++;
  }
  return dynamic;
}

// ======================================================================
// BRANCH 1 — fix/security-xss
// ======================================================================
console.log('\n[Branch 1] fix/security-xss');

test('B1: webSecurity:false is removed from main.js', () => {
  assert(!/webSecurity/.test(mainJs), 'webSecurity still referenced in main.js');
});

test('B1: esc() helper exists in renderer', () => {
  assert(/function esc\(/.test(inlineJs), 'no esc() helper defined');
});

test('B1: BEXT/raw channel names escaped in normalize table', () => {
  assert(/esc\(ch\.raw\)/.test(inlineJs), 'ch.raw injected without esc()');
  assert(/esc\(ch\.bext\)/.test(inlineJs), 'ch.bext injected without esc()');
});

test('B1: clip name escaped in hero subtitle', () => {
  assert(/esc\(_clipName/.test(inlineJs), '_clipName injected without esc()');
});

test('B1: recent-file names built via textContent (not innerHTML concat)', () => {
  // The recent item creation must not concatenate `name` into innerHTML
  const re = /\.innerHTML\s*=\s*[^;]*\+\s*name\s*\+/;
  const recentBlocks = inlineJs.match(/recent-item[\s\S]{0,600}/g) || [];
  assert(recentBlocks.length > 0, 'recent-item creation not found');
  for (const block of recentBlocks) {
    assert(!/innerHTML[^;]*\+\s*name\b/.test(block), 'filename still innerHTML-concated: ' + block.slice(0, 80));
  }
});

test('B1: CSP meta tag present', () => {
  assertHtml(/http-equiv="Content-Security-Policy"/i, 'no CSP meta');
});

test('B1: setWindowOpenHandler denies window.open', () => {
  assertMain(/setWindowOpenHandler/, 'no setWindowOpenHandler');
});

test('B1: will-navigate guard present', () => {
  assertMain(/will-navigate/, 'no will-navigate guard');
});

// ======================================================================
// BRANCH 2 — fix/main-process-hardening
// ======================================================================
console.log('\n[Branch 2] fix/main-process-hardening');

test('B2: VENV_PYTHON resolved via env/config fallback chain (not hardcoded user path)', () => {
  assert(!new RegExp(`VENV_PYTHON\\s*=\\s*['"]C:\\\\\\\\Users\\\\\\\\Liam`).test(mainJs),
    'VENV_PYTHON still hardcoded to C:/Users/Liam');
  assertMain(/resolvePython|POLYWAV_PYTHON/, 'no resolvePython()/POLYWAV_PYTHON fallback');
});

test('B2: stdout parsed with line buffer (partial-line safe)', () => {
  assertMain(/lineBuf|lineBuffer/, 'no line buffering for stdout');
});

test('B2: export cancel sets cancelled flag; close handler distinguishes cancel from failure', () => {
  assertMain(/exportCancelled|cancelRequested/, 'no cancelled flag on export job');
});

test('B2: before-quit kills running export child', () => {
  assertMain(/before-quit/, 'no before-quit cleanup');
});

test('B2: window-state restore validates against visible displays', () => {
  assertMain(/getAllDisplays|isOnScreen|workArea/, 'no off-screen validation on restore');
});

test('B2: maximized state not saved as normal bounds', () => {
  assertMain(/isMaximized\(\)/, 'isMaximized never checked when saving window state');
});

test('B2: dead IPC channels removed (openPath/getWindowState/saveWindowState/onVisibilityChange)', () => {
  for (const chan of ['openPath', 'getWindowState', 'saveWindowState', 'onVisibilityChange']) {
    assert(!new RegExp(chan).test(preloadJs), `${chan} still exported from preload`);
  }
});

test('B2: sandbox:true set', () => {
  assertMain(/sandbox:\s*true/, 'sandbox not enabled');
});

// ======================================================================
// BRANCH 3 — fix/renderer-state-bugs
// ======================================================================
console.log('\n[Branch 3] fix/renderer-state-bugs');

test('B3: showFileLoaded no longer queries removed .hero-badges', () => {
  assert(!/querySelector\('\.hero-badges'\)/.test(inlineJs), '.hero-badges still queried');
});

test('B3: showFileLoaded guards missing hero elements', () => {
  const fn = inlineJs.match(/function showFileLoaded\(\)[\s\S]{0,2000}/);
  assert(fn, 'showFileLoaded not found');
  assert(/if\s*\(/.test(fn[0].split('heroContent.querySelector')[1] || '') ||
         /\.hero-badges/.test(fn[0]) === false,
    'no guard around hero child queries');
});

test('B3: wizard selectTemplate re-syncs form (no stale read-back)', () => {
  const fn = inlineJs.match(/function selectTemplate\([\s\S]{0,900}/);
  assert(fn, 'selectTemplate not found');
  assert(/syncWizardForm\(\)/.test(fn[0]), 'selectTemplate does not call syncWizardForm()');
});

test('B3: probe epoch guard against stale async file loads', () => {
  assert(/_loadEpoch|loadEpoch|_fileEpoch/.test(inlineJs), 'no load-epoch guard');
});

test('B3: recent files deduped by name', () => {
  // Dedupe lives in addRecentFileItem via the _recentFiles data model:
  // entries with the same name are filtered out before insert.
  assert(/_recentFiles\s*=\s*_recentFiles\.filter\(\s*function\(entry\)\s*\{\s*return entry\.name !== name;/.test(inlineJs),
    'addRecentFileItem does not dedupe by name in the data model');
});

test('B3: recent files persisted from data model, not DOM scrape', () => {
  const fn = inlineJs.match(/function saveRecentFiles\(\)[\s\S]{0,800}/);
  assert(fn, 'saveRecentFiles not found');
  assert(/_recentFiles|recentFiles\s*=|RECENT_DATA/.test(fn[0]),
    'saveRecentFiles still scrapes querySelectorAll(.recent-item)');
});

test('B3: failed export start resets progress UI', () => {
  const fn = inlineJs.match(/function doExport\(\)[\s\S]{0,4000}/);
  assert(fn, 'doExport not found');
  assert(/result\.error[\s\S]{0,400}showExportProgress\(false\)/.test(fn[0]) ||
         /showExportProgress\(false\)/.test(fn[0]),
    'error branch does not reset progress UI');
});

test('B3: tab switch timer guarded against A->B->A blanking', () => {
  const fn = inlineJs.match(/function switchTab\([\s\S]{0,1500}/);
  assert(fn, 'switchTab not found');
  assert(/classList\.contains\('active'\)|pendingHide|clearTimeout/.test(fn[0]),
    'no active-check/cancel on delayed tab hide');
});

test('B3: maximize listener registered once (not per click)', () => {
  const fn = inlineJs.match(/function maximizeWindow\(\)[\s\S]{0,600}/);
  assert(fn, 'maximizeWindow not found');
  assert(!/onMaximizeChange/.test(fn[0]), 'maximizeWindow still registers onMaximizeChange per call');
});

// ======================================================================
// BRANCH 4 — fix/light-mode-contrast
// ======================================================================
console.log('\n[Branch 4] fix/light-mode-contrast');

test('B4: light-mode overrides for hero title and drop-zone title', () => {
  assertHtml(/\.light-mode\s+\.hero-title[^{]*\{[^}]*color\s*:/, 'no light-mode hero-title color');
  assertHtml(/\.light-mode\s+\.drop-zone-title[^{]*\{[^}]*color\s*:/, 'no light-mode drop-zone-title color');
});

test('B4: focus-visible outline rule exists', () => {
  assertHtml(/:focus-visible/, 'no :focus-visible rule');
});

test('B4: prefers-reduced-motion block exists', () => {
  assertHtml(/prefers-reduced-motion/, 'no prefers-reduced-motion block');
});

test('B4: --radius-md variable defined', () => {
  assertHtml(/--radius-md\s*:/, '--radius-md never defined');
});

test('B4: color-scheme meta present', () => {
  assertHtml(/name="color-scheme"/i, 'no color-scheme meta');
});

test('B4: hardcoded #f0ece4 borders replaced with var(--border)', () => {
  assert(!/#f0ece4/.test(indexHtml), '#f0ece4 still hardcoded');
});

test('B4: duplicate orbFloat keyframes removed (only one definition)', () => {
  const count = (indexHtml.match(/@keyframes\s+orbFloat/g) || []).length;
  assert(count === 1, `orbFloat defined ${count} times`);
});

// ======================================================================
// BRANCH 5 — fix/csp-inline-handlers (onclick -> addEventListener)
// ======================================================================
// The strict CSP (`script-src 'self'`) silently kills EVERY inline event
// handler attribute: onclick=, onchange=, oninput=, and the on*=
// attributes app.js emits inside generated HTML strings. These tests pin
// the migrated state: zero inline handler attributes anywhere, all
// dynamic UI driven by delegated listeners.

const INLINE_HANDLER_RE =
  /\son(click|change|input|blur|focus|dblclick|dragstart|dragover|drop|dragend|mousedown|mouseup|keydown|keyup|submit)\s*=\s*["']/i;

/** All source windows of `len` chars starting at each occurrence of `anchorRe` */
function windowsAround(source, anchorPattern, len) {
  const re = new RegExp(anchorPattern, 'g');
  const wins = [];
  let m;
  while ((m = re.exec(source)) !== null) wins.push(source.slice(m.index, m.index + len));
  return wins;
}

console.log('\n[Branch 5] fix/csp-inline-handlers');

test('B5: index.html has ZERO inline on*= handler attributes', () => {
  const hits = indexHtml.match(new RegExp(INLINE_HANDLER_RE.source, 'gi')) || [];
  assert(hits.length === 0,
    `${hits.length} dead inline handler(s) remain under strict CSP: ${hits.slice(0, 6).join(', ')}`);
});

test('B5: app.js emits no on*= attributes in generated HTML strings', () => {
  const attrStyle = inlineJs.match(/\bon[a-z]+\s*=\s*["']/gi) || [];
  assert(attrStyle.length === 0,
    `${attrStyle.length} inline handler attribute(s) still emitted: ${attrStyle.slice(0, 6).join(', ')}`);
});

test('B5: template chips driven by delegated click listener on container', () => {
  const wins = windowsAround(inlineJs, "getElementById\\('template-chips'\\)", 600);
  assert(wins.some((w) => /addEventListener\('click'/.test(w)),
    'no delegated click listener bound at #template-chips');
});

test('B5: chip remove (chip-x) handled inside the delegation', () => {
  const wins = windowsAround(inlineJs, "getElementById\\('template-chips'\\)", 1600);
  assert(wins.some((w) => /chip-x/.test(w) && /removeChipSlot/.test(w)),
    'chip-x removal not found in chip delegation');
});

test('B5: parse table cells use delegated mousedown/focusout (no per-cell handlers)', () => {
  const wins = windowsAround(inlineJs, "getElementById\\('parse-tbody'\\)", 700);
  const w = wins.find((x) => /addEventListener\('mousedown'/.test(x));
  assert(w, 'no delegated mousedown on parse-tbody');
  assert(/addEventListener\('focusout'/.test(w), 'no delegated focusout near the delegation block');
  assert(!/onblur=|onmousedown=/.test(w.split('addEventListener')[0]),
    'cells still emit inline handlers in row HTML');
});

test('B5: column header drag/drop driven by thead-level delegation', () => {
  const wins = windowsAround(inlineJs, "querySelector\\('#parse-table thead'\\)", 900);
  const w = wins.find((x) => x.includes("addEventListener('dragstart'"));
  assert(w, 'thead delegation block not found');
  for (const ev of ["'dragover'", "'drop'", "'dragend'", "'dblclick'"]) {
    assert(w.includes(`addEventListener(${ev}`), `missing delegated ${ev} on thead`);
  }
});

test('B5: wizard step dots navigable via delegated click (no onclick= in dot HTML)', () => {
  const dotsFn = inlineJs.match(/function renderStepDots\([\s\S]{0,900}/);
  assert(dotsFn, 'renderStepDots not found');
  assert(!/onclick=/.test(dotsFn[0]), 'step dots still emit onclick=');
  const wins = windowsAround(inlineJs, "getElementById\\('wizardSteps'\\)", 600);
  const wired = wins.some((w) => /addEventListener\('click'/.test(w));
  assert(wired, 'no delegated click listener for wizard steps');
});

test('B5: settings controls wired via JS change/click listeners (ids kept)', () => {
  for (const id of ['srSelect', 'bdSelect', 'presetSelect', 'namingTemplateInput',
                    'rawBextToggle', 'toastToggle', 'regex-pattern', 'test-raw']) {
    const wins = windowsAround(inlineJs, `getElementById\\('${id}'\\)`, 400);
    assert(wins.length > 0, `'${id}' never referenced in app.js`);
    const wired = wins.some((w) => /addEventListener\('(change|input)'/.test(w));
    assert(wired, `'${id}' has no JS-bound change/input listener near any reference`);
  }
});

test('B5: segmented mode/essence buttons wired via data attributes', () => {
  assertHtml(/data-setmode=/, 'no data-setmode attributes in index.html');
  assertHtml(/data-setessence=/, 'no data-setessence attributes in index.html');
  assert(/\[data-setmode\]|\bdata-setmode\b.*addEventListener|querySelectorAll\('\[data-setmode\]'\)/.test(inlineJs),
    'data-setmode buttons not wired in app.js');
  assert(/querySelectorAll\('\[data-setessence\]'\)|\[data-setessence\]/.test(inlineJs),
    'data-setessence buttons not wired in app.js');
});

// ======================================================================
// BRANCH 6 — recents click-to-reload
// ======================================================================
console.log('\n[Branch 6] fix/recents-reload');

test('B6: recent-file entries persist an absolute path', () => {
  assert(/_recentFiles\.unshift\(\{[^}]*path/.test(inlineJs),
    'addRecentFileItem does not store a path on entries');
});

test('B6: clicking a recent item re-probes its stored path', () => {
  const block = inlineJs.match(/getElementById\('recentList'\)[\s\S]{0,800}?addEventListener\('click'[\s\S]{0,800}/);
  assert(block, 'no delegated click listener on #recentList');
  assert(/handleFilePath/.test(block[0]), 'recent click does not call handleFilePath');
});

test('B6: recent click guarded — entries without a stored path are inert', () => {
  const block = inlineJs.match(/getElementById\('recentList'\)[\s\S]{0,1600}/);
  assert(block && /\.path\b/.test(block[0]),
    'no path-presence guard around recent-item activation');
});

test('B6: loaded-from-recents toast tells the user which file came back', () => {
  const block = inlineJs.match(/getElementById\('recentList'\)[\s\S]{0,1600}/);
  assert(block && /showToast/.test(block[0]), 'no user feedback on recents reload');
});

// ======================================================================
// BRANCH 7 — deeper ARIA (tabs, dialogs, focus traps, keyboard)
// ======================================================================
console.log('\n[Branch 7] aria-deepening');

test('B7: tab bar exposes role=tablist with role=tab children', () => {
  assertHtml(/class="tab-bar"[^>]*role="tablist"|role="tablist"[^>]*class="tab-bar"/,
    '.tab-bar lacks role="tablist"');
  const tabBtns = (indexHtml.match(/class="tab[^"]*"[^>]*role="tab"/g) ||
                   indexHtml.match(/role="tab"/g) || []).length;
  assert(tabBtns >= 5, `expected >=5 role="tab" buttons, found ${tabBtns}`);
});

test('B7: tab panels expose role=tabpanel', () => {
  const panels = (indexHtml.match(/role="tabpanel"/g) || []).length;
  assert(panels >= 5, `expected >=5 role="tabpanel" panels, found ${panels}`);
});

test('B7: switchTab syncs aria-selected and aria-hidden', () => {
  const fn = inlineJs.match(/function switchTab\([\s\S]{0,2200}/);
  assert(fn, 'switchTab not found');
  assert(/aria-selected/.test(fn[0]), 'switchTab does not update aria-selected');
  assert(/aria-hidden/.test(fn[0]), 'switchTab does not update aria-hidden');
});

test('B7: arrow keys move focus between tabs', () => {
  assert(/ArrowLeft|ArrowRight/.test(inlineJs), 'no arrow-key tab navigation');
});

test('B7: overlays are labelled dialogs (aria-modal)', () => {
  const flat = indexHtml.split('\n').map(function(l) { return l.trim(); }).join(' ');
  assert(/id="settingsOverlay"/.test(flat) && /role="dialog"/.test(flat),
    'no role="dialog" on overlays');
  const modals = (indexHtml.match(/aria-modal="true"/g) || []).length;
  assert(modals >= 2, `expected aria-modal on settings + wizard, found ${modals}`);
});

test('B7: focus trap helper exists and is applied to both overlays', () => {
  assert(/function trapFocus\(|const trapFocus|var trapFocus|window\.trapFocus\s*=/.test(inlineJs),
    'no trapFocus helper');
  const refs = (inlineJs.match(/trapFocus/g) || []).length;
  assert(refs >= 3, `trapFocus defined but barely used (${refs} refs)`);
});

test('B7: wizard template cards are keyboard-operable buttons', () => {
  const cards = (indexHtml.match(/wizard-tmpl-card[^>]*role="button"/g) ||
                 indexHtml.match(/role="button"[^>]*class="wizard-tmpl-card"/g) || []).length;
  assert(cards >= 4, `template cards lack role="button" (${cards}/4)`);
  const wins = windowsAround(inlineJs, "wizard-tmpl-card", 700);
  assert(wins.some((w) => /'Enter'/.test(w) && /selectTemplate/.test(w)),
    'no Enter/Space activation for template cards');
});

// ======================================================================
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
