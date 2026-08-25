/** Live check of the track plan at real scale.
 *
 * live_smoke.js proves the app boots and its controls work. This proves the
 * thing the app exists for: that what the assistant arranges in the Normalise
 * and Route panels is exactly what gets exported, at 63 channels rather than
 * the 4 a fixture usually carries.
 *
 * Asserts outcomes (the plan object handed to the engine), never UI text.
 */
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const APPDIR = process.cwd();
const ELECTRON = process.env.ELECTRON_BIN ||
  path.join(APPDIR, 'node_modules', '.bin', 'electron.cmd');

const CHANNELS = 63;
const FIXTURE = path.join(os.tmpdir(), 'polywav_plan_smoke', 'LIAU8_BOOM1_08042026_163205_604.wav');

/** A 63-channel polywav carrying an iXML TRACK_LIST, written by hand. */
function writeFixture() {
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
  const names = [];
  for (let i = 1; i <= CHANNELS; i++) names.push('TRACK ' + i);
  const tracks = names.map((n, i) =>
    `<TRACK><CHANNEL_INDEX>${i + 1}</CHANNEL_INDEX><NAME>${n}</NAME></TRACK>`).join('');
  let ixml = Buffer.from(
    `<BWFXML><TRACK_LIST><TRACK_COUNT>${CHANNELS}</TRACK_COUNT>${tracks}</TRACK_LIST></BWFXML>`,
    'utf8');
  if (ixml.length % 2) ixml = Buffer.concat([ixml, Buffer.from(' ')]);

  const sr = 48000, bits = 24, frames = 4800;
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(CHANNELS, 2); fmt.writeUInt32LE(sr, 4);
  fmt.writeUInt32LE(sr * CHANNELS * 3, 8); fmt.writeUInt16LE(CHANNELS * 3, 12);
  fmt.writeUInt16LE(bits, 14);
  const data = Buffer.alloc(frames * CHANNELS * 3);

  const chunk = (id, payload) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, 'ascii'); head.writeUInt32LE(payload.length, 4);
    return Buffer.concat([head, payload]);
  };
  const body = Buffer.concat([chunk('fmt ', fmt), chunk('iXML', ixml), chunk('data', data)]);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'ascii'); head.writeUInt32LE(4 + body.length, 4);
  head.write('WAVE', 8, 'ascii');
  fs.writeFileSync(FIXTURE, Buffer.concat([head, body]));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  writeFixture();
  const electron = spawn(`"${ELECTRON}"`, ['.', '--remote-debugging-port=9224'],
    { cwd: APPDIR, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  electron.stdout.on('data', () => {});
  electron.stderr.on('data', () => {});

  let ws = null;
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? '  ok ' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
  };

  try {
    let targets = null;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      try {
        const list = await getJson('http://127.0.0.1:9224/json/list');
        targets = list.filter((t) => t.type === 'page');
        if (targets.length) break;
      } catch (e) { /* not up yet */ }
    }
    if (!targets || !targets.length) throw new Error('no page target found');

    ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let mid = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const cdp = (method, params = {}) => new Promise((res, rej) => {
      const id = ++mid;
      pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
    const ev = async (expr) => {
      const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) {
        throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails.exception &&
          r.exceptionDetails.exception.description));
      }
      return r.result.value;
    };
    await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });

    // Wait for app.js to finish wiring its globals before driving it.
    let boot = null;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      boot = await ev('typeof handleFilePath + "|" + typeof getTrackPlan');
      if (boot === 'function|function') break;
    }
    check('app booted with plan helpers', boot === 'function|function', boot);

    await ev(`handleFilePath(${JSON.stringify(FIXTURE)})`);
    let loaded = 0;
    for (let i = 0; i < 40; i++) {
      await sleep(300);
      loaded = await ev('(_fileInfo && _fileInfo.channels) || 0');
      if (loaded === CHANNELS) break;
    }
    check(`loads ${CHANNELS} channels`, loaded === CHANNELS, String(loaded));

    // ---- names and clip tokens survive at scale ----
    let plan = await ev('getTrackPlan()');
    check('plan has one entry per channel', plan.tracks.length === CHANNELS, String(plan.tracks.length));
    check('clip tokens parsed from the filename',
      plan.clipName === 'LIAU8_08042026_BOOM1_604', plan.clipName);
    check('composed filename uses the real track name',
      plan.tracks[0].fileName === 'LIAU8_08042026_BOOM1_TRACK_1_604', plan.tracks[0].fileName);
    check('track name keeps its spaces for Avid',
      plan.tracks[0].name === 'TRACK 1', plan.tracks[0].name);

    // ---- reordering chips changes every output name ----
    await ev(`(function(){
      var slots = _templateSlots.filter(function(s){ return s.key !== 'sep'; });
      var take = slots.filter(function(s){ return s.key === 'take'; })[0];
      var name = slots.filter(function(s){ return s.key === 'name'; })[0];
      var rest = slots.filter(function(s){ return s.key !== 'take' && s.key !== 'name'; });
      _templateSlots = [];
      rest.concat([take, name]).forEach(function(s, i){
        if (i) _templateSlots.push({ key: 'sep', text: '_' });
        _templateSlots.push(s);
      });
      renderTemplateChips();
      return true;
    })()`);
    plan = await ev('getTrackPlan()');
    check('chip reorder moves take before name',
      plan.tracks[0].fileName === 'LIAU8_08042026_BOOM1_604_TRACK_1', plan.tracks[0].fileName);

    // ---- editing a track name reaches the export ----
    await ev(`(function(){
      var ch = rawChannels[0]; if (!ch.caps) ch.caps = parseName(ch.raw);
      ch.caps.name = 'RENAMED HOST';
      return true;
    })()`);
    plan = await ev('getTrackPlan()');
    check('a renamed track reaches the plan',
      plan.tracks[0].fileName.indexOf('RENAMED_HOST') !== -1, plan.tracks[0].fileName);

    // ---- a clip-level edit applies to the whole take ----
    await ev(`(function(){
      var td = { textContent: 'SHOW9', getAttribute: function(k){
        return k === 'data-key' ? 'show' : '0'; } };
      commitNormCell(td);
      return true;
    })()`);
    plan = await ev('getTrackPlan()');
    const allShow = plan.tracks.every((t) => t.fileName.indexOf('SHOW9') === 0);
    check('a clip-level edit applies to every track', allShow, plan.tracks[1].fileName);

    // ---- routing: channel assignment and timeline order are independent ----
    await ev(`(function(){
      for (var i = 0; i < ROUTING_DATA.length; i++) {
        ROUTING_DATA[i].group = 'AO';
        ROUTING_DATA[i].track = 'A' + (i < 10 ? 1 : 5);
      }
      var first = ROUTING_DATA.shift();
      ROUTING_DATA.push(first);
      return true;
    })()`);
    plan = await ev('getTrackPlan()');
    const chans = plan.tracks.map((t) => t.avidChannel);
    check('duplicate channel assignments are preserved',
      chans.filter((c) => c === 1).length > 1 && chans.filter((c) => c === 5).length > 1,
      `1x${chans.filter((c) => c === 1).length} 5x${chans.filter((c) => c === 5).length}`);
    check('timeline order follows the routing list, not the channel',
      plan.tracks[0].order === 0 && plan.tracks[0].channel !== 0,
      `order=${plan.tracks[0].order} channel=${plan.tracks[0].channel}`);
    const orders = plan.tracks.map((t) => t.order);
    check('every track has a distinct timeline position',
      new Set(orders).size === orders.length, String(new Set(orders).size));

    // ---- the indexed naming scheme is honoured ----
    await ev(`(function(){ SETTINGS.mxfNaming = 'indexed'; return true; })()`);
    plan = await ev('getTrackPlan()');
    check('indexed scheme reaches the plan', plan.mxfNaming === 'indexed', plan.mxfNaming);
    await ev(`(function(){ SETTINGS.mxfNaming = 'normalised'; return true; })()`);

    // ---- a preset's template drives the chips ----
    await ev(`(function(){ setTemplateSlotsFromString('BLK_{prefix}_{role}_{num}'); return true; })()`);
    const chipKeys = await ev(`_templateSlots.filter(function(s){return s.key!=='sep';}).map(function(s){return s.key;})`);
    check("a preset's template becomes the chips",
      JSON.stringify(chipKeys) === JSON.stringify(['prefix', 'role', 'num']), JSON.stringify(chipKeys));

    console.log('\n' + results.filter((r) => r.ok).length + '/' + results.length + ' plan checks passed');
    process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
  } finally {
    if (ws) try { ws.close(); } catch (e) {}
    if (electron && electron.pid) {
      try { execFileSync('taskkill', ['/pid', String(electron.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
    }
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  }
}

main();
