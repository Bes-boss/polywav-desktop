// Verify the 5 leftover fixes + regressions on touched code paths
const { boot } = require('./boot_e2e');
const { seedAndLoad } = require('./_lib');

(async () => {
  const s = await boot({ port: 9237, name: 'verifyx' });
  const R = [];
  const rec = (id, pass, ev) => { R.push({ id, pass, ev }); console.log((pass ? 'PASS' : 'FAIL') + ' ' + id + ': ' + JSON.stringify(ev).slice(0, 220)); };
  try {
    s.startConsoleCapture();

    // X1: empty export tab -> hint instead of fake CLI
    await s.evalJs(`localStorage.setItem('polywav-wizard-done','1'); localStorage.setItem('polywav-theme','dark'); location.reload(); 'ok'`);
    await s.sleep(3500);
    await s.trustClick('.tab[data-tab="export"]');
    await s.sleep(700);
    let cli = await s.evalJs(`(document.getElementById('exportCLI')||{textContent:''}).textContent`);
    rec('x1-empty-cli-hint', !/source\.wav/.test(cli) && /Load a polywav/.test(cli), { cli: cli.slice(0, 90) });

    // X5: hero desc no longer marketing fluff
    const hero = await s.evalJs(`(document.querySelector('.hero-desc')||{textContent:''}).textContent.trim()`);
    rec('x5-hero-desc', /Load a multichannel/.test(hero), { hero });

    // Load fixture for the rest
    await seedAndLoad(s);

    // X1b: loaded export tab -> real CLI restored
    await s.trustClick('.tab[data-tab="export"]');
    await s.sleep(700);
    cli = await s.evalJs(`(document.getElementById('exportCLI')||{textContent:''}).textContent`);
    rec('x1b-loaded-real-cli', /MKR_Ep104\.wav/.test(cli) && /embed-aaf/.test(cli), { cli: cli.slice(0, 110) });

    // X2: patch cables all inside wrap bounds (partial assignment: ch1 only)
    await s.trustClick('.tab[data-tab="route"]');
    await s.sleep(700);
    const fok = await s.evalJs(`(function(){var sel=document.querySelector('#routeTableBody select.track-select[data-ch="01"]');if(!sel)return 'missing';sel.focus();return 'ok'})()`);
    if (fok === 'ok') { await s.key('ArrowDown'); await s.sleep(300); await s.evalJs('document.activeElement&&document.activeElement.blur&&document.activeElement.blur()'); }
    await s.sleep(200);
    await s.trustClick('.tab[data-tab="patch"]');
    await s.sleep(1500);
    const cables = await s.evalJs(`(function(){var wrap=document.getElementById('patchMapWrap');var svg=wrap.querySelector('svg');var wr=wrap.getBoundingClientRect();var out=[];svg.querySelectorAll('path.patch-flow').forEach(function(p){var bb=p.getBBox();out.push({yMax:Math.round(bb.y+bb.height),unrouted:p.classList.contains('unrouted')})});return {wrapH:Math.round(wr.height),paths:out}})()`);
    const unroutedInside = cables.paths.filter(p => p.unrouted).every(p => p.yMax <= cables.wrapH + 2);
    rec('x2-cables-inside', unroutedInside && cables.paths.length > 0, cables);

    // X3: route summary list capped
    await s.trustClick('.tab[data-tab="route"]');
    await s.sleep(900);
    const sum = await s.evalJs(`(function(){var el=document.getElementById('routeSummaryList');var r=el.getBoundingClientRect();var cs=getComputedStyle(el);return {h:Math.round(r.height),maxH:cs.maxHeight,scrollable:el.scrollHeight>el.clientHeight}})()`);
    rec('x3-summary-capped', sum.h <= 500 && sum.scrollable, sum);

    // X4: toast lifted at narrow width
    await s.cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 640, deviceScaleFactor: 1, mobile: false });
    await s.sleep(500);
    await s.evalJs(`showToast('Updated: Ch 01 - A1')`);
    await s.sleep(500);
    const toast = await s.evalJs(`(function(){var t=document.querySelector('.toast.show')||document.getElementById('toast');if(!t)return null;var cs=getComputedStyle(t);return {bottom:cs.bottom,z:t.style.zIndex,cls:t.className}})()`);
    const botOk = toast && (parseInt(toast.bottom) >= 80);
    // reset viewport
    await s.cdp('Emulation.clearDeviceMetricsOverride');
    rec('x4-toast-lifted', !!botOk, toast);

    // Console check
    const logs = s.consoleLog();
    rec('console-clean', logs.length === 0, logs.slice(0, 4));
  } finally { s.cleanup(); }
  fs.writeFileSync('C:/Users/Liam/workspace/polywav/audit_out/2026-08-22_ui-ux/leftover-fix-results.json', JSON.stringify(R, null, 1));
  console.log('DONE', R.filter(r => r.pass).length + '/' + R.length);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
const fs = require('fs');