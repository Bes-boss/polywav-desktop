// AUDIT C: empty-export click, route select structure+assign, settings panel,
// presets row, LIGHT theme sweep, ~800px responsive pass.
const fs = require('fs');
const { boot } = require('./agent_boot');

const SHOTS = 'C:/Users/Liam/workspace/polywav/audit_out/2026-08-22_ui-ux/shots';
const fixture = 'C:/Users/Liam/workspace/polywav/fixtures/mock/MKR_Ep104.wav';

(async () => {
  const s = await boot({ port: 9228, name: 'aesthC', shotsDir: SHOTS });
  const log = (m) => { console.log(m); };
  async function step(name, fn) {
    try { await fn(); } catch (e) { log(`STEP FAIL ${name}: ${e.message}`); }
  }
  const scrollTab = (frac) => s.evalJs(`(function(){var t=document.querySelector('.tab-content.active');t.scrollTop=(t.scrollHeight-t.clientHeight)*${frac};'ok';})()`);
  try {
    s.startConsoleCapture();
    await s.evalJs(`location.reload(); 'r'`);
    await s.sleep(1800);
    await s.cdp('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    const st0 = fs.statSync(fixture);
    await s.seedRecents([{ name: 'MKR_Ep104.wav', size: st0.size, time: Date.now(), path: fixture }]);

    // ---- 1. EXPORT tab with NO file loaded: click the enabled Export button ----
    await step('export-empty-click', async () => {
      await s.trustClick('.tab[data-tab="export"]');
      await s.sleep(400);
      await s.trustClick('#exportBtn');
      await s.sleep(400);
      await s.shot('40_export_clicked_no_file');
      const toast = await s.evalJs(`document.getElementById('toast').textContent`);
      const logTxt = await s.evalJs(`document.getElementById('exportLog').textContent.replace(/\\s+/g,' ').slice(0,200)`);
      log('EXPORT-NO-FILE TOAST: ' + JSON.stringify(toast) + ' | LOG: ' + JSON.stringify(logTxt));
    });

    // ---- 2. Load file, then route assign (by index, structure-agnostic) ----
    await step('load', async () => {
      await s.trustClick('.tab[data-tab="home"]');
      await s.sleep(300);
      await s.trustClick('.recent-item');
      await s.sleep(2800);
    });
    await step('route-structure', async () => {
      await s.trustClick('.tab[data-tab="route"]');
      await s.sleep(500);
      const html = await s.evalJs(`document.querySelector('#routeTableBody tr').outerHTML.replace(/\\s+/g,' ').slice(0,600)`);
      log('ROUTE ROW HTML: ' + html);
      const sels = await s.evalJs(`(function(){var a=document.querySelectorAll('#routeTableBody select');return Array.from(a).slice(0,3).map(function(x){return {ch:x.getAttribute('data-ch'),val:x.value,opts:x.options.length};});})()`);
      log('ROUTE SELECTS: ' + JSON.stringify(sels));
    });
    await step('route-assign2', async () => {
      // focus 2nd and 3rd selects, ArrowDown twice each
      const idx = [1, 2];
      for (const i of idx) {
        await s.evalJs(`(function(){var a=document.querySelectorAll('#routeTableBody select');a[${i}].focus();'ok';})()`);
        await s.sleep(120);
        await s.key('ArrowDown'); await s.key('ArrowDown');
        await s.sleep(120);
        const v = await s.evalJs(`(document.querySelectorAll('#routeTableBody select')[${i}].value)`);
        log('SELECT[' + i + '] VALUE: ' + JSON.stringify(v));
      }
      await s.sleep(300);
      await s.shot('41_route_assigned');
      await s.trustClick('#routeUndoBtn');
      await s.sleep(250);
      await s.shot('42_route_after_undo');
    });

    // ---- 3. Settings panel ----
    await step('settings-open', async () => {
      await s.trustClick('#settingsToggle');
      await s.sleep(500);
      await s.shot('43_settings_appearance');
      const opts = await s.evalJs(`(function(){var o=document.getElementById('presetSelect');return {open:o.classList.contains('open'),groups:Array.from(o.querySelectorAll('optgroup')).map(function(g){return g.label+':'+g.querySelectorAll('option').length;}),n:o.options.length};})()`);
      log('PRESET SELECT: ' + JSON.stringify(opts));
    });
    await step('settings-exportmode', async () => {
      await s.evalJs(`(function(){var p=document.querySelector('.settings-panel');var h=document.querySelector('.settings-section:nth-of-type(2)');if(h)h.scrollIntoView();'ok';})()`);
      await s.sleep(250);
      await s.shot('44_settings_export_mode');
    });
    await step('settings-presets', async () => {
      await s.evalJs(`(function(){var els=document.querySelectorAll('.settings-section h3');for(var i=0;i<els.length;i++){if(/Presets/.test(els[i].textContent)){els[i].scrollIntoView();break;}}'ok';})()`);
      await s.sleep(250);
      await s.shot('45_settings_presets_row');
      // Save a preset named AuditTest
      await s.evalJs(`(function(){var i=document.getElementById('presetNameInput');i.focus();i.value='AuditTest';'ok';})()`);
      await s.trustClick('#presetSaveBtn');
      await s.sleep(600);
      await s.shot('46_preset_saved_toast');
      const toast = await s.evalJs(`document.getElementById('toast').textContent`);
      const opts = await s.evalJs(`(function(){var o=document.getElementById('presetSelect');return Array.from(o.options).map(function(x){return x.text;});})()`);
      log('PRESET SAVE TOAST: ' + JSON.stringify(toast) + ' | OPTIONS NOW: ' + JSON.stringify(opts));
      // Delete it (safe: our own test preset)
      await s.evalJs(`(function(){var o=document.getElementById('presetSelect');var target=Array.from(o.options).find(function(x){return /AuditTest/.test(x.text);});if(target){o.value=target.value;o.dispatchEvent(new Event('change',{bubbles:true}));}'ok';})()`);
      await s.sleep(200);
      await s.trustClick('#presetDeleteBtn');
      await s.sleep(500);
      await s.shot('47_preset_deleted');
      const toast2 = await s.evalJs(`document.getElementById('toast').textContent`);
      log('PRESET DELETE TOAST: ' + JSON.stringify(toast2));
    });
    await step('settings-general', async () => {
      await s.evalJs(`(function(){var els=document.querySelectorAll('.settings-section h3');for(var i=0;i<els.length;i++){if(/General/.test(els[i].textContent)){els[i].scrollIntoView();break;}}'ok';})()`);
      await s.sleep(250);
      await s.shot('48_settings_general');
    });

    // ---- 4. LIGHT THEME ----
    await step('light-settings', async () => {
      await s.evalJs(`(function(){document.querySelector('.settings-panel').scrollTop=0;'ok';})()`);
      await s.trustClick('#themeLightOpt');
      await s.sleep(500);
      await s.shot('49_settings_light');
    });
    await step('light-close', async () => {
      await s.trustClick('#settingsCloseBtn');
      await s.sleep(400);
      await s.shot('50_home_light');
    });
    await step('light-normalize', async () => {
      await s.trustClick('.tab[data-tab="normalize"]');
      await s.sleep(400);
      await s.shot('51_normalize_light');
    });
    await step('light-route', async () => {
      await s.trustClick('.tab[data-tab="route"]');
      await s.sleep(400);
      await s.shot('52_route_light');
    });
    await step('light-export', async () => {
      await s.trustClick('.tab[data-tab="export"]');
      await s.sleep(400);
      await s.shot('53_export_light_top');
      await scrollTab(1);
      await s.sleep(250);
      await s.shot('54_export_light_cli');
    });
    await step('light-patch', async () => {
      await s.trustClick('.tab[data-tab="patch"]');
      await s.sleep(700);
      await s.shot('55_patch_light');
    });

    // ---- 5. Resize to ~800px wide ----
    await step('resize-800', async () => {
      const w = await s.cdp('Browser.getWindowForTarget');
      await s.cdp('Browser.setWindowBounds', { windowId: w.windowId, bounds: { width: 800, height: 720 } });
      await s.sleep(600);
      const ov = await s.evalJs(`({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,tab:'patch'})`);
      log('PATCH @800 OVERFLOW: ' + JSON.stringify(ov));
      await s.shot('56_patch_800');
      await s.trustClick('.tab[data-tab="route"]'); await s.sleep(400);
      await s.shot('57_route_800');
      await s.trustClick('.tab[data-tab="export"]'); await s.sleep(400);
      await s.shot('58_export_800');
      await s.trustClick('.tab[data-tab="home"]'); await s.sleep(400);
      await s.shot('59_home_800');
      await s.trustClick('#settingsToggle'); await s.sleep(500);
      await s.shot('60_settings_800');
      await s.trustClick('#settingsCloseBtn'); await s.sleep(300);
      await s.trustClick('.tab[data-tab="normalize"]'); await s.sleep(400);
      await s.shot('61_normalize_800');
      for (const t of ['home', 'normalize', 'route', 'patch', 'export']) {
        const o = await s.evalJs(`(function(){document.querySelector('.tab[data-tab="${t}"]').click();return null;})()`);
        await s.sleep(250);
        const m = await s.evalJs(`({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth})`);
        log(`OVERFLOW @800 ${t}: ` + JSON.stringify(m));
      }
    });

    log('CONSOLE ISSUES: ' + JSON.stringify(s.consoleLog().slice(0, 15)));
  } finally {
    s.cleanup();
  }
  console.log('AUDIT C DONE');
})().catch((e) => { console.error('AUDIT C FAIL:', e.message); process.exit(1); });
