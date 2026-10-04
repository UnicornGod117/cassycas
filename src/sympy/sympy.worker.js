// SymPy on Pyodide. Downloads the Python runtime and SymPy from jsDelivr on first use
// (wheels checked against the SHA-256 hashes in Pyodide's lockfile; cached by the service
// worker when the app is hosted).
//
// Fast start: after the first boot the worker saves a memory snapshot of the interpreter with
// SymPy imported and warmed up (≈18 MB gzipped, in Cache Storage). Later visits restore it in
// about half a second instead of importing SymPy again (≈5 s). A snapshot is tied to the
// Pyodide version and to the bridge source, and is discarded if restoring it fails.
import bridgeSource from './bridge.py?raw';
import toolsSource from './tools.py?raw';
import stepsSource from './steps.py?raw';
import { PYODIDE_INDEX, PYODIDE_VERSION, ENGINE_PACKAGES } from './version.js';

const SNAPSHOT_CACHE = 'cassycas-engine-snapshot';
let handle = null;

const post = (m) => self.postMessage(m);
const status = (detail) => post({ type: 'status', detail });

async function sha256(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
}
const gzip = (bytes, mode) => new Response(new Blob([bytes]).stream().pipeThrough(mode === 'in' ? new CompressionStream('gzip') : new DecompressionStream('gzip'))).arrayBuffer();

async function snapshotKey() {
  // An absolute key: the worker runs from a blob: URL, against which relative URLs do not resolve.
  return `https://engine.cassycas.invalid/snapshot-${PYODIDE_VERSION}-${(await sha256(new TextEncoder().encode(bridgeSource + toolsSource + stepsSource))).slice(0, 16)}`;
}
async function snapshotCache() {
  try { return self.caches ? await caches.open(SNAPSHOT_CACHE) : null; } catch { return null; }
}

// The snapshot was taken with a larger heap than Pyodide starts with, and its memory size is
// fixed at build time: grow it (from inside wasm, so the views update) before restoring.
function growingFactory(factory, size) {
  return async (settings) => {
    const M = await factory(settings);
    for (let k = 0; k < 256 && M.HEAP8.length < size; k++) M._malloc(8 << 20);
    return M;
  };
}

async function restore(loadPyodide, cache, key) {
  const hit = cache && await cache.match(key);
  if (!hit) return null;
  status('Restoring the saved engine…');
  try {
    const raw = new Uint8Array(await gzip(await hit.arrayBuffer(), 'out'));
    const factory = (await import(/* @vite-ignore */ PYODIDE_INDEX + 'pyodide.asm.mjs')).default;
    const py = await loadPyodide({ indexURL: PYODIDE_INDEX, _loadSnapshot: raw, createPyodideModule: growingFactory(factory, raw.length) });
    const h = py.globals.get('handle');
    JSON.parse(h(JSON.stringify({ op: 'eval', expr: { t: 'num', v: '1' } })));
    return h;
  } catch (e) {
    await cache.delete(key).catch(() => {});
    return null;
  }
}

async function freshBoot(loadPyodide, canSnapshot) {
  status('Downloading Python runtime…');
  const py = await loadPyodide({ indexURL: PYODIDE_INDEX, _makeSnapshot: canSnapshot });
  status('Loading SymPy…');
  // Wheels are unpacked directly (not with loadPackage, which leaves state a snapshot cannot hold).
  const lock = py.lockfile.packages;
  for (const name of ENGINE_PACKAGES) {
    const pkg = lock[name];
    const res = await fetch(PYODIDE_INDEX + pkg.file_name);
    if (!res.ok) throw new Error(`${pkg.file_name}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (await sha256(bytes) !== pkg.sha256) throw new Error(`${pkg.file_name}: integrity check failed`);
    py.FS.writeFile('/tmp/' + pkg.file_name, bytes);
  }
  py.runPython(`
import importlib, os, sys, zipfile
_site = next(p for p in sys.path if p.endswith('site-packages'))
for _f in os.listdir('/tmp'):
    if _f.endswith('.whl'):
        zipfile.ZipFile('/tmp/' + _f).extractall(_site)
        os.remove('/tmp/' + _f)
importlib.invalidate_caches()
`);
  py.runPython(bridgeSource);
  py.runPython(toolsSource);          // same namespace: registers the 'tool' operation
  py.runPython(stepsSource);          // worked solutions (replaces the bridge's simpler step generators)
  status('Warming up…');
  py.runPython(`for _op in ({'op': 'integrate', 'expr': {'t': 'fn', 'n': 'sin', 'args': [{'t': 'sym', 'n': 'x'}]}, 'var': 'x'},
            {'op': 'limit', 'expr': {'t': 'op', 'op': '/', 'args': [{'t': 'fn', 'n': 'sin', 'args': [{'t': 'sym', 'n': 'x'}]}, {'t': 'sym', 'n': 'x'}]}, 'var': 'x', 'point': {'t': 'num', 'v': '0'}},
            {'op': 'solve', 'lhs': {'t': 'op', 'op': '^', 'args': [{'t': 'sym', 'n': 'x'}, {'t': 'num', 'v': '2'}]}, 'rhs': {'t': 'num', 'v': '4'}, 'var': 'x'}):
    handle(json.dumps(_op))`);
  const snapshot = canSnapshot ? py.makeMemorySnapshot() : null;
  return { h: py.globals.get('handle'), snapshot };
}

async function boot() {
  const t0 = performance.now();
  try {
    const { loadPyodide } = await import(/* @vite-ignore */ PYODIDE_INDEX + 'pyodide.mjs');
    const cache = await snapshotCache();
    const key = cache ? await snapshotKey() : null;
    handle = await restore(loadPyodide, cache, key);
    if (handle) { post({ type: 'ready', boot: 'snapshot', ms: Math.round(performance.now() - t0) }); return; }
    const fresh = await freshBoot(loadPyodide, !!cache);
    handle = fresh.h;
    post({ type: 'ready', boot: 'fresh', ms: Math.round(performance.now() - t0) });
    if (fresh.snapshot) saveSnapshot(cache, key, fresh.snapshot);     // in the background
  } catch (e) {
    post({ type: 'failed', detail: String(e && e.message || e) });
  }
}
// Save for next time, replacing snapshots of other versions.
async function saveSnapshot(cache, key, snapshot) {
  try {
    const gz = await gzip(snapshot, 'in');
    for (const req of await cache.keys()) await cache.delete(req);
    await cache.put(key, new Response(gz, { headers: { 'content-type': 'application/octet-stream' } }));
    post({ type: 'snapshot-saved', bytes: gz.byteLength });
  } catch {}
}
const booting = boot();

self.onmessage = async (e) => {
  const { id, request } = e.data;
  await booting;
  if (!handle) { post({ id, response: { ok: false, error: 'SymPy is unavailable' } }); return; }
  let response;
  try { response = JSON.parse(handle(JSON.stringify(request))); }
  catch (err) { response = { ok: false, error: String(err && err.message || err) }; }
  post({ id, response });
};
