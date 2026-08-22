/** Visible-window cable test on a fresh instance: seed state, go to patch tab,
 * count cables while the window is genuinely visible. */
const http = require('http');
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d=''; res.on('data',(c)=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d));}catch(e){reject(e);}}); }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const ATTACH = process.env.CDP_URL;
  let page = null;
  for (let i = 0; i < 40 && !page; i++) {
    await sleep(250);
    try {
      const list = await getJson(ATTACH + '/json/list');
      page = list.filter((t) => t.type === 'page')[0];
    } catch (e) {}
  }
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let mid = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const cdp = (method, params = {}) => { const id = ++mid; return new Promise((res, rej) => { pending.set(id, (m) => (m.error ? rej(new Error(method + ':' + JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); }); };
  const ev = async (e) => {
    const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception.description.slice(0, 200));
    return r.result.value;
  };

  await sleep(1500);
  console.log('visibility:', await ev(`document.visibilityState`));

  // Skip wizard, load state
  await ev(`(function(){
    try { document.getElementById('wizCloseBtn').click(); } catch(e) {}
    var cards=document.querySelectorAll('.wizard-tmpl-card');
    return 'wizard handled';
  })()`);
  await sleep(400);

  // Seed the same 8-channel state the journey used
  await ev(`(function(){
    var NAMES=['EP1_001_Presenter','EP1_002_Guest_A','EP1_003_Guest_B','EP1_004_Crowd_L','EP1_005_Crowd_R','EP1_006_MixL','EP1_007_MixR','EP1_008_Spare'];
    _fileLoaded=true;
    _filePath='C:/Users/Liam/AppData/Local/Temp/polywav_audit/field_recording.wav';
    _clipName='field_recording';
    ROUTING_DATA.length=0; rawChannels.length=0;
    for(var i=0;i<NAMES.length;i++){
      var chNum=String(i+1).padStart(2,'0'); var nm=NAMES[i];
      var parts=nm.split('_'); var desc=parts.slice(1).join(' ');
      ROUTING_DATA.push({ch:chNum,name:nm,group:null,track:null,color:'#ccc'});
      rawChannels.push({num:chNum,raw:nm,bext:desc});
    }
    rerenderAll();
    // patch 6 channels like the journey did
    var want={'01':'A1','02':'A2','03':'A3','04':'A4','06':'A5','07':'A6'};
    document.querySelector('.tab-bar .tab[data-tab=\"route\"]').click();
    return 'seeded';
  })()`);
  await sleep(600);
  await ev(`(function(){
    var want={'01':'A1','02':'A2','03':'A3','04':'A4','06':'A5','07':'A6'};
    Object.keys(want).forEach(function(ch){
      var s=document.querySelector('#routeTableBody select.track-select[data-ch=\"'+ch+'\"]');
      s.value=want[ch]; s.dispatchEvent(new Event('change',{bubbles:true}));
    });
    return 'patched';
  })()`);
  await sleep(700);
  await ev(`document.querySelector('.tab-bar .tab[data-tab=\"patch\"]').click()`);
  await sleep(1200);
  console.log('VISIBLE-WINDOW RESULT:', await ev(`({
    visibility: document.visibilityState,
    total: document.querySelectorAll('#patchSvgEl path').length,
    routed: document.querySelectorAll('#patchSvgEl path.patch-flow:not(.unrouted)').length,
    unrouted: document.querySelectorAll('#patchSvgEl path.unrouted').length,
    sampleD: (function(){var p=document.querySelector('#patchSvgEl path.patch-flow:not(.unrouted)');return p?p.getAttribute('d').slice(0,70):'none';})(),
  })`));
  ws.close(); process.exit(0);
}
main().catch((e)=>{console.error(e.message);process.exit(1);});
