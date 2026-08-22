// Shared helpers for the E2E audit scripts.
const fs = require('fs');
const OUTDIR = 'C:/Users/Liam/workspace/polywav/audit_out/2026-08-22_ui-ux';
const HERE = __dirname;

function record(entry) {
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.appendFileSync(OUTDIR + '/agent-e2e-results.jsonl', JSON.stringify(entry) + '\n');
  console.log('REC:', JSON.stringify(entry).slice(0, 700));
}

function saveIssues(key, arr) {
  const f = HERE + '/_issues_' + key + '.json';
  const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
  fs.writeFileSync(f, JSON.stringify(prev.concat(arr || []), null, 1));
}

const TMPROOT = 'C:/Users/Liam/AppData/Local/Temp/polywav_audit_e2e';

const FIXTURE = 'C:/Users/Liam/workspace/polywav/fixtures/mock/MKR_Ep104.wav';

async function seedAndLoad(s, fixturePath) {
  const st = require('fs').statSync(fixturePath || FIXTURE);
  await s.seedRecents([{ name: 'MKR_Ep104.wav', size: st.size, time: Date.now(), path: fixturePath || FIXTURE }]);
  await s.trustClick('.recent-item');
  await s.sleep(3000);
  return s.evalJs(`({loaded:_fileLoaded, path:_filePath, chans:rawChannels.length, clip:_clipName})`);
}

async function waitExportDone(s, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = await s.evalJs(`({exporting:(typeof _exporting!=='undefined')?_exporting:null,badge:(document.getElementById('exportStatusBadge')||{}).textContent,lastLog:(function(){var els=document.querySelectorAll('#exportLog div');return els.length?els[els.length-1].textContent:'';})()})`);
    if (st.exporting === false && ['complete', 'failed', 'cancelled'].includes(String(st.badge))) return st;
    await s.sleep(400);
  }
  return { timeout: true };
}

module.exports = { record, saveIssues, OUTDIR, TMPROOT, FIXTURE, seedAndLoad, waitExportDone };
