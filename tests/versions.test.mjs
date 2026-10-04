// The exact-engine runtime is pinned in three places that must agree: the `pyodide`
// devDependency (whose lockfile supplies package hashes), src/sympy/version.js (what the app
// loads) and public/sw.js (what the service worker caches for offline use).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYODIDE_VERSION, ENGINE_PACKAGES } from '../src/sympy/version.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('Pyodide version is pinned consistently', () => {
  assert.equal(JSON.parse(read('package.json')).devDependencies.pyodide, PYODIDE_VERSION);
  assert.equal(JSON.parse(read('node_modules/pyodide/package.json')).version, PYODIDE_VERSION, 'run npm install');
  const sw = read('public/sw.js');
  assert.ok(sw.includes(`'cassycas-pyodide-v${PYODIDE_VERSION}'`) && sw.includes(`'/pyodide/v${PYODIDE_VERSION}/'`), 'public/sw.js');
});

test('engine packages exist in the lockfile and are pure Python (snapshot-safe)', () => {
  const lock = JSON.parse(read('node_modules/pyodide/pyodide-lock.json'));
  for (const name of ENGINE_PACKAGES) {
    const pkg = lock.packages[name];
    assert.ok(pkg, `${name} is in the Pyodide lockfile`);
    assert.match(pkg.file_name, /-py3-none-any\.whl$/, `${name} must be a pure-Python wheel`);
    for (const dep of pkg.depends) assert.ok(ENGINE_PACKAGES.includes(dep), `${name} depends on ${dep}, which is not loaded`);
  }
});
