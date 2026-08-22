// Stage 1 FIRST-RUN: fresh profile -> wizard auto-opens; completing it marks done;
// second boot on same profile dir -> wizard does NOT reappear.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { boot } = require('./boot_e2e');
const { record, saveIssues } = require('./_lib');

const ROOT = path.join(os.tmpdir(), 'polywav_audit_e2e');

(async () => {
  // Guarantee a genuinely fresh profile even if a previous attempt crashed midway.
  fs.rmSync(ROOT, { recursive: true, force: true });

  let issues = [];
  const s = await boot({ port: 9226, name: 'e2e' });
  try {
    s.startConsoleCapture();
    // Poll for the wizard: app.js evaluates ~1.5-2.5s after the CDP target
    // appears, then its 300ms auto-open timer fires.
    let w1 = null;
    for (let i = 0; i < 40; i++) {
      await s.sleep(400);
      w1 = await s.evalJs(`(function(){
        var o=document.getElementById('wizardOverlay');
        return { open: !!(o && o.classList.contains('open')),
                 display: o ? getComputedStyle(o).display : null,
                 flag: localStorage.getItem('polywav-wizard-done'),
                 vis: document.visibilityState };
      })()`);
      if (w1.open) break;
    }
    w1 = Object.assign(w1, { cards: await s.evalJs(`Array.from(document.querySelectorAll('.wizard-tmpl-card')).map(function(c){return c.getAttribute('data-template');})`) });
    const shot1 = await s.shot('s1_firstrun_wizard');
    record({ stage: '1-first-run', check: 'fresh profile boots straight into setup wizard (auto-open ~2.6s after launch; earlier misses were fixed-sleep timing in the harness, not app behavior)', pass: w1.open === true && w1.flag === null, evidence: { w1, shot: shot1 } });

    if (!w1.open) throw new Error('wizard did not open; cannot continue stage 1 completion');

    // Complete the wizard through the real UI: pick template card, Next x5 (5th = Finish)
    await s.trustClick('.wizard-tmpl-card');
    await s.sleep(200);
    let clicks = 0;
    for (let i = 0; i < 6; i++) {
      const st = await s.evalJs(`(function(){
        var o=document.getElementById('wizardOverlay');
        var n=document.getElementById('wizNextBtn');
        return { open: !!(o && o.classList.contains('open')), next: n ? n.textContent : null,
                 step: (typeof wizState!=='undefined') ? wizState.step : null };
      })()`);
      if (!st.open) break;
      await s.trustClick('#wizNextBtn');
      clicks++;
      await s.sleep(280);
    }
    await s.sleep(600);
    const w2 = await s.evalJs(`(function(){
      var o=document.getElementById('wizardOverlay');
      return { open: !!(o && o.classList.contains('open')),
               flag: localStorage.getItem('polywav-wizard-done'),
               presetName: typeof SETTINGS !== 'undefined' ? SETTINGS.presetName : null,
               mode: typeof SETTINGS !== 'undefined' ? SETTINGS.mode : null,
               essence: typeof SETTINGS !== 'undefined' ? SETTINGS.essence : null };
    })()`);
    const shot2 = await s.shot('s1_after_finish');
    record({ stage: '1-first-run', check: 'completing wizard closes it and sets polywav-wizard-done=1', pass: w2.open === false && w2.flag === '1', evidence: { clicks, w2, shot: shot2 } });
  } finally {
    issues = issues.concat(s.consoleLog());
    s.cleanup();
  }
  saveIssues('1a', issues);
  issues = [];

  // Boot #2 on the SAME profile dir -> wizard must not reappear
  const s2 = await boot({ port: 9226, name: 'e2e', keepPresets: true });
  try {
    s2.startConsoleCapture();
    await s2.sleep(4000); // full would-be auto-open window (app.js eval + 300ms timer)
    const w3 = await s2.evalJs(`(function(){
      var o=document.getElementById('wizardOverlay');
      return { open: !!(o && o.classList.contains('open')), flag: localStorage.getItem('polywav-wizard-done') };
    })()`);
    const shot3 = await s2.shot('s1_second_boot_no_wizard');
    record({ stage: '1-first-run', check: 'restart with same profile: wizard stays gone', pass: w3.open === false && w3.flag === '1', evidence: { w3, shot: shot3 } });
  } finally {
    issues = issues.concat(s2.consoleLog());
    s2.cleanup();
  }
  saveIssues('1b', issues);
  console.log('S1 DONE');
})().catch((e) => { console.error('S1 FAIL:', e.message); process.exit(1); });
