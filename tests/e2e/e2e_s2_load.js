// Stage 2 LOAD: recents click-to-load state; 'Load new' reset; Clear recents.
const fs = require('fs');
const { boot } = require('./boot_e2e');
const { record, saveIssues, FIXTURE } = require('./_lib');

(async () => {
  let issues = [];
  const s = await boot({ port: 9226, name: 'e2e', keepPresets: true });
  try {
    s.startConsoleCapture();
    const st0 = fs.statSync(FIXTURE);
    await s.seedRecents([{ name: 'MKR_Ep104.wav', size: st0.size, time: Date.now(), path: FIXTURE }]);
    const seeded = await s.evalJs(`(function(){
      return { items: document.querySelectorAll('.recent-item').length,
               firstText: (document.querySelector('.recent-item')||{}).textContent };
    })()`);

    await s.trustClick('.recent-item');
    await s.sleep(3000);
    const st1 = await s.evalJs(`(function(){
      return { loaded: _fileLoaded,
               path: _filePath,
               chans: rawChannels ? rawChannels.length : 0,
               clip: _clipName,
               heroSub: (document.getElementById('heroSubtitle')||{}).textContent,
               heroMeta: (document.getElementById('heroMeta')||{}).textContent,
               dotColor: (document.getElementById('heroStatusDot')||{style:{}}).style.color,
               flCardDisplay: document.getElementById('fileLoadedCard').style.display,
               flName: (document.getElementById('flFileName')||{}).textContent,
               recentCount: document.querySelectorAll('.recent-item').length };
    })()`);
    const shot1 = await s.shot('s2_loaded');
    record({
      stage: '2-load', check: 'click recents entry -> real load (state + header chip + loaded card)',
      pass: st1.loaded === true && st1.path === FIXTURE && st1.chans === 7 && st1.clip === 'MKR_Ep104'
        && String(st1.heroSub || '').indexOf('MKR_Ep104') >= 0
        && String(st1.heroMeta || '').indexOf('7 channels') >= 0
        && String(st1.heroMeta || '').indexOf('48 kHz') >= 0
        && String(st1.heroMeta || '').indexOf('24-bit') >= 0
        && st1.flName === 'MKR_Ep104' && st1.flCardDisplay !== 'none',
      evidence: { seeded, state: st1, shot: shot1 },
    });

    // --- Load new ---
    await s.trustClick('#flNewBtn');
    await s.sleep(900);
    const st2 = await s.evalJs(`(function(){
      var dz=document.getElementById('dropZone');
      return { loaded: _fileLoaded, chans: rawChannels.length,
               flCardDisplay: document.getElementById('fileLoadedCard').style.display,
               dropZoneVisible: !!(dz && dz.offsetParent !== null),
               heroSub: (document.getElementById('heroSubtitle')||{}).textContent };
    })()`);
    const shot2 = await s.shot('s2_load_new');
    record({
      stage: '2-load', check: "'Load new' clears loaded state and reveals drop zone",
      pass: st2.loaded === false && st2.chans === 0 && st2.flCardDisplay === 'none' && st2.dropZoneVisible === true,
      evidence: { state: st2, shot: shot2 },
    });

    // Reload via recents again (also proves recents still functional after Load new)
    await s.trustClick('.recent-item');
    await s.sleep(3000);
    const reloadOk = await s.evalJs(`(_fileLoaded===true && rawChannels.length===7 && _filePath==='C:/Users/Liam/workspace/polywav/fixtures/mock/MKR_Ep104.wav')`);

    // --- Clear recents ---
    await s.trustClick('#recentClearBtn');
    await s.sleep(700);
    const st3 = await s.evalJs(`(function(){
      var ls=null; try{ ls=localStorage.getItem('polywav-recent'); }catch(e){}
      return { items: document.querySelectorAll('.recent-item').length,
               emptyShown: !!document.querySelector('#recentList .recent-empty'),
               listText: (document.getElementById('recentList')||{}).textContent,
               ls: ls, fileStillLoaded: _fileLoaded };
    })()`);
    const shot3 = await s.shot('s2_clear_recents');
    record({
      stage: '2-load', check: "Clear recents empties list + localStorage (outcome, not toast)",
      pass: st3.items === 0 && st3.emptyShown === true && (!st3.ls || st3.ls === '[]' || st3.ls === 'null'),
      evidence: { state: st3, reloadAfterLoadNew: reloadOk, shot: shot3 },
    });
  } finally {
    issues = issues.concat(s.consoleLog());
    s.cleanup();
  }
  saveIssues('2', issues);
  console.log('S2 DONE');
})().catch((e) => { console.error('S2 FAIL:', e.message); process.exit(1); });
