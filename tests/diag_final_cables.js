/** FINAL cable test: focus emulation ON first, then full flow in ONE session. */
const http = require('http');
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d=''; res.on('data',(c)=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d));}catch(e){reject(e);}}); }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const list = await getJson(process.env.CDP_URL + '/json/list');
  const page = list.filter((t) => t.type === 'page')[0];
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

  await cdp('Page.enable');
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await sleep(400);
  console.log('visibility after focus emulation:', await ev(`document.visibilityState`));
  console.log('rAF:', await ev(`new Promise(function(res){ var d=false; requestAnimationFrame(function(){d=true;res('RAF FIRES');}); setTimeout(function(){if(!d)res('FROZEN');},1200); })`));

  // close wizard if open
  await ev(`(function(){ var b=document.getElementById('wizCloseBtn'); if(b&&document.getElementById('wizardOverlay').classList.contains('open')) b.click(); return 'ok'; })()`);
  await sleep(300);

  // Seed 8ch state
  await ev(`(function(){
    var NAMES=['EP1_001_Presenter','EP1_002_Guest_A','EP1_003_Guest_B','EP1_004_Crowd_L','EP1_005_Crowd_R','EP1_006_MixL','EP1_007_MixR','EP1_008_Spare'];
    _fileLoaded=true;
    _filePath='C:/Users/Liam/AppData/Local/Temp/polywav_audit/field_recording.wav';
    _clipName='field_recording';
    ROUTING_DATA.length=0; rawChannels.length=0;
    for(var i=0;i<NAMES.length;i++){
      var chNum=String(i+1).padStart(2,'0');
      ROUTING_DATA.push({ch:chNum,name:NAMES[i],group:null,track:null,color:'#ccc'});
      rawChannels.push({num:chNum,raw:NAMES[i],bext:NAMES[i].split('_').slice(1).join(' ')});
    }
    rerenderAll();
    document.querySelector('.tab-bar .tab[data-tab=\"route\"]').click();
    return 'seeded';
  })()`);
  await sleep(500);
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
  await sleep(1300);
  console.log('RESULT:', JSON.stringify(await ev(`({
    vis: document.visibilityState,
    total: document.querySelectorAll('#patchSvgEl path').length,
    routed: document.querySelectorAll('#patchSvgEl path.patch-flow:not(.unrouted)').length,
    unrouted: document.querySelectorAll('#patchSvgEl path.unrouted').length,
    sampleD: (function(){var p=document.querySelector('#patchSvgEl path.patch-flow:not(.unrouted)');return p?p.getAttribute('d').slice(0,70):'none';})(),
  })`)));
  ws.close(); process.exit(0);
}
main().catch((e)=>{console.error(e.message);process.exit(1);});
