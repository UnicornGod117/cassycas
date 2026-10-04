// Downloads the Pyodide-built wheels the exact engine loads (SymPy, mpmath, gmpy2) into
// tests/.wheels, checked against the hashes in the pinned Pyodide lockfile, so the test suite
// can serve them without network access. Run by `npm run test:setup`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ENGINE_PACKAGES } from '../src/sympy/version.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WHEELS = path.join(ROOT, 'tests', '.wheels');
const PYODIDE = path.join(ROOT, 'node_modules', 'pyodide');
const { version } = JSON.parse(fs.readFileSync(path.join(PYODIDE, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(PYODIDE, 'pyodide-lock.json'), 'utf8'));
const base = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

fs.mkdirSync(WHEELS, { recursive: true });
for (const f of fs.readdirSync(WHEELS)) {
  if (!ENGINE_PACKAGES.some(p => lock.packages[p]?.file_name === f)) fs.rmSync(path.join(WHEELS, f));
}
for (const name of ENGINE_PACKAGES) {
  const pkg = lock.packages[name];
  if (!pkg) throw new Error(`${name} is not in the Pyodide ${version} lockfile`);
  const dest = path.join(WHEELS, pkg.file_name);
  const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
  if (fs.existsSync(dest) && sha(fs.readFileSync(dest)) === pkg.sha256) { console.log(`ok       ${pkg.file_name}`); continue; }
  const res = await fetch(base + pkg.file_name);
  if (!res.ok) throw new Error(`${pkg.file_name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== pkg.sha256) throw new Error(`${pkg.file_name}: hash mismatch`);
  fs.writeFileSync(dest, buf);
  console.log(`fetched  ${pkg.file_name} (${(buf.length / 1e6).toFixed(1)} MB)`);
}
