/** Shared boot harness for parallel audit agents (2026-08-22).
 *
 * Boots an ISOLATED Polywav Electron instance:
 *   - own --remote-debugging-port
 *   - own --user-data-dir profile
 *   - own POLYWAV_PRESETS_DIR store
 * so multiple agents can run concurrently without stomping each other
 * or Liam's real presets/settings.
 *
 * Usage:
 *   const { boot } = require('./agent_boot');
 *   const s = await boot({ port: 9225, name: 'aesthetics' });
 *   await s.evalJs('1+1');            // Runtime.evaluate (returnByValue)
 *   await s.trustClick('#someSel');   // real mouse events at element center
 *   await s.key('ArrowDown');         // trusted key event
 *   const png = await s.shot();       // Buffer (Page.captureScreenshot)
 *   fs.writeFileSync('out.png', png);
 *   await s.seedRecents([{name,size,time,path}]); // pre-seed + reload
 *   await s.cleanup();                // kills spawned process TREE
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const APPDIR = path.join(__dirname, '..');
const ELECTRON = process.env.ELECTRON_BIN ||
  path.join(APPDIR, 'node_modules', '.bin', 'electron.cmd');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(opts) {
  const port = opts.port;
  const name = opts.name || 'agent';
  const root = path.join(os.tmpdir(), 'polywav_audit_' + name);
  const profile = path.join(root, 'profile');
  const presets = path.join(root, 'presets');
  const shots = opts.shotsDir || path.join(root, 'shots');
  for (const d of [profile, presets, shots]) fs.mkdirSync(d, { recursive: true });
  if (!opts.keepPresets) fs.rmSync(presets, { recursive: true, force: true }), fs.mkdirSync(presets, { recursive: true });

  const child = spawn(`"${ELECTRON}"`, [
    '.', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  ], {
    cwd: APPDIR,
    env: Object.assign({}, process.env, { POLYWAV_PRESETS_DIR: presets }),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  let targets = null;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const list = await getJson(`http://127.0.0.1:${port}/json/list`);
      targets = list.filter((t) => t.type === 'page');
      if (targets.length) break;
    } catch (e) { /* not up yet */ }
  }
  if (!targets || !targets.length) throw new Error('no page target found (boot failed)');

  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let mid = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const cdp = (method, params = {}) => new Promise((res, rej) => {
    const id = ++mid;
    pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });

  // CRITICAL: occluded windows freeze rAF; force focus emulation FIRST.
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });

  async function evalJs(expr) {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || JSON.stringify(r.exceptionDetails)).slice(0, 400));
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
  const VK = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Tab: 9, Space: 32 };
  async function key(k, mods) {
    const vk = VK[k] || 0;
    const base = { key: k, code: k, windowsVirtualKeyCode: vk };
    if (mods) base.modifiers = mods;
    await cdp('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base));
    await cdp('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  }
  async function shot(label) {
    const r = await cdp('Page.captureScreenshot', { format: 'png' });
    const f = path.join(shots, label.replace(/[^a-z0-9_-]+/gi, '_') + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return f;
  }
  async function seedRecents(entries) {
    await evalJs(`localStorage.setItem('polywav-recent', ${JSON.stringify(JSON.stringify(entries))});` +
      `localStorage.setItem('polywav-wizard-done','1');` +
      `localStorage.setItem('polywav-theme','dark');` +
      `location.reload(); 'seeded'`);
    for (let i = 0; i < 30; i++) { await sleep(300); try { if (await evalJs("document.readyState==='complete'")) break; } catch (e) {} }
    await sleep(700);
    // Re-attach after reload: navigation destroys the JS context but our WS
    // session survives; just re-enable emulation for the new document.
    await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  }
  async function consoleLog() {
    return evalJs(`(function(){try{return JSON.parse(sessionStorage.getItem('__audit_console')||'[]')}catch(e){return []}})()`);
  }
  function startConsoleCapture() {
    cdp('Runtime.enable').catch(() => {});
    cdp('Log.enable').catch(() => {});
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
        const txt = (m.params.args || []).map((a) => (a.value !== undefined ? String(a.value) : a.description || '')).join(' ');
        captured.push({ level: m.params.type, text: txt.slice(0, 300) });
      } else if (m.method === 'Runtime.exceptionThrown') {
        const ex = m.params.exceptionDetails;
        captured.push({ level: 'pageerror', text: ((ex.exception && ex.exception.description) || ex.text || '').slice(0, 300) });
      }
    });
  }
  const captured = [];

  return {
    port, name, child, shotsDir: shots, presetsDir: presets, profileDir: profile,
    cdp, evalJs, rect, clickXY, trustClick, key, shot, seedRecents,
    startConsoleCapture, consoleLog: () => captured, sleep,
    cleanup() {
      try { ws.close(); } catch (e) {}
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
    },
  };
}

module.exports = { boot, getJson, sleep, APPDIR };
