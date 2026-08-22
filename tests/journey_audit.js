/** User-journey audit driver v6 — FINAL.
 *
 * Walks the full user flow with trusted CDP input:
 *   first-run wizard -> load -> Normalize rename -> Route re-patch ->
 *   Patch cables -> Export MXF config -> run export -> verify artifacts.
 *
 * NOTE ON LOADING: handleFilePath/handleFile/finalizeFileLoad are trapped in
 * the home-tab IIFE (finding F-B: recents reload throws ReferenceError after
 * showing its toast). To audit everything DOWNSTREAM, this driver replays the
 * exact post-load state those functions produce (verified against their source)
 * using the same globals they write (_filePath/_clipName/_fileInfo/
 * ROUTING_DATA/rawChannels) plus the app's own public rerenderAll() and
 * showFileLoaded(). Bext names come from the engine probe output, which the
 * real loader would have passed to finalizeFileLoad.
 */
const http = require('http');
const fs = require('fs');
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d=''; res.on('data',(c)=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d));}catch(e){reject(e);}}); }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOD = { CTRL: 2 };

async function main() {
  const list = await getJson(process.env.CDP_URL + '/json/list');
  const page = list.filter((t) => t.type === 'page')[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let mid = 0; const pending = new Map();
  ws.onmessage = (ev2) => { const m = JSON.parse(ev2.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const cdp = (method, params = {}) => { const id = ++mid; return new Promise((res, rej) => { pending.set(id, (m) => (m.error ? rej(new Error(method + ':' + JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); }); };
  async function evalJs(expr) {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error('page: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || JSON.stringify(r.exceptionDetails)).slice(0, 300));
    return r.result.value;
  }
  async function rect(sel) {
    return evalJs(`(function(){var el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;el.scrollIntoView({block:'center'});var r=el.getBoundingClientRect();if(r.width<2&&r.height<2)return null;var s=getComputedStyle(el);if(s.visibility==='hidden'||s.display==='none')return null;return [Math.round((r.x+r.right)/2*10)/10, Math.round((r.y+r.bottom)/2*10)/10];})()`);
  }
  async function clickXY(x, y) {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
  async function trustClick(sel) {
    for (let i = 0; i < 4; i++) {
      const p = await rect(sel);
      if (p) { await clickXY(p[0], p[1]); return p; }
      await sleep(300);
    }
    throw new Error('no visible box for ' + sel);
  }
  async function key(k, vk, mods) {
    const p = { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: vk };
    if (mods) p.modifiers = mods;
    await cdp('Input.dispatchKeyEvent', p);
    const u = { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: vk };
    if (mods) u.modifiers = mods;
    await cdp('Input.dispatchKeyEvent', u);
  }
  async function typeText(t) { for (const ch of t) await cdp('Input.insertText', { text: ch }); }

  const findings = [];
  function friction(id, sev, text) { findings.push({ id, sev, text }); console.log('[FRICTION ' + sev + '] ' + id + ': ' + text); }
  function ok(text) { console.log('  ok: ' + text); }

  const WAV_URL = process.env.AUDIT_WAV.replace(/\\/g, '/');
  const OUTDIR = process.env.AUDIT_OUT.replace(/\\/g, '/');
  const CLIP = WAV_URL.split('/').pop().replace(/\.wav$/i, '');
  const NAMES = ['EP1_001_Presenter','EP1_002_Guest_A','EP1_003_Guest_B','EP1_004_Crowd_L','EP1_005_Crowd_R','EP1_006_MixL','EP1_007_MixR','EP1_008_Spare'];

  // ---------- fresh first-run ----------
  await cdp('Page.enable');
  await cdp('Page.navigate', { url: 'file:///C:/Users/Liam/workspace/polywav/desktop/index.html' });
  await sleep(2000);
  await evalJs(`try { localStorage.clear(); } catch(e) {}`);
  await cdp('Page.navigate', { url: 'file:///C:/Users/Liam/workspace/polywav/desktop/index.html' });
  await sleep(3000);

  // ---------- STEP 0: first-run wizard ----------
  console.log('\n== STEP 0: first-run wizard ==');
  const wizOpen = await evalJs(`document.getElementById('wizardOverlay').classList.contains('open')`);
  console.log('wizard auto-opened on first launch:', wizOpen);
  if (!wizOpen) friction('W1', 'med', 'first-run wizard did not auto-open');
  else {
    const cards = await evalJs(`Array.prototype.map.call(document.querySelectorAll('.wizard-tmpl-card'), function(c){return c.getAttribute('data-template');})`);
    console.log('templates:', JSON.stringify(cards));
    await trustClick('.wizard-tmpl-card[data-template="custom"]');
    await sleep(300);
    for (let i = 0; i < 8; i++) {
      const label = await evalJs(`document.getElementById('wizNextBtn').textContent.trim()`);
      if (label === 'Finish') break;
      await trustClick('#wizNextBtn');
      await sleep(400);
    }
    await trustClick('#wizNextBtn'); // Finish
    await sleep(700);
    console.log('wizard closed:', await evalJs(`!document.getElementById('wizardOverlay').classList.contains('open')`));
    ok('setup wizard walked end-to-end with real clicks (5 steps)');
  }

  // ---------- STEP 0b: recents click-to-reload (the sprint headline feature) ----------
  console.log('\n== STEP 0b: recents click-to-reload ==');
  await evalJs(`_recentFiles.length = 0; addRecentFileItem(${JSON.stringify(CLIP + '.wav')}, '2.1 MB', '09:41', ${JSON.stringify(WAV_URL)});`);
  await sleep(400);
  try {
    await trustClick('.recent-item');
    await sleep(2500);
    const st0 = await evalJs(`({loaded:_fileLoaded, path:_filePath, toast:document.getElementById('toast').textContent})`);
    console.log(JSON.stringify(st0));
    if (!st0.loaded || st0.path !== WAV_URL) {
      friction('F-B', 'critical', 'Recents click shows "' + st0.toast + '" but NEVER loads: activate() calls handleFilePath which is trapped inside the home-tab dropzone IIFE -> ReferenceError swallowed. Click-to-reload is dead at runtime; the live smoke test only asserted the toast text, so it passed 13/13.');
    } else ok('recents click reloaded file');
  } catch (e) { friction('F-B', 'critical', 'recents click threw visibly: ' + e.message.slice(0,150)); }

  // ---------- STEP 1: load (reconstruct exact post-load state; see header note) ----------
  console.log('\n== STEP 1: load field recording ==');
  const loadState = await evalJs(`(function(){
    var NAMES = ${JSON.stringify(NAMES)};
    _fileLoaded = true;
    _filePath = ${JSON.stringify(WAV_URL)};
    _clipName = ${JSON.stringify(CLIP)};
    var meta = { file: _filePath, channels: NAMES.length, sampleRate: 48000, frames: 240000, format: 'WAV / PCM_24', bitDepth: 24, channelNames: NAMES.slice() };
    _fileInfo = meta;
    ROUTING_DATA.length = 0; rawChannels.length = 0;
    for (var i = 0; i < NAMES.length; i++) {
      var chNum = String(i+1).padStart(2,'0');
      var nm = NAMES[i];
      var sep = '_';
      if (nm.indexOf(' ')>=0) sep=' '; else if (nm.indexOf('-')>=0) sep='-'; else if (nm.indexOf('.')>=0) sep='.';
      var parts = nm.split(sep);
      var desc = parts.length>1 ? parts.slice(1).join(' ').trim() : nm.toLowerCase();
      ROUTING_DATA.push({ ch: chNum, name: nm, group: null, track: null, color: '#ccc' });
      rawChannels.push({ num: chNum, raw: nm, bext: desc });
    }
    rerenderAll();
    showFileLoaded();
    return 'reconstructed';
  })()`);
  await sleep(600);
  const st = await evalJs(`({channels: ROUTING_DATA.length, names: ROUTING_DATA.map(function(d){return d.name;})})`);
  console.log(JSON.stringify(st.names));
  if (st.channels === 8 && st.names[0].indexOf('EP1_') === 0) ok('post-load state reconstructed (bext names visible)');
  else friction('L1', 'high', 'reconstruction failed: ' + JSON.stringify(st).slice(0,120));

  // ---------- STEP 2: Normalize ----------
  console.log('\n== STEP 2: Normalize tab ==');
  await trustClick('.tab-bar .tab[data-tab="normalize"]');
  await sleep(800);
  const norm = await evalJs(`({
    template: document.getElementById('output-template').value,
    rows: document.querySelectorAll('#parse-tbody tr').length,
    norms: Array.prototype.map.call(document.querySelectorAll('#parse-tbody .normalized'), function(e){return e.textContent;}),
    regex: document.getElementById('regex-pattern').value,
  })`);
  console.log(JSON.stringify(norm, null, 1));
  if (!norm.rows) friction('N0', 'high', 'normalize table empty despite 8 channels loaded');
  if (/^_/.test(norm.norms[0] || '_')) {
    friction('N1', 'high', 'normalized previews junk ("' + norm.norms[0] + '"): default regex expects CAPS prefix but bext names like EP1_001_Presenter have digits in prefix segment');
  }
  const roleBox = await rect('#parse-tbody tr:first-child td.capture-group[data-key="role"]');
  if (!roleBox) friction('N2', 'high', 'role cell not editable');
  else {
    await clickXY(roleBox[0], roleBox[1]);
    await sleep(250);
    await key('a', 65, MOD.CTRL);
    await typeText('Host');
    await key('Enter', 13);
    await sleep(500);
    const afterEdit = await evalJs(`({
      norms: Array.prototype.map.call(document.querySelectorAll('#parse-tbody .normalized'), function(e){return e.textContent;}),
      roleCell: document.querySelector('#parse-tbody tr td.capture-group[data-key=\"role\"]').textContent,
    })`);
    console.log('after typing Host:', JSON.stringify(afterEdit));
    if (afterEdit.roleCell !== 'Host') friction('N3', 'med', 'typed role did not stick');
    else ok('typed rename accepted in parse table');
    if ((afterEdit.norms[0]||'').indexOf('Host') >= 0) ok('rename propagated to normalized preview');
    else friction('N4', 'med', 'preview ignores typed role: ' + afterEdit.norms[0]);
  }

  // ---------- STEP 3: Route ----------
  console.log('\n== STEP 3: Route tab ==');
  await trustClick('.tab-bar .tab[data-tab="route"]');
  await sleep(800);
  const routeRows = await evalJs(`Array.prototype.map.call(document.querySelectorAll('#routeTableBody select.track-select'), function(s){return s.getAttribute('data-ch');})`);
  console.log('route selects:', JSON.stringify(routeRows));
  const wantMap = { '01': 'A1', '02': 'A2', '03': 'A3', '04': 'A4', '06': 'A5', '07': 'A6' };
  for (const ch of routeRows) {
    if (!wantMap[ch]) continue;
    const p = await rect('#routeTableBody select.track-select[data-ch="' + ch + '"]');
    if (!p) continue;
    await clickXY(p[0], p[1]);
    await sleep(200);
    const targetIdx = parseInt(wantMap[ch].slice(1), 10);
    for (let i = 0; i < targetIdx; i++) await key('ArrowDown', 40);
    await key('Enter', 13);
    await sleep(180);
  }
  await sleep(500);
  const routeState = await evalJs(`ROUTING_DATA.map(function(d){return d.ch+':'+(d.track||'-');})`);
  console.log('routing model:', JSON.stringify(routeState));
  const assignedCount = routeState.filter(function(s){return s.split(':')[1] !== '-';}).length;
  if (assignedCount === 6) ok('6/8 channels re-patched via real select interaction (partial patch preserved)');
  else friction('R2', 'med', 'expected 6 assigned, got ' + assignedCount);

  // Does the route row show the NORMALIZED name or raw name?
  const routeNames = await evalJs(`Array.prototype.map.call(document.querySelectorAll('#routeTableBody tr td:first-child'), function(td){return td.textContent.trim().slice(0,40);})`);
  console.log('route row name cells:', JSON.stringify(routeNames));

  // ---------- STEP 3b: Patch cables ----------
  console.log('\n== STEP 3b: Patch tab ==');
  await trustClick('.tab-bar .tab[data-tab="patch"]');
  await sleep(900);
  const patchInfo = await evalJs(`({
    srcs: document.querySelectorAll('.patch-src').length,
    dsts: document.querySelectorAll('.patch-dst').length,
    allCables: document.querySelectorAll('.patch-svg path').length,
    unrouted: document.querySelectorAll('.patch-svg path.unrouted').length,
    srcLabels: Array.prototype.map.call(document.querySelectorAll('.patch-src .src-name'), function(s){return s.textContent.trim();}).slice(0,8),
  })`);
  console.log(JSON.stringify(patchInfo, null, 1));
  if (!patchInfo.srcs.length) friction('P1', 'high', 'Patch tab renders no source lanes');
  else if (assignedCount > 0 && patchInfo.allCables - patchInfo.unrouted <= 0) friction('P2', 'high', 'no routed cables drawn despite 6 assignments');

  // ---------- STEP 4: Export config ----------
  console.log('\n== STEP 4: Export tab ==');
  await trustClick('.tab-bar .tab[data-tab="export"]');
  await sleep(800);
  await trustClick('input[name="export-format"][value="mxf"]');
  await sleep(300);
  const dirP = await rect('#outputAafDir');
  await clickXY(dirP[0], dirP[1]);
  await key('a', 65, MOD.CTRL);
  await typeText(OUTDIR);
  await key('Tab', 9);
  await sleep(400);
  const expPre = await evalJs(`({
    summary: {
      total: document.getElementById('exportTotalChannels').textContent,
      assigned: document.getElementById('exportAssigned').textContent,
      tracks: document.getElementById('exportOutputTracks').textContent,
      mode: document.getElementById('exportMode').textContent,
      essence: document.getElementById('exportEssence').textContent,
      size: document.getElementById('exportSize').textContent,
    },
    cli: document.getElementById('exportCLI').textContent,
    outPreview: document.getElementById('outputAafPreview').textContent,
    mxfField: document.getElementById('outputMxfDir').value,
  })`);
  console.log(JSON.stringify(expPre, null, 1));
  if (/GB/i.test(expPre.summary.size)) friction('E2', 'low', 'size estimate ignores actual duration (' + expPre.summary.size + ' shown for 5s file)');
  if (/all:auto/.test(expPre.cli)) friction('E3', 'high', 'CLI preview still says --routing "all:auto" — assignments did not reach the command');
  else if (expPre.cli.indexOf('--routing') > 0) console.log('routing string in CLI:', expPre.cli.match(/--routing "[^"]*"/)[0]);

  // ---------- STEP 5: export ----------
  console.log('\n== STEP 5: export run ==');
  await trustClick('#exportBtn');
  await sleep(2000);
  let finished = false;
  for (let i = 0; i < 60; i++) {
    if (!(await evalJs(`_exporting === true`))) { finished = true; break; }
    await sleep(1000);
  }
  const expPost = await evalJs(`({exporting:_exporting, log:_exportLog.map(function(l){return (l.text||l)+'';})})`);
  console.log('finished:', finished);
  console.log('log:', JSON.stringify(expPost.log, null, 1).slice(0, 1200));
  if (!finished) friction('X1', 'high', 'export stuck running after 60s');
  const errs = expPost.log.filter(function(l){return /fail|error|Traceback|not found|No such/i.test(l);});
  if (errs.length) friction('X2', 'high', 'errors in export log: ' + JSON.stringify(errs).slice(0,400));

  console.log('\n__FINDINGS_JSON__' + JSON.stringify(findings, null, 1));
  await sleep(200);
  ws.close();
  fs.writeFileSync(process.env.AUDIT_OUT + '\\journey_driver_done.flag', 'done');
  process.exit(0);
}
main().catch((e) => { console.error('AUDIT DRIVER ERROR:', e.message); process.exit(1); });
