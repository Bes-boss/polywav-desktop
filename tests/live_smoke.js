/** Live CDP smoke test: boots Electron, clicks real buttons, asserts real state. */
const { execFile, spawn } = require('child_process');
const http = require('http');

const ELECTRON = process.env.ELECTRON_BIN; // node_modules/.bin/electron.cmd
const APPDIR = process.cwd();

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

    const results = [];
    function check(name, ok, detail) {
      results.push({ name, ok, detail });
      console.log((ok ? '  ok  ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : ''));
    }

    // ---- 0. App booted, no renderer errors ----
    const ready = await evalJs('typeof switchTab + "|" + typeof openWizard + "|" + typeof doExport');
    check('app booted with global helpers', ready === 'function|function|function', ready);

    // ---- 1. Tab switching via simulated click (data-nav delegation) ----
    await evalJs(`document.querySelector('.tab-bar .tab[data-tab=\"normalize\"]').click()`);
    await new Promise((r) => setTimeout(r, 500));
    const normActive = await evalJs(
      `document.getElementById('tab-normalize').classList.contains('active') + '|' +
       document.querySelector('.tab-bar .tab[data-tab=\"normalize\"]').classList.contains('active')`);
    check('tab click switches panel + tab active state', normActive === 'true|true', normActive);

    // ---- 2. Settings overlay: open via gear button, segmented control works ----
    await evalJs(`document.getElementById('settingsToggle').click()`);
    await new Promise((r) => setTimeout(r, 300));
    const settingsOpen = await evalJs(`document.getElementById('settingsOverlay').classList.contains('open')`);
    check('settings opens from header button', settingsOpen === true);

    const modeBefore = await evalJs(`document.querySelector('[data-setmode=\"sequence\"]').classList.contains('active')`);
    await evalJs(`document.querySelector('[data-setmode=\"sequence\"]').click()`);
    await new Promise((r) => setTimeout(r, 200));
    const modeAfter = await evalJs(
      `document.querySelector('[data-setmode=\"sequence\"]').classList.contains('active') + '|' + SETTINGS.mode`);
    check('segmented mode control updates state', modeAfter === 'true|sequence', modeAfter);
    // restore
    await evalJs(`document.querySelector('[data-setmode=\"group\"]').click()`);
    await evalJs(`document.getElementById('settingsCloseBtn').click()`);
    await new Promise((r) => setTimeout(r, 200));

    // ---- 3. Wizard: open via CTA, pick template via card click, dots navigate ----
    await evalJs(`document.getElementById('wizardCta').click()`);
    await new Promise((r) => setTimeout(r, 300));
    const wizOpen = await evalJs(`document.getElementById('wizardOverlay').classList.contains('open')`);
    check('wizard opens from CTA', wizOpen === true);

    await evalJs(`document.querySelector('.wizard-tmpl-card[data-template=\"cooking\"]').click()`);
    await new Promise((r) => setTimeout(r, 200));
    const tpl = await evalJs(`wizState.template + '|' + wizState.export.mode + '|' + wizState.export.essence`);
    check('template card click applies Cooking Show defaults', tpl === 'cooking|mixed|mxf', tpl);

    await evalJs(`document.querySelector('.wizard-step-dot[data-step=\"2\"]').click()`);
    await new Promise((r) => setTimeout(r, 200));
    const dotNav = await evalJs(`wizState.step`);
    check('wizard step-dot click navigates', dotNav === 2, String(dotNav));
    await evalJs(`document.getElementById('wizardCloseBtn').click()`);
    await new Promise((r) => setTimeout(r, 200));

    // ---- 4. Recents: seed an entry with a fake path, click it, expect toast + no crash ----
    await evalJs(
      `_recentFiles.length = 0;` +
      `addRecentFileItem('smoke_test.wav', '1.2 MB', '10:00', 'C:/definitely/not/real.wav');`);
    await new Promise((r) => setTimeout(r, 200));
    const item = await evalJs(
      `(function(){ var it = document.querySelector('.recent-item'); ` +
      `return it ? (it.getAttribute('data-path') || '') : 'NO ITEM'; })()`);
    check('recent entry renders with stored path', item === 'C:/definitely/not/real.wav', item);

    const toastBefore = await evalJs(`document.getElementById('toast').textContent`);
    await evalJs(`document.querySelector('.recent-item').click()`);
    await new Promise((r) => setTimeout(r, 400));
    const toastAfter = await evalJs(`document.getElementById('toast').textContent`);
    check('recents click fires reload feedback (toast)', toastAfter && toastAfter !== toastBefore, JSON.stringify(toastAfter));

    // ---- 5. ARIA: tablist roles present, aria-selected syncs on switch ----
    const aria = await evalJs(
      `document.querySelector('.tab-bar').getAttribute('role') + '|' +
       document.querySelectorAll('.tab-bar .tab[role=\"tab\"]').length + '|' +
       document.querySelectorAll('.tab-content[role=\"tabpanel\"]').length`);
    check('ARIA roles on tab bar + panels', aria === 'tablist|5|5', aria);

    await evalJs(`switchTab('export')`);
    await new Promise((r) => setTimeout(r, 300));
    const sel = await evalJs(
      `document.querySelector('.tab-bar .tab[data-tab=\"export\"]').getAttribute('aria-selected') + '|' +
       document.getElementById('tab-export').getAttribute('aria-hidden')`);
    check('switchTab syncs aria-selected/aria-hidden', sel === 'true|false', sel);

    // ---- 6. Focus trap: Tab at end of settings overlay cycles to first control ----
    await evalJs(`document.getElementById('settingsToggle').click()`);
    await new Promise((r) => setTimeout(r, 300));
    await evalJs(
      `(function(){ var f = document.querySelectorAll('#settingsOverlay button, #settingsOverlay input, #settingsOverlay select'); ` +
      `f[f.length-1].focus(); })()`);
    await evalJs(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab', bubbles:true}))`);
    await new Promise((r) => setTimeout(r, 200));
    const trapped = await evalJs(`document.getElementById('settingsOverlay').contains(document.activeElement)`);
    check('focus trap cycles Tab inside settings overlay', trapped === true);

    // ---- 7. Export-format radios still drive the option cards ----
    await evalJs(`document.getElementById('settingsCloseBtn').click(); switchTab('export');`);
    await new Promise((r) => setTimeout(r, 400));
    await evalJs(`document.querySelector('input[name=\"export-format\"][value=\"mxf\"]').click()`);
    await new Promise((r) => setTimeout(r, 200));
    const essence = await evalJs(`document.getElementById('exportEssence').textContent`);
    check('export format radio click updates summary', /MXF/i.test(essence), essence);

    console.log('\\n' + results.filter((r) => r.ok).length + '/' + results.length + ' live checks passed');
    const failed = results.filter((r) => !r.ok);
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    if (ws) try { ws.close(); } catch (e) {}
    if (electron && electron.pid) {
      // shell:true means pid is the cmd.exe wrapper; kill the whole tree
      // or electron survives as an orphan on Windows.
      try { require('child_process').execSync(`taskkill /pid ${electron.pid} /T /F`, { stdio: 'ignore' }); } catch (e) {}
    }
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  }
}

main().catch((e) => { console.error('SMOKE ERROR:', e.message); process.exit(1); });
