// Dry-run of agent_boot.js: boot, seed recents with real fixture, click, verify.
const path = require('path');
const fs = require('fs');
const { boot } = require('./agent_boot');

(async () => {
  const s = await boot({ port: 9225, name: 'dryrun' });
  try {
    s.startConsoleCapture();
    const fixture = 'C:/Users/Liam/workspace/polywav/fixtures/mock/MKR_Ep104.wav';
    const st = fs.statSync(fixture);
    await s.seedRecents([{ name: 'MKR_Ep104.wav', size: st.size, time: Date.now(), path: fixture }]);
    // Click the recent item -> real load through handleFilePath
    await s.trustClick('.recent-item');
    await s.sleep(2500);
    const state = await s.evalJs(`(function(){return {
      loaded: typeof _fileLoaded !== 'undefined' ? _fileLoaded : 'undef',
      path: typeof _filePath !== 'undefined' ? _filePath : 'undef',
      chans: (typeof rawChannels !== 'undefined' && rawChannels) ? rawChannels.length : 0,
      clip: typeof _clipName !== 'undefined' ? _clipName : 'undef'
    }})()`);
    console.log('STATE:', JSON.stringify(state));
    const f1 = await s.shot('home_loaded');
    console.log('SHOT:', f1);
    const logs = s.consoleLog();
    console.log('CONSOLE ISSUES:', JSON.stringify(logs.slice(0, 10)));
  } finally {
    s.cleanup();
  }
  console.log('DRYRUN OK');
})().catch((e) => { console.error('DRYRUN FAIL:', e.message); process.exit(1); });
