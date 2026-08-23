// Backend hardening contract tests — pins the main.js hardening pass (2026-08-23).
// Run: node tests/contract_backend.test.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

// --- B1: single-instance lock present ---------------------------------------
check('B1: single-instance lock guards userData',
  MAIN.includes('requestSingleInstanceLock') && MAIN.includes("second-instance"));

// --- B2: atomic writes for state + presets -----------------------------------
check('B2: atomicWriteFileSync defined and used',
  MAIN.includes('function atomicWriteFileSync') &&
  (MAIN.match(/atomicWriteFileSync\(/g) || []).length >= 4);

// --- B3: probe timeout --------------------------------------------------------
check('B3: probe has a timeout guard',
  MAIN.includes('PROBE_TIMEOUT_MS') && MAIN.includes('clearTimeout'));

// --- B4: export validation ----------------------------------------------------
check('B4: export:start validates input + creates output dir',
  MAIN.includes("Input file not found") && MAIN.includes('mkdirSync(outDir'));

// --- B5: cancel notifies renderer --------------------------------------------
check('B5: export:cancel sends export:cancelled + sets flag',
  /export:cancel[\s\S]{0,1200}exportCancelled = true[\s\S]{0,400}export:cancelled/.test(MAIN));

// --- B6: permission lockdown --------------------------------------------------
check('B6: permission requests denied',
  MAIN.includes('setPermissionRequestHandler') && MAIN.includes('callback(false)'));

// --- B7: navigation locked to our own pages ----------------------------------
check('B7: will-navigate restricted to index.html',
  MAIN.includes("endsWith('/index.html')"));

// --- B8: userData override for tests/portable --------------------------------
check('B8: POLYWAV_USER_DATA override before instance lock',
  MAIN.indexOf('POLYWAV_USER_DATA') < MAIN.indexOf('requestSingleInstanceLock') &&
  MAIN.includes("setPath('userData'"));

// --- B9: listWavs rejects non-directories ------------------------------------
check('B9: fs:listWavs statSync + isDirectory guard',
  MAIN.includes('isDirectory()'));

// --- B10: dead channels stay dead --------------------------------------------
check('B10: shell:openPath absent from main + preload',
  !MAIN.includes("shell:openPath") && !PRELOAD.includes('openPath'));

// --- B11: renderer sandbox intact --------------------------------------------
check('B11: contextIsolation + sandbox + no nodeIntegration',
  MAIN.includes('contextIsolation: true') &&
  MAIN.includes('sandbox: true') &&
  MAIN.includes('nodeIntegration: false'));

// --- B12: main.js parses ------------------------------------------------------
let parses = false;
try { execSync(`node --check "${path.join(ROOT, 'main.js')}"`, { stdio: 'pipe' }); parses = true; } catch (_) {}
check('B12: main.js syntax valid', parses);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
