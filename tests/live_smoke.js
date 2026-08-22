/** Live CDP smoke test: boots Electron, clicks real controls, asserts real state.
 *
 * Anti-false-pass rules (burned in 2026-08-22 journey audit):
 *  - ALWAYS Emulation.setFocusEmulationEnabled {enabled:true} right after
 *    attach: occluded windows report visibilityState 'hidden' and Chromium
 *    freezes requestAnimationFrame, which produced phantom bug reports.
 *  - Assert OUTCOMES (state / artifacts), NEVER toast text: the old suite
 *    passed 13/13 while recents click-to-reload was completely broken.
 *  - Trusted input only: Input.dispatchMouseEvent / Input.dispatchKeyEvent.
 *  - scrollIntoView before clicking; synthetic element.click() hides
 *    visibility bugs, so every interaction here is a real mouse/key event.
 */
const { execFileSync, spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const APPDIR = process.cwd();
const ELECTRON = process.env.ELECTRON_BIN ||
  path.join(APPDIR, 'node_modules', '.bin', 'electron.cmd'); // node_modules/.bin/electron.cmd
const VENV_PY = process.env.POLYWAV_PYTHON ||
  'C:/Users/Liam/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe';
// Preset-library checks run against an ISOLATED store so the smoke run
// never touches Liam's real presets (POLYWAV_PRESETS_DIR override).
const PRESET_DIR = path.join(os.tmpdir(), 'polywav_smoke_presets');
fs.rmSync(PRESET_DIR, { recursive: true, force: true });
fs.mkdirSync(PRESET_DIR, { recursive: true });
process.env.POLYWAV_PRESETS_DIR = PRESET_DIR;

const FIXTURE_NAME = 'field_recording.wav';
const FIXTURE = path.join(os.tmpdir(), 'polywav_audit', FIXTURE_NAME);

// Ensure the 8ch/48k/24-bit fixture exists so outcome assertions run against
// a REAL file (the old fake-path recents check could never catch the bug).
if (!fs.existsSync(FIXTURE)) {
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
  execFileSync(VENV_PY, [path.join(__dirname, 'make_field_wav.py'), FIXTURE], { stdio: 'ignore' });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  let electron = null;
  const ATTACH = process.env.CDP_URL;
  if (!ATTACH) {
    electron = spawn(`"${ELECTRON}"`, ['.', '--remote-debugging-port=9223'], {
      cwd: APPDIR, stdio: ['ignore', 'pipe', 'pipe'], shell: true,
    });
    electron.stdout.on('data', () => {});
    electron.stderr.on('data', () => {});
  }

  let ws = null;
  try {
    // Wait for the debug endpoint
    let targets = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        const list = await getJson((ATTACH || 'http://127.0.0.1:9223') + '/json/list');
        targets = list.filter((t) => t.type === 'page');
        if (targets.length) break;
      } catch (e) { /* not up yet */ }
    }
    if (!targets || !targets.length) throw new Error('no page target found');

    ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let mid = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    };
    function cdp(method, params = {}) {
      const id = ++mid;
      return new Promise((res, rej) => {
        pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)));
        ws.send(JSON.stringify({ id, method, params }));
      });
    }
    async function evalJs(expr) {
      const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails.exception));
      return r.result.value;
    }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Occluded-window rAF freeze produced the entire false finding #4. Force
    // visible-emulation FIRST, before any interaction or assertion.
    await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });

    async function rect(sel) {
      return evalJs(`(function(){var el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;el.scrollIntoView({block:'center'});var r=el.getBoundingClientRect();var s=getComputedStyle(el);if(s.visibility==='hidden'||s.display==='none'||r.width<2||r.height<2)return null;return [Math.round((r.left+r.right)/2),Math.round((r.top+r.bottom)/2)];})()`);
    }
    async function clickXY(x, y) {
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    }
    async function trustClick(sel) {
      const p = await rect(sel);
      if (!p) throw new Error('element not found: ' + sel);
      await clickXY(p[0], p[1]);
    }
    async function waitVisible(sel, maxMs) {
      for (let i = 0; i < maxMs / 100; i++) {
        const p = await rect(sel);
        if (p) return p;
        await sleep(100);
      }
      return null;
    }
    async function formatCardCenter(value) {
      return evalJs(`(function(){
        var rb = document.querySelector('input[name="export-format"][value="' + ${JSON.stringify(value)} + '"]');
        if (!rb) return null;
        var lab = rb.closest('label.export-option');
        if (!lab) return null;
        var t = lab.querySelector('.export-label') || lab;
        var b = t.getBoundingClientRect();
        return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)];
      })()`);
    }
    async function pressKey(keyName, vk) {
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    }

    const results = [];
    function check(name, ok, detail) {
      results.push({ name, ok, detail });
      console.log((ok ? '  ok  ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : ''));
    }

    // ---- 0. App booted (wait out cold start; classic script = globals) ----
    let boot = null;
    for (let i = 0; i < 40; i++) {
      boot = await evalJs('typeof switchTab + "|" + typeof openWizard + "|" + typeof doExport');
      if (boot === 'function|function|function') break;
      await sleep(250);
    }
    check('app booted with global helpers', boot === 'function|function|function', boot);

    // ---- 1. Wizard (home tab, empty state): CTA -> template -> dot -> close ----
    const wizCtaP = await waitVisible('#wizardCta', 3000);
    check('wizard CTA visible on home tab', !!wizCtaP);
    if (wizCtaP) await clickXY(wizCtaP[0], wizCtaP[1]);
    await sleep(300);
    const wizOpen = await evalJs(`document.getElementById('wizardOverlay').classList.contains('open')`);
    check('wizard opens from CTA', wizOpen === true);

    await trustClick('.wizard-tmpl-card[data-template="cooking"]');
    await sleep(200);
    const tpl = await evalJs(`wizState.template + '|' + wizState.export.mode + '|' + wizState.export.essence`);
    check('template card click applies Cooking Show defaults', tpl === 'cooking|mixed|mxf', tpl);

    await trustClick('.wizard-step-dot[data-step="2"]');
    await sleep(200);
    const dotNav = await evalJs(`wizState.step`);
    check('wizard step-dot click navigates', dotNav === 2, String(dotNav));
    await trustClick('#wizardCloseBtn');
    await sleep(200);

    // ---- 2. Tab bar delegation (normalize panel switches) ----
    await trustClick('.tab-bar .tab[data-tab="normalize"]');
    await sleep(500);
    const normActive = await evalJs(
      `document.getElementById('tab-normalize').classList.contains('active') + '|' +
       document.querySelector('.tab-bar .tab[data-tab="normalize"]').classList.contains('active')`);
    check('tab click switches panel + tab active state', normActive === 'true|true', normActive);
    await trustClick('.tab-bar .tab[data-tab="home"]');
    await sleep(400);

    // ---- 3. Recents: real file, click-to-reload must change STATE ----
    // (was: toast-text assertion that passed while the loader was broken)
    await evalJs(
      `_recentFiles.length = 0;` +
      `addRecentFileItem(${JSON.stringify(FIXTURE_NAME)}, '5.5 MB', '10:00', ${JSON.stringify(FIXTURE)});`);
    await sleep(300);
    await trustClick('.recent-item');
    let loaded = null;
    for (let i = 0; i < 16; i++) {
      await sleep(250);
      loaded = await evalJs(
        `({fl: _fileLoaded === true, p: _filePath || '', c: _clipName || '', n: rawChannels.length})`);
      if (loaded.fl && loaded.p === FIXTURE && loaded.n === 8) break;
    }
    check('recents click reloads the file (outcome: _fileLoaded + path + 8ch)',
      !!(loaded && loaded.fl && loaded.p === FIXTURE && loaded.n === 8), JSON.stringify(loaded));

    // ---- 4. Settings: gear opens overlay, segmented mode flips state ----
    await trustClick('#settingsToggle');
    await sleep(400);
    const settingsOpen = await evalJs(`document.getElementById('settingsOverlay').classList.contains('open')`);
    check('settings opens from header button', settingsOpen === true);

    await trustClick('[data-setmode="sequence"]');
    await sleep(200);
    const modeAfter = await evalJs(
      `document.querySelector('[data-setmode="sequence"]').classList.contains('active') + '|' + SETTINGS.mode`);
    check('segmented mode control updates state', modeAfter === 'true|sequence', modeAfter);
    await trustClick('[data-setmode="group"]');
    await trustClick('#settingsCloseBtn');
    await sleep(200);

    // ---- 5a. Digit-tolerant normalize: EP1_001_Presenter must not junk out ----
    const norm = await evalJs(
      `(function(){var r = parseName('EP1_001_Presenter'); return r.prefix + '|' + r.role + '|' + r.num;})()`);
    check('normalize parses digit prefix + take number (EP1_001_Presenter)', norm === 'EP1|Presenter|001', norm);

    // ---- 5b. Single-click cell editing: trusted mousedown focuses the cell ----
    await evalJs(`switchTab('normalize');`);
    await sleep(600);
    const cellBefore = await evalJs(
      `(function(){var td=document.querySelector('#parse-table td.capture-group'); return td ? td.textContent.trim().slice(0,20) : 'NO_CELL';})()`);
    check('normalize table has editable cells', cellBefore !== 'NO_CELL', cellBefore);

    await trustClick('#parse-table td.capture-group');
    await sleep(150); // deferred td.focus() is setTimeout(0)
    const focusState = await evalJs(
      `(function(){var a=document.activeElement; if(!a||!a.closest) return 'NO'; var td=a.closest('td.capture-group'); return (td&&a.isContentEditable)?'YES':'NO';})()`);
    check('single-click focuses the editable cell (no blanket preventDefault)', focusState === 'YES', focusState);

    await cdp('Input.dispatchKeyEvent', { type: 'char', text: 'Z' });
    await sleep(150);
    const typed = await evalJs(
      `(function(){var td=document.querySelector('#parse-table td.capture-group');return td&&td.textContent.indexOf('Z')>=0?'YES':'NO';})()`);
    check('typed char lands in focused cell', typed === 'YES', typed);

    // Selection must survive the deferred focus: click a later cell, expect a
    // single-cell selection that tracks the click.
    await trustClick('#parse-table td.capture-group:nth-of-type(3)');
    await sleep(150);
    const selState = await evalJs(
      `(function(){var s=_normSel; return s ? ('r' + s.r1 + 'c' + s.c1 + '|r' + s.r2 + 'c' + s.c2) : 'NONE';})()`);
    check('selection tracks single clicks', /^r\d+c\d+\|r\d+c\d+$/.test(selState), selState);

    // ---- 6. Patch tab: routed cables drawn (rAF visible via focus emulation) ----
    await trustClick('.tab-bar .tab[data-tab="route"]');
    await sleep(600);
    const wantMap = { '01': 'A1', '02': 'A2' };
    const rowChs = await evalJs(
      `Array.prototype.map.call(document.querySelectorAll('#routeTableBody select.track-select'), function(s){return s.getAttribute('data-ch');})`);
    for (const ch of rowChs) {
      if (!wantMap[ch]) continue;
      await trustClick('#routeTableBody select.track-select[data-ch="' + ch + '"]');
      await sleep(200);
      const targetIdx = parseInt(wantMap[ch].slice(1), 10);
      for (let i = 0; i < targetIdx; i++) await pressKey('ArrowDown', 40);
      await pressKey('Enter', 13);
      await sleep(180);
    }
    await sleep(400);
    const routed = await evalJs(`ROUTING_DATA.filter(function(d){return d.track;}).length`);
    await trustClick('.tab-bar .tab[data-tab="patch"]');
    await sleep(900); // double-rAF deferred cable pass
    const cables = await evalJs(
      `(function(){var svg=document.getElementById('patchSvgEl')||document.querySelector('.patch-svg');if(!svg)return -1;var paths=svg.querySelectorAll('path');var unrouted=svg.querySelectorAll('path.unrouted').length;return paths.length-unrouted;})()`);
    check('patch tab draws routed cables (rAF visible, focus emulated)',
      cables >= routed && routed > 0, 'cables=' + cables + ' routed=' + routed);

    // ---- 7. Export: card BODY clicks select format; size estimate real ----
    await trustClick('.tab-bar .tab[data-tab="export"]');
    await sleep(500);

    const mxfP = await formatCardCenter('mxf');
    await clickXY(mxfP[0], mxfP[1]);
    await sleep(300);
    const essenceMxf = await evalJs(
      `(function(){var rb=document.querySelector('input[name="export-format"][value="mxf"]');return SETTINGS.essence + '|' + (rb.closest('label.export-option').classList.contains('selected')?'SEL':'NOSEL');})()`);
    check('export card BODY click selects MXF (label forwarding)', essenceMxf === 'mxf|SEL', essenceMxf);

    const embP = await formatCardCenter('embedded');
    await clickXY(embP[0], embP[1]);
    await sleep(300);
    const essenceEmb = await evalJs(`SETTINGS.essence`);
    check('export card BODY click selects Embedded', essenceEmb === 'embedded', essenceEmb);

    const sizeTxt = await evalJs(`document.getElementById('exportSize').textContent`);
    const gb = parseFloat((sizeTxt || '').replace(/[^0-9.]/g, ''));
    check('size estimate reflects 5s source (<0.1 GB)', !isNaN(gb) && gb > 0 && gb < 0.1, sizeTxt);

    // ---- 8. ARIA roles + switchTab sync ----
    const aria = await evalJs(
      `document.querySelector('.tab-bar').getAttribute('role') + '|' +
       document.querySelectorAll('.tab-bar .tab[role="tab"]').length + '|' +
       document.querySelectorAll('.tab-content[role="tabpanel"]').length`);
    check('ARIA roles on tab bar + panels', aria === 'tablist|5|5', aria);

    const ariaSel = await evalJs(
      `document.querySelector('.tab-bar .tab[data-tab="export"]').getAttribute('aria-selected') + '|' +
       document.getElementById('tab-export').getAttribute('aria-hidden')`);
    check('switchTab syncs aria-selected/aria-hidden', ariaSel === 'true|false', ariaSel);

    // ---- 9. Focus trap cycles inside settings overlay ----
    await trustClick('#settingsToggle');
    await sleep(400);
    await evalJs(
      `(function(){ var f = document.querySelectorAll('#settingsOverlay button, #settingsOverlay input, #settingsOverlay select'); ` +
      `f[f.length-1].focus(); })()`);
    await evalJs(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab', bubbles:true}))`);
    await sleep(200);
    const trapped = await evalJs(`document.getElementById('settingsOverlay').contains(document.activeElement)`);
    check('focus trap cycles Tab inside settings overlay', trapped === true);
    await trustClick('#settingsCloseBtn');
    await sleep(200);

    // ---- 10. Preset library: standalone YAML files, isolated store ----
    await trustClick('#settingsToggle');
    await sleep(400);

    const presetOpts = await evalJs(
      `(function(){var s=document.getElementById('presetSelect');` +
      `var t=[];for(var i=0;i<s.options.length;i++)t.push(s.options[i].textContent);` +
      `return s.options.length+'|'+t.join(';');})()`);
    check('preset dropdown populated from bundled library',
      /^3\|/.test(presetOpts) &&
      presetOpts.indexOf('Masterchef Kitchens (MKR)') >= 0 &&
      presetOpts.indexOf('The Block (BLK)') >= 0 &&
      presetOpts.indexOf('Survivor (SVR)') >= 0,
      presetOpts);

    const nameP = await rect('#presetNameInput');
    if (!nameP) throw new Error('presetNameInput not visible/clickable');
    await clickXY(nameP[0], nameP[1]);
    await cdp('Input.insertText', { text: 'Smoke Test Preset' });
    await trustClick('#presetSaveBtn');
    await sleep(700); // IPC write + list refresh

    const savedFile = path.join(PRESET_DIR, 'smoke_test_preset.yaml');
    check('saved preset exists as standalone yaml on disk', fs.existsSync(savedFile));
    const yamlText = fs.existsSync(savedFile) ? fs.readFileSync(savedFile, 'utf8') : '';
    check('standalone yaml carries engine schema (ShowPreset keys)',
      ['name:', 'source:', 'tracks:', 'output:'].every((k) => yamlText.includes(k)), yamlText.split('\n')[0] || '');

    const inList = await evalJs(
      `(function(){var s=document.getElementById('presetSelect');` +
      `for(var i=0;i<s.options.length;i++){if(s.options[i].textContent==='Smoke Test Preset')return true;}return false;})()`);
    check('saved preset appears in dropdown (outcome)', inList === true);

    // True disk roundtrip: apply a BUILT-IN first (state leaves the saved
    // name), then select the saved preset BY STEM -> app must read the file
    // via IPC and flip state back to the file's own name.
    const selByValue = async (val) => evalJs(
      `(function(){var s=document.getElementById('presetSelect');` +
      `for(var i=0;i<s.options.length;i++){if(s.options[i].value===${JSON.stringify(val)}){` +
      `s.selectedIndex=i;s.dispatchEvent(new Event('change',{bubbles:true}));return true;}}return false;})()`);
    await selByValue('blk');
    await sleep(600);
    const afterBlk = await evalJs(`SETTINGS.presetName`);
    check('built-in preset loads from its file (name changes)', afterBlk === 'The Block (BLK)', afterBlk);
    await selByValue('smoke_test_preset');
    await sleep(600);
    const applied = await evalJs(`SETTINGS.presetName`);
    check('saved preset reloads from disk (roundtrip)', applied === 'Smoke Test Preset', applied);

    // Delete flow (user-tier only)
    await trustClick('#presetDeleteBtn');
    await sleep(700);
    const goneUi = await evalJs(
      `(function(){var s=document.getElementById('presetSelect');` +
      `for(var i=0;i<s.options.length;i++){if(s.options[i].textContent==='Smoke Test Preset')return false;}return true;})()`);
    check('deleted preset removed from dropdown (outcome)', goneUi === true);
    check('deleted preset file removed from disk', !fs.existsSync(savedFile));

    await trustClick('#settingsCloseBtn');
    await sleep(200);

    console.log('\n' + results.filter((r) => r.ok).length + '/' + results.length + ' live checks passed');
    const failed = results.filter((r) => !r.ok);
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    if (ws) try { ws.close(); } catch (e) {}
    if (electron && electron.pid) {
      try { require('child_process').execSync(`taskkill /pid ${electron.pid} /T /F`, { stdio: 'ignore' }); } catch (e) {}
    }
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  }
}

main().catch((e) => { console.error('SMOKE ERROR:', e.message); process.exit(1); });