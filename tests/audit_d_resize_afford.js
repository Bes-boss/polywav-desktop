// AUDIT D: ~800px responsive pass (device-metrics override), duplicate-track
// assignment probe, hover/focus affordances.
const fs = require('fs');
const { boot } = require('./agent_boot');

const SHOTS = 'C:/Users/Liam/workspace/polywav/audit_out/2026-08-22_ui-ux/shots';
const fixture = 'C:/Users/Liam/workspace/polywav/fixtures/mock/MKR_Ep104.wav';

(async () => {
  const s = await boot({ port: 9229, name: 'aesthD', shotsDir: SHOTS });
  const log = (m) => { console.log(m); };
  async function step(name, fn) {
    try { await fn(); } catch (e) { log(`STEP FAIL ${name}: ${e.message}`); }
  }
  try {
    s.startConsoleCapture();
    await s.evalJs(`location.reload(); 'r'`);
    await s.sleep(1800);
    await s.cdp('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    const st0 = fs.statSync(fixture);
    await s.seedRecents([{ name: 'MKR_Ep104.wav', size: st0.size, time: Date.now(), path: fixture }]);
    await s.trustClick('.tab[data-tab="home"]');
    await s.sleep(300);
    await s.trustClick('.recent-item');
    await s.sleep(2800);
    log('LOADED: ' + JSON.stringify(await s.evalJs(`({loaded:_fileLoaded,chans:rawChannels.length})`)));

    // ---- Duplicate track assignment probe ----
    await step('dupe-assign', async () => {
      await s.trustClick('.tab[data-tab="route"]');
      await s.sleep(500);
      for (const i of [1, 2]) {
        await s.evalJs(`(function(){document.querySelectorAll('#routeTableBody select')[${i}].focus();'ok';})()`);
        await s.sleep(100);
        await s.key('ArrowDown'); // "" -> A1
        await s.sleep(100);
      }
      const vals = await s.evalJs(`Array.from(document.querySelectorAll('#routeTableBody select')).slice(0,4).map(x=>x.value)`);
      log('FIRST 4 SELECT VALUES: ' + JSON.stringify(vals));
      const sum = await s.evalJs(`document.getElementById('routeSummaryList').textContent.replace(/\\s+/g,' ').slice(0,260)`);
      log('TRACK LAYOUT SUMMARY: ' + JSON.stringify(sum));
      const bar = await s.evalJs(`document.getElementById('routeBarInfo').textContent.replace(/\\s+/g,' ')`);
      log('ROUTE BAR: ' + JSON.stringify(bar));
      await s.shot('62_route_two_channels_same_track_A1');
    });

    // ---- 800px wide via device metrics ----
    await step('resize-800', async () => {
      await s.cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 720, deviceScaleFactor: 1, mobile: false });
      await s.sleep(600);
      for (const t of ['route', 'patch', 'export', 'normalize', 'home']) {
        await s.trustClick('.tab[data-tab="' + t + '"]');
        await s.sleep(450);
        const m = await s.evalJs(`({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth})`);
        log(`OVERFLOW @800 ${t}: ` + JSON.stringify(m) + (m.sw > m.cw ? '  <-- HORIZONTAL OVERFLOW' : ''));
        await s.shot('6_' + t + '_800w');
      }
      // export bottom (CLI) at 800
      await s.trustClick('.tab[data-tab="export"]');
      await s.sleep(350);
      await s.evalJs(`(function(){var t=document.querySelector('.tab-content.active');t.scrollTop=t.scrollHeight;'ok';})()`);
      await s.sleep(250);
      await s.shot('63_export_800w_bottom');
      // settings at 800
      await s.trustClick('#settingsToggle');
      await s.sleep(500);
      await s.shot('64_settings_800w');
      await s.trustClick('#settingsCloseBtn');
      await s.sleep(300);
      await s.cdp('Emulation.clearDeviceMetricsOverride');
      await s.sleep(400);
    });

    // ---- Hover / focus affordances (normal size, dark) ----
    await step('hover-states', async () => {
      await s.trustClick('.tab[data-tab="export"]');
      await s.sleep(350);
      let p = await s.rect('#exportBtn');
      if (p) { await s.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1] }); await s.sleep(350); }
      await s.shot('70_exportbtn_hover');
      p = await s.rect('.tab[data-tab="route"]');
      if (p) { await s.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1] }); await s.sleep(350); }
      await s.shot('71_tab_hover');
    });
    await step('focus-ring', async () => {
      // real Tab-key traversal: click home tab first to reset context
      await s.trustClick('.tab[data-tab="home"]');
      await s.sleep(300);
      for (let i = 0; i < 8; i++) { await s.key('Tab'); await s.sleep(60); }
      await s.shot('72_tabkey_focus_traversal');
      const active = await s.evalJs(`(function(){var a=document.activeElement;return a?(a.id||a.className||a.tagName):'none';})()`);
      log('FOCUSED AFTER 8x TAB: ' + JSON.stringify(active));
    });

    log('CONSOLE ISSUES: ' + JSON.stringify(s.consoleLog().slice(0, 15)));
  } finally {
    s.cleanup();
  }
  console.log('AUDIT D DONE');
})().catch((e) => { console.error('AUDIT D FAIL:', e.message); process.exit(1); });
