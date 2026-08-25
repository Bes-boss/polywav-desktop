#!/usr/bin/env node
/**
 * Cross-shell launcher for the engine build.
 *
 * The previous inline npm script was `cd ../polywav && ./.venv-build/Scripts/
 * python.exe packaging/build_engine.py`. npm runs scripts through cmd.exe on
 * Windows unless script-shell says otherwise, and cmd.exe cannot execute the
 * POSIX-style `./a/b/c.exe` form — it fails with "The system cannot find the
 * path specified." Backslashes fix cmd.exe but then break bash, so no single
 * inline string works in both shells. Node resolves the path itself instead.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// desktop/scripts -> desktop -> <engine root> (the dir holding packaging/ and src/)
const ENGINE_ROOT = path.resolve(__dirname, '..', '..');
const VENV_PY = process.platform === 'win32'
  ? path.join(ENGINE_ROOT, '.venv-build', 'Scripts', 'python.exe')
  : path.join(ENGINE_ROOT, '.venv-build', 'bin', 'python');
const PYTHON = process.env.POLYWAV_BUILD_PYTHON || VENV_PY;
const SCRIPT = path.join(ENGINE_ROOT, 'packaging', 'build_engine.py');

if (!fs.existsSync(PYTHON)) {
  console.error(`Build venv interpreter not found:\n  ${PYTHON}\n`);
  console.error('Create it from the engine root, then retry:');
  console.error(`  cd ${ENGINE_ROOT}`);
  console.error('  uv venv .venv-build --python 3.12');
  console.error('  uv pip install --python .venv-build/Scripts/python.exe -e ".[dev]" pyinstaller\n');
  console.error('Or point POLYWAV_BUILD_PYTHON at an interpreter that has the engine deps.');
  process.exit(1);
}
if (!fs.existsSync(SCRIPT)) {
  console.error(`Engine build script not found: ${SCRIPT}`);
  console.error('Expected the desktop checkout to sit inside the engine repo as <engine root>/desktop.');
  process.exit(1);
}

const r = spawnSync(PYTHON, [SCRIPT], { cwd: ENGINE_ROOT, stdio: 'inherit' });
if (r.error) {
  console.error(`Failed to launch ${PYTHON}: ${r.error.message}`);
  process.exit(1);
}
process.exit(r.status === null ? 1 : r.status);
