// Live verify: collapsible track groups (Route summary + Patch map)
const { boot } = require('./boot_e2e');
const { seedAndLoad } = require('./_lib');

(async () => {
  const s = await boot({ port: 9239, name: 'grpexpand' });
  const R = [];
  const rec = (id, pass, ev) => { R.push({ id, pass, ev }); console.log((pass ? 'PASS' : 'FAIL') + ' ' + id + ': ' + JSON.stringify(ev).slice(0, 200)); };
  try {
    s.startConsoleCapture();
    await seedAndLoad(s);

    // Route tab: fresh load -> only groups with assignments open. None assigned yet:
    // ALL 8 headers collapsed, zero track rows visible.
    await s.trustClick('.tab[data-tab="route"]');
    await s.sleep(800);
    let m = await s.evalJs(`(function(){var hdrs=[].slice.call(document.querySelectorAll('#routeSummaryList .grp-toggle'));var rows=document.querySelectorAll('#routeSummaryList .summary-track-row');return {headers:hdrs.length,collapsed:hdrs.filter(function(h){return h.classList.contains('collapsed')}).length,rows:rows.length}})()`);
    rec('route-fresh-all-collapsed', m.headers === 8 && m.collapsed === 8 && m.rows === 0, m);
    await s.shot('grp_route_fresh_collapsed');

    // Assign ch1->A1 via keyboard select -> group 0 should auto-open
    await s.evalJs(`(function(){var sel=document.querySelector('#routeTableBody select.track-select[data-ch="01"]');if(!sel)return 'missing';sel.focus();return 'ok'})()`);
    await s.sleep(80);
    await s.key('ArrowDown');
    await s.sleep(300);
    await s.evalJs('document.activeElement&&document.activeElement.blur&&document.activeElement.blur()');
    await s.sleep(250);
    m = await s.evalJs(`(function(){var hdrs=[].slice.call(document.querySelectorAll('#routeSummaryList .grp-toggle'));var rows=[].slice.call(document.querySelectorAll('#routeSummaryList .summary-track-row'));var g0=hdrs[0];return {g0open:g0&&!g0.classList.contains('collapsed'),rowCount:rows.length,a1row:rows.length?rows[0].textContent.replace(/\\s+/g,' ').trim():null}})()`);
    rec('route-assign-autoopens-g0', m.g0open && m.rowCount === 8 && /A1/.test(m.a1row || ''), m);

    // Toggle group 1 (A9-A16) open by clicking its header
    await s.evalJs(`(function(){var h=[].slice.call(document.querySelectorAll('#routeSummaryList .grp-toggle'))[1];h.click();return 'ok'})()`);
    await s.sleep(300);
    m = await s.evalJs(`(function(){var hdrs=[].slice.call(document.querySelectorAll('#routeSummaryList .grp-toggle'));return {g0:hdrs[0].classList.contains('collapsed'),g1:hdrs[1].classList.contains('collapsed'),others:[2,3,4,5,6,7].map(function(i){return hdrs[i].classList.contains('collapsed')})}})()`);
    rec('route-manual-toggle', m.g0 === false && m.g1 === false && m.others.every(Boolean), m);
    await s.shot('grp_route_partial_open');

    // Patch tab: collapsed patch groups render compact; assigned group G0 open
    await s.trustClick('.tab[data-tab="patch"]');
    await s.sleep(1500);
    m = await s.evalJs(`(function(){var gs=[].slice.call(document.querySelectorAll('.patch-group'));return {total:gs.length,collapsed:gs.filter(function(g){return g.classList.contains('grp-collapsed')}).length,g0collapsed:gs[0]?gs[0].classList.contains('grp-collapsed'):null,g0tracks:gs[0]?gs[0].querySelectorAll('.grp-track').length:-1}})()`);
    rec('patch-groups-render', m.total === 8 && m.g0collapsed === false && m.g0tracks === 8, m);
    const visH = await s.evalJs(`(function(){var lane=document.getElementById('patchGroups');var r=lane.getBoundingClientRect();return Math.round(r.height)})()`);
    rec('patch-lane-height-reasonable', visH < 1400, { heightPx: visH });
    await s.shot('grp_patch_map');

    // Console clean
    rec('console-clean', s.consoleLog().length === 0, s.consoleLog().slice(0, 4));
  } finally { s.cleanup(); }
  fs.writeFileSync('C:/Users/Liam/workspace/polywav/audit_out/2026-08-22_ui-ux/grp-expand-results.json', JSON.stringify(R, null, 1));
  console.log('DONE', R.filter(r => r.pass).length + '/' + R.length);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
const fs = require('fs');