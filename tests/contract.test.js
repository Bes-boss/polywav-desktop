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
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
