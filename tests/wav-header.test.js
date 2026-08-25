const test = require('node:test');
const assert = require('node:assert');
const { parseWavHeader } = require('../lib/wav-header');

function fmtChunk(channels, sampleRate, bits) {
  const b = Buffer.alloc(8 + 16);
  b.write('fmt ', 0, 'ascii');
  b.writeUInt32LE(16, 4);
  b.writeUInt16LE(1, 8);                                   // PCM
  b.writeUInt16LE(channels, 10);
  b.writeUInt32LE(sampleRate, 12);
  b.writeUInt32LE(sampleRate * channels * (bits / 8), 16);  // byte rate
  b.writeUInt16LE(channels * (bits / 8), 20);               // block align
  b.writeUInt16LE(bits, 22);
  return b;
}

/** Classic RIFF/WAVE, 32-bit sizes. */
function riffWav({ channels = 2, sampleRate = 48000, bits = 24, dataSize = 4800 } = {}) {
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + dataSize, 4);
  head.write('WAVE', 8, 'ascii');
  const data = Buffer.alloc(8);
  data.write('data', 0, 'ascii');
  data.writeUInt32LE(dataSize, 4);
  return Buffer.concat([head, fmtChunk(channels, sampleRate, bits), data, Buffer.alloc(64)]);
}

/** RF64: 'RF64' magic, 0xFFFFFFFF sentinels, real sizes in a ds64 chunk. */
function rf64Wav({ channels = 63, sampleRate = 48000, bits = 24, dataSize = 16487138304 } = {}) {
  const head = Buffer.alloc(12);
  head.write('RF64', 0, 'ascii');
  head.writeUInt32LE(0xFFFFFFFF, 4);
  head.write('WAVE', 8, 'ascii');

  const ds64 = Buffer.alloc(8 + 28);
  ds64.write('ds64', 0, 'ascii');
  ds64.writeUInt32LE(28, 4);
  ds64.writeBigUInt64LE(BigInt(dataSize + 1000), 8);                    // riffSize
  ds64.writeBigUInt64LE(BigInt(dataSize), 16);                          // dataSize
  ds64.writeBigUInt64LE(BigInt(Math.floor(dataSize / (channels * bits / 8))), 24); // sampleCount
  ds64.writeUInt32LE(0, 32);                                            // tableLength

  const data = Buffer.alloc(8);
  data.write('data', 0, 'ascii');
  data.writeUInt32LE(0xFFFFFFFF, 4);                                    // sentinel
  return Buffer.concat([head, ds64, fmtChunk(channels, sampleRate, bits), data, Buffer.alloc(64)]);
}

test('classic RIFF/WAVE header parses', () => {
  const buf = riffWav({ channels: 8, dataSize: 8 * 3 * 4800 });
  const r = parseWavHeader(buf, buf.length);
  assert.strictEqual(r.error, undefined, r.error);
  assert.strictEqual(r.channels, 8);
  assert.strictEqual(r.sampleRate, 48000);
  assert.strictEqual(r.bitsPerSample, 24);
  assert.strictEqual(r.frames, 4800);
});

test('RF64 header parses (real polywavs over 4GB use RF64, not RIFF)', () => {
  const buf = rf64Wav({ channels: 63 });
  const r = parseWavHeader(buf, buf.length);
  assert.strictEqual(r.error, undefined, `RF64 rejected: ${r.error}`);
  assert.strictEqual(r.channels, 63, 'channel count must come from the fmt chunk');
  assert.strictEqual(r.sampleRate, 48000);
  assert.strictEqual(r.bitsPerSample, 24);
});

test('RF64 frame count comes from ds64, not the 0xFFFFFFFF data sentinel', () => {
  const dataSize = 16487138304;            // > 4GB, cannot fit a 32-bit field
  const buf = rf64Wav({ channels: 63, dataSize });
  const r = parseWavHeader(buf, buf.length);
  assert.strictEqual(r.error, undefined, r.error);
  assert.strictEqual(r.frames, Math.floor(dataSize / (63 * 3)));
  assert.ok(r.frames > 4294967295 / (63 * 3), 'frames must not be derived from the sentinel');
});

test('a non-WAV file is still rejected', () => {
  const buf = Buffer.alloc(128);
  buf.write('FORM', 0, 'ascii');
  buf.write('AIFF', 8, 'ascii');
  assert.ok(parseWavHeader(buf, buf.length).error, 'AIFF should be rejected');
});

test('a truncated file is rejected', () => {
  assert.ok(parseWavHeader(Buffer.alloc(20), 20).error);
});
