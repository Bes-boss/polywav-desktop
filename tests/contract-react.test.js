/**
 * Polywav desktop — React shell contract tests (REACT-MIGRATION.md §6: B11.*).
 *
 * Asserts the built React shell (desktop/react/dist) satisfies the parallel
 * shell contract without touching the shipping app:
 *   B11a  bundle exists (dist/index.html + built assets, no inline scripts)
 *   B11b  no remote origins in the shipped bundle (CSP + offline-capable)
 *   B11c  bridge-only privileged access: src never touches ipcRenderer/Node/fs
 *   B11d  fonts are self-hosted inside the bundle
 *   B11e  React index.html carries a CSP with script-src 'self'
 *
 * Run: node tests/contract-react.test.js  (after `npm run build` in react/)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REACT = path.join(ROOT, 'react');

let pass = 0, fail = 0;
const failures = [];

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    failures.push(`${name}: ${e.message}`);
    console.log(`FAIL  ${name}: ${e.message}`);
  }
}

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const distDir = path.join(REACT, 'dist');
const distExists = fs.existsSync(distDir);
const distFiles = distExists ? walk(distDir, []) : [];

test('B11a: react/dist exists with built assets', () => {
  assert(distExists, 'react/dist missing — run `npm run build` in desktop/react');
  const html = distFiles.find((f) => f.endsWith('index.html'));
  assert(html, 'dist/index.html missing');
  const raw = fs.readFileSync(html, 'utf8');
  assert(!/<script[^>]*>/.test(raw.split('<script type="module"')[0]), 'inline <script> present in dist/index.html');
  const jsFiles = distFiles.filter((f) => f.endsWith('.js'));
  assert(jsFiles.length > 0, 'no built .js assets');
  assert(fs.readFileSync(html, 'utf8').includes('index-'), 'html does not reference hashed assets');
});

test('B11b: no remote origins in shipped bundle', () => {
  const remote = [];
  for (const f of distFiles) {
    if (!/\.(js|css|html)$/.test(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    const hits = text.match(/https?:\/\/[^\s"')\]}]+/g) || [];
    for (const h of hits) {
      if (!h.includes('w3.org') && !h.includes('example.com')
        && !h.includes('reactjs.org/docs/error-decoder') && !h.includes('github.com/')) remote.push(`${path.basename(f)}: ${h}`);
    }
  }
  assert(remote.length === 0, `remote origins found: ${remote.slice(0, 3).join(' | ')}`);
});

test('B11c: bridge-only privileged access in src', () => {
  const srcDir = path.join(REACT, 'src');
  const srcFiles = walk(srcDir, []).filter((f) => /\.(ts|tsx)$/.test(f));
  const forbidden = /ipcRenderer|require\(['"]electron|node:fs|from ['"]fs['"]|process\.env|child_process/;
  const hits = [];
  for (const f of srcFiles) {
    const text = fs.readFileSync(f, 'utf8');
    if (forbidden.test(text)) hits.push(path.relative(ROOT, f));
  }
  assert(hits.length === 0, `privileged access in: ${hits.join(', ')}`);
});

test('B11d: fonts self-hosted in bundle', () => {
  const fonts = distFiles.filter((f) => f.endsWith('.woff2'));
  assert(fonts.length >= 2, `expected bundled woff2 fonts, found ${fonts.length}`);
});

test('B11e: React index.html carries CSP script-src self', () => {
  const idx = path.join(REACT, 'index.html');
  const raw = fs.readFileSync(idx, 'utf8');
  assert(/Content-Security-Policy/.test(raw), 'no CSP meta tag');
  assert(/script-src 'self'/.test(raw), "script-src 'self' not present");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);