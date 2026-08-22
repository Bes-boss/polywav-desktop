// AUDIT A: first-run wizard + every tab's EMPTY state (dark theme, fresh profile).
const fs = require('fs');
const { boot } = require('./agent_boot');

const SHOTS = 'C:/Users/Liam/workspace/polywav/audit_out/2026-08-22_ui-ux/shots';

(async () => {
  const s = await boot({ port: 9226, name: 'aesthA', shotsDir: SHOTS });
  const out = [];
  const log = (m) => { out.push(m); console.log(m); };
  async function step(name, fn) {
    try { await fn(); } catch (e) { log(`STEP FAIL ${name}: ${e.message}`); }
  }
  try {
    s.startConsoleCapture();
    await s.sleep(1200);

    // --- First-run wizard ---
    await step('wizard-open', async () => {
      const st = await s.evalJs(`(function(){var w=document.getElementById('wizardOverlay');
        return {open:w?w.classList.contains('open'):'no-el', wizDone:localStorage.getItem('polywav-wizard-done'), recent:localStorage.getItem('polywav-recent')};})()`);
      log('FRESH STATE: ' + JSON.stringify(st));
      await s.shot('01_wizard_first_run_step1');
    });

    await step('wizard-pick-template', async () => {
      await s.trustClick('.wizard-tmpl-card[data-template="panel"]');
      await s.sleep(400);
      await s.shot('02_wizard_template_selected');
    });
    for (let i = 2; i <= 5; i++) {
      await step('wizard-next-' + i, async () => {
        await s.trustClick('#wizNextBtn');
        await s.sleep(400);
        await s.shot(`0${i}_wizard_step${i}`);
      });
    }
    await step('wizard-finish', async () => {
      const btnTxt = await s.evalJs(`document.getElementById('wizNextBtn').textContent`);
      log('FINAL WIZ BUTTON TEXT: ' + JSON.stringify(btnTxt));
      await s.trustClick('#wizNextBtn');
      await s.sleep(800);
      const st = await s.evalJs(`(function(){return {wizOpen:document.getElementById('wizardOverlay').classList.contains('open'),
        wizDone:localStorage.getItem('polywav-wizard-done')};})()`);
      log('AFTER FINISH: ' + JSON.stringify(st));
      await s.shot('07_home_after_wizard_finish');
      // Did finishing write a preset file?
      const files = fs.readdirSync(s.presetsDir);
      log('PRESETS DIR AFTER WIZARD: ' + JSON.stringify(files));
    });

    // --- Home empty state ---
    await step('home-empty', async () => {
      await s.sleep(300);
      await s.shot('08_home_empty_dark');
    });

    await step('dropzone-hover', async () => {
      const p = await s.rect('#dropZone');
      if (p) { await s.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1] }); await s.sleep(500); }
      await s.shot('09_home_dropzone_hover');
    });
    await step('browsebtn-focus', async () => {
      await s.evalJs(`document.getElementById('dropZoneBtn').focus(); 'ok'`);
      await s.sleep(200);
      await s.shot('10_browse_btn_focus_ring');
    });

    // --- Empty states of other tabs ---
    await step('normalize-empty', async () => {
      await s.trustClick('.tab[data-tab="normalize"]'); await s.sleep(350);
      await s.shot('11_normalize_empty');
      const vis = await s.evalJs(`(function(){var e=document.getElementById('empty-normalize');var r=e.getBoundingClientRect();return {disp:getComputedStyle(e).display, txt:e.textContent.trim().slice(0,80)};})()`);
      log('NORMALIZE EMPTY: ' + JSON.stringify(vis));
    });
    await step('route-empty', async () => {
      await s.trustClick('.tab[data-tab="route"]'); await s.sleep(350);
      await s.shot('12_route_empty');
      // is the bottom bar (with + Import / Export for Avid) visible in empty state?
      const bb = await s.evalJs(`(function(){var b=document.querySelector('#tab-route .bottom-bar');if(!b)return 'no-bar';var r=b.getBoundingClientRect();return {visible:r.height>0&&getComputedStyle(b).display!=='none', h:Math.round(r.height)};})()`);
      log('ROUTE BOTTOM BAR (empty): ' + JSON.stringify(bb));
      if (bb && bb.visible !== false && bb !== 'no-bar') {
        await s.trustClick('[data-toast="Import another polywav"]');
        await s.sleep(250);
        await s.shot('13_route_empty_import_click');
        const toast = await s.evalJs(`document.getElementById('toast').textContent`);
        log('IMPORT BTN TOAST: ' + JSON.stringify(toast));
        await s.sleep(1800);
      }
    });
    await step('patch-empty', async () => {
      await s.trustClick('.tab[data-tab="patch"]'); await s.sleep(350);
      await s.shot('14_patch_empty');
    });
    await step('export-empty', async () => {
      await s.trustClick('.tab[data-tab="export"]'); await s.sleep(350);
      await s.shot('15_export_empty_top');
      await s.evalJs(`(function(){var t=document.querySelector('.tab-content.active');t.scrollTop=t.scrollHeight;'scrolled';})()`);
      await s.sleep(300);
      await s.shot('16_export_empty_bottom');
      // what does the CLI box say when nothing is loaded?
      const cli = await s.evalJs(`document.getElementById('exportCLI').textContent.slice(0,200)`);
      log('EXPORT CLI TEXT (empty): ' + JSON.stringify(cli));
      const btn = await s.evalJs(`(function(){var b=document.getElementById('exportBtn');var r=b.getBoundingClientRect();return {disabled:b.disabled,text:b.textContent.trim(),visible:r.height>0};})()`);
      log('EXPORT BUTTON (empty): ' + JSON.stringify(btn));
    });

    const logs = s.consoleLog();
    log('CONSOLE ISSUES: ' + JSON.stringify(logs.slice(0, 15)));
  } finally {
    s.cleanup();
  }
  console.log('AUDIT A DONE');
})().catch((e) => { console.error('AUDIT A FAIL:', e.message); process.exit(1); });
