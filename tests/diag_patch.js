/** Patch-tab recheck with CORRECT selectors (.grp-track, #patchSvgEl path). */
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
  const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception.description.slice(0,200)); return r.result.value; };

  await ev(`document.querySelector('.tab-bar .tab[data-tab=\"patch\"]').click()`);
  await sleep(1000);
  console.log(await ev(`({
    model: ROUTING_DATA.map(function(d){return d.ch+'/g:'+(d.group||'-')+'/'+(d.track||'-');}),
    srcChips: document.querySelectorAll('#patchSrcList .patch-src').length,
    unroutedChips: document.querySelectorAll('#patchSrcList .patch-src.unrouted').length,
    groups: document.querySelectorAll('#patchGroups .patch-group').length,
    tracks: document.querySelectorAll('#patchGroups .grp-track').length,
    svgPaths: document.querySelectorAll('#patchSvgEl path').length,
    unroutedPanelVisible: document.getElementById('patchUnrouted') ? getComputedStyle(document.getElementById('patchUnrouted')).display : 'n/a',
    sampleSrc: (function(){var s=document.querySelector('.patch-src');return s?s.textContent.replace(/\\s+/g,' ').trim().slice(0,60):'none';})(),
  })`));
  // SVG geometry sanity
  console.log(await ev(`(function(){
    var svg=document.getElementById('patchSvgEl');
    if(!svg)return 'no svg';
    var r=svg.getBoundingClientRect();
    return {svgRect:[Math.round(r.width),Math.round(r.height)], display:getComputedStyle(svg).display, firstPathD: svg.querySelector('path') ? svg.querySelector('path').getAttribute('d').slice(0,80) : 'none'};
  })()`));
  ws.close(); process.exit(0);
}
main().catch((e)=>{console.error(e.message);process.exit(1);});
