const test = require('node:test');
const assert = require('node:assert');
const {
  parseClipTokens, composeName, deriveNames, DEFAULT_CLIP_PATTERN,
} = require('../lib/naming');

test('parses the real filename shape', () => {
  const t = parseClipTokens('LIAU8_BOOM1_08042026_163205_604', DEFAULT_CLIP_PATTERN);
  assert.strictEqual(t.show, 'LIAU8');
  assert.strictEqual(t.source, 'BOOM1');
  assert.strictEqual(t.day, '08042026');
  assert.strictEqual(t.take, '604');
});

test('a filename that does not match yields empty tokens, not junk', () => {
  assert.deepStrictEqual(parseClipTokens('random name', DEFAULT_CLIP_PATTERN),
    { show: '', day: '', source: '', take: '' });
});

test('a broken pattern degrades quietly', () => {
  assert.deepStrictEqual(parseClipTokens('LIAU8_BOOM1_08042026_163205_604', '('),
    { show: '', day: '', source: '', take: '' });
});

test('composeName skips empty chips and leaves no stray separators', () => {
  const v = { show: 'LIAU8', day: '', source: 'BOOM1', name: 'AMANDA', take: '604' };
  assert.strictEqual(composeName(['show', 'day', 'source', 'name', 'take'], v),
    'LIAU8_BOOM1_AMANDA_604');
});

test('chip order changes the name', () => {
  const v = { show: 'LIAU8', day: '08042026', source: 'BOOM1', name: 'AMANDA', take: '604' };
  assert.strictEqual(composeName(['show', 'day', 'source', 'name', 'take'], v),
    'LIAU8_08042026_BOOM1_AMANDA_604');
  assert.strictEqual(composeName(['show', 'day', 'source', 'take', 'name'], v),
    'LIAU8_08042026_BOOM1_604_AMANDA');
});

test('an all-empty chip set yields an empty string, not separators', () => {
  assert.strictEqual(composeName(['show', 'day'], {}), '');
});

test('deriveNames: file and clip match, track is the name chip', () => {
  const r = deriveNames({
    chips: ['show', 'day', 'source', 'name', 'take'],
    clipTokens: { show: 'LIAU8', day: '08042026', source: 'BOOM1', take: '604' },
    trackName: 'AMANDA',
  });
  assert.strictEqual(r.fileName, 'LIAU8_08042026_BOOM1_AMANDA_604');
  assert.strictEqual(r.clipName, 'LIAU8_08042026_BOOM1_AMANDA_604');
  assert.strictEqual(r.trackName, 'AMANDA');
});

test('spaces in a track name become underscores in the filename only', () => {
  const r = deriveNames({
    chips: ['show', 'name'],
    clipTokens: { show: 'LIAU8' },
    trackName: 'BEACH HUT 3',
  });
  assert.strictEqual(r.fileName, 'LIAU8_BEACH_HUT_3');
  assert.strictEqual(r.trackName, 'BEACH HUT 3');
});

test('characters that break filenames are stripped, not passed through', () => {
  const r = deriveNames({
    chips: ['name'],
    clipTokens: {},
    trackName: 'MIX L/R: main',
  });
  assert.ok(!/[\\/:*?"<>|]/.test(r.fileName), `unsafe filename: ${r.fileName}`);
  assert.strictEqual(r.trackName, 'MIX L/R: main');
});
