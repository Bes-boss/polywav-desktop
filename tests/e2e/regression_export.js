// Patch visual + real export regression after leftover fixes
const { boot } = require('./boot_e2e');
const { seedAndLoad, TMPROOT } = require('./_lib');
const fs = require('fs');

(async () => {
  const s = await boot({ port: 9238, name: 'regression' });
  try {
    s.startConsoleCapture();
    await seedAndLoad(s);

    // Route ch1->A1, ch2->A2 only (rest unassigned) to see mixed cable states
    await s.trustClick('.tab[data-tab="route"]');
    await s.sleep(700);
    for (const id of ['01', '02']) {
      await s.evalJs(`(function(){var sel=document.querySelector('#routeTableBody select.track-select[data-ch="${id}"]');if(!sel)return 'missing';sel.focus();return 'ok'})()`);
      await s.sleep(80);
      await s.key('ArrowDown');
      await s.sleep(280);
      await s.evalJs('document.activeElement&&document.activeElement.blur&&document.activeElement.blur()');
      await s.sleep(160);
    }
    await s.trustClick('.tab[data-tab="patch"]');
    await s.sleep(1600);
    await s.shot('reg_patch_mixed');

    // Real export: embedded AAF to temp dir
    await s.trustClick('.tab[data-tab="export"]');
    await s.sleep(600);
    const outAaf = TMPROOT + '/reg_out';
    fs.mkdirSync(outAaf, { recursive: true });
    await s.trustClick('#outputAafDir');
    await s.sleep(150);
    await s.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await s.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 });
    await s.sleep(100);
    await s.cdp('Input.insertText', { text: outAaf });
    await s.key('Tab');
    await s.sleep(350);
    await s.trustClick('#exportBtn');
    await s.sleep(2500);
    let badge = '';
    for (let i = 0; i < 60; i++) {
      const st = await s.evalJs(`({ex:(typeof _exporting!=='undefined')?_exporting:null,b:(document.getElementById('exportStatusBadge')||{textContent:''}).textContent})`);
      if (st.ex === false && /complete|failed|cancel/i.test(st.b)) { badge = st.b; break; }
      await s.sleep(800);
    }
    const files = fs.existsSync(outAaf) ? fs.readdirSync(outAaf).map(f => { const st = fs.statSync(outAaf + '/' + f); return f + ':' + st.size; }) : [];
    console.log('EXPORT:', badge, JSON.stringify(files));
    console.log('CONSOLE:', JSON.stringify(s.consoleLog().slice(0, 6)));
  } finally { s.cleanup(); }
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });