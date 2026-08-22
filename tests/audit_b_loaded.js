// AUDIT B: file-loaded journey across all tabs (dark theme).
const fs = require('fs');
const { boot } = require('./agent_boot');

const SHOTS = 'C:/Users/Liam/workspace/polywav/audit_out/2026-08-22_ui-ux/shots';
const fixture = 'C:/Users/Liam/workspace/polywav/fixtures/mock/MKR_Ep104.wav';

(async () => {
  const s = await boot({ port: 9227, name: 'aesthB', shotsDir: SHOTS });
  const log = (m) => { console.log(m); };
  async function step(name, fn) {
    try { await fn(); } catch (e) { log(`STEP FAIL ${name}: ${e.message}`); }
  }
  try {
    s.startConsoleCapture();
    // Reload once with capture already armed to catch boot-time errors
    await s.evalJs(`location.reload(); 'r'`);
    await s.sleep(2000);
    await s.cdp('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});

    const st0 = fs.statSync(fixture);
    await s.seedRecents([{ name: 'MKR_Ep104.wav', size: st0.size, time: Date.now(), path: fixture }]);
    log('BOOT ERRORS: ' + JSON.stringify(s.consoleLog().slice(0, 8)));

    // --- Home: seeded recents ---
    await step('recents', async () => { await s.shot('20_home_recents_seeded'); });

    // --- Load file ---
    let loadState = null;
    await step('load-file', async () => {
      await s.trustClick('.recent-item');
      await s.sleep(250);
      await s.shot('21_home_loading_feedback');
      await s.sleep(2600);
      loadState = await s.evalJs(`(function(){return {loaded:(typeof _fileLoaded!=='undefined')?_fileLoaded:'undef',chans:(typeof rawChannels!=='undefined'&&rawChannels)?rawChannels.length:0};})()`);
      log('LOADED STATE: ' + JSON.stringify(loadState));
      await s.shot('22_home_loaded_dark');
    });

    // --- Normalize loaded ---
    await step('normalize-loaded', async () => {
      await s.trustClick('.tab[data-tab="normalize"]');
      await s.sleep(500);
      await s.shot('23_normalize_loaded_top');
      await s.evalJs(`(function(){var t=document.querySelector('.tab-content.active');t.scrollTop=t.scrollHeight;'ok';})()`);
      await s.sleep(250);
      await s.shot('24_normalize_loaded_bottom');
    });
    await step('rename-cell', async () => {
      const info = await s.evalJs(`(function(){var tds=document.querySelectorAll('#parse-tbody td[contenteditable="true"]');return {count:tds.length,firstRow:tds[0]?tds[0].textContent:''};})()`);
      log('EDITABLE CELLS: ' + JSON.stringify(info));
      if (!info.count) return;
      await s.trustClick('#parse-tbody tr:first-child td[contenteditable="true"]');
      await s.sleep(150);
      // select all inside the cell, then type replacement
      await s.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await s.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await s.cdp('Input.insertText', { text: 'HST_Host_Renamed' });
      await s.key('Tab');
      await s.sleep(400);
      const after = await s.evalJs(`(function(){var r=document.querySelector('#parse-tbody tr:first-child');return {rowText:r.textContent.replace(/\\s+/g,' ').slice(0,140)};})()`);
      log('ROW AFTER RENAME: ' + JSON.stringify(after));
      await s.shot('25_normalize_cell_renamed');
    });
    await step('test-rename-garbage', async () => {
      await s.evalJs(`(function(){var i=document.getElementById('test-raw');i.focus();i.value='zzz___###';i.dispatchEvent(new Event('input',{bubbles:true}));'ok';})()`);
      await s.sleep(300);
      const res = await s.evalJs(`document.getElementById('test-result').textContent`);
      log('TEST-RENAME RESULT for garbage input: ' + JSON.stringify(res));
      await s.evalJs(`(function(){var t=document.querySelector('.tab-content.active');t.scrollTop=t.scrollHeight;'ok';})()`);
      await s.sleep(200);
      await s.shot('26_test_rename_garbage');
    });

    // --- Route loaded ---
    await step('route-loaded', async () => {
      await s.trustClick('.tab[data-tab="route"]');
      await s.sleep(500);
      const rows = await s.evalJs(`document.querySelectorAll('#routeTableBody tr').length`);
      log('ROUTE ROWS: ' + rows);
      await s.shot('27_route_loaded_default');
    });
    await step('route-assign', async () => {
      // keyboard-drive native selects: ch2 -> pick a track
      for (const ch of ['2', '3']) {
        await s.evalJs(`(function(){var el=document.querySelector('select.track-select[data-ch="${ch}"]');el.focus();'ok';})()`);
        await s.sleep(120);
        await s.key('ArrowDown'); await s.key('ArrowDown'); await s.sleep(120);
        const v = await s.evalJs(`document.querySelector('select.track-select[data-ch="${ch}"]').value`);
        log('CH ' + ch + ' SELECT VALUE NOW: ' + JSON.stringify(v));
      }
      await s.sleep(300);
      await s.shot('28_route_assigned');
      const bar = await s.evalJs(`document.getElementById('routeBarInfo').textContent.replace(/\\s+/g,' ')`);
      log('ROUTE BAR: ' + JSON.stringify(bar));
      const undo = await s.evalJs(`({u:document.getElementById('routeUndoBtn').disabled,r:document.getElementById('routeRedoBtn').disabled})`);
      log('UNDO/REDO DISABLED: ' + JSON.stringify(undo));
    });
    await step('route-undo', async () => {
      await s.trustClick('#routeUndoBtn');
      await s.sleep(300);
      await s.shot('29_route_after_undo');
    });

    // --- Patch loaded ---
    await step('patch-map', async () => {
      await s.trustClick('.tab[data-tab="patch"]');
      await s.sleep(900); // allow rAF cable pass
      const cables = await s.evalJs(`(function(){var svg=document.getElementById('patchSvgEl');return {paths:svg.querySelectorAll('path').length,lines:svg.querySelectorAll('line').length,other:svg.querySelectorAll('*').length,sources:document.querySelectorAll('#patchSrcList > *').length,groups:document.querySelectorAll('#patchGroups > *').length,unrouted:document.querySelectorAll('#patchUnroutedChips > *').length};})()`);
      log('PATCH MODEL: ' + JSON.stringify(cables));
      await s.shot('30_patch_map_dark');
    });
    await step('patch-click-src', async () => {
      const sel = '#patchSrcList > *:first-child';
      const tag = await s.evalJs(`document.querySelector('${sel}') ? document.querySelector('${sel}').className : 'none'`);
      log('FIRST SRC NODE CLASS: ' + JSON.stringify(tag));
      await s.trustClick(sel);
      await s.sleep(350);
      await s.shot('31_patch_src_clicked');
    });

    // --- Export loaded ---
    await step('export-scroll', async () => {
      await s.trustClick('.tab[data-tab="export"]');
      await s.sleep(500);
      await s.shot('32_export_top');
      await s.evalJs(`(function(){var t=document.querySelector('.tab-content.active');t.scrollTop=t.scrollHeight/2;'ok';})()`);
      await s.sleep(250);
      await s.shot('33_export_mid');
      await s.evalJs(`(function(){var t=document.querySelector('.tab-content.active');t.scrollTop=t.scrollHeight;'ok';})()`);
      await s.sleep(250);
      await s.shot('34_export_bottom');
      const cli = await s.evalJs(`document.getElementById('exportCLI').textContent`);
      log('CLI TEXT: ' + JSON.stringify(cli.slice(0, 400)));
      const prev = await s.evalJs(`document.getElementById('outputAafPreview').textContent`);
      log('AAF PATH PREVIEW: ' + JSON.stringify(prev));
    });
    await step('export-mxf-option', async () => {
      await s.trustClick('label.export-option:nth-of-type(3), label.export-option[value="mxf"], #tab-export label.export-option:last-of-type');
      await s.sleep(400);
      await s.shot('35_export_mxf_selected');
      const sel = await s.evalJs(`(function(){var r=document.querySelector('input[name="export-format"]:checked');return r?r.value:'none';})()`);
      const cli = await s.evalJs(`document.getElementById('exportCLI').textContent.slice(0,160)`);
      log('MXF RADIO: ' + sel + ' | CLI NOW: ' + JSON.stringify(cli));
    });
    await step('copy-cli', async () => {
      await s.trustClick('#copyCliBtn');
      await s.sleep(250);
      await s.shot('36_copy_cli_feedback');
    });

    log('CONSOLE ISSUES: ' + JSON.stringify(s.consoleLog().slice(0, 15)));
  } finally {
    s.cleanup();
  }
  console.log('AUDIT B DONE');
})().catch((e) => { console.error('AUDIT B FAIL:', e.message); process.exit(1); });
