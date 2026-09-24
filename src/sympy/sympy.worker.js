// SymPy on Pyodide. Downloads the Python runtime and SymPy from jsDelivr on first use
// (hash-checked by Pyodide; cached by the service worker when the app is hosted).
import bridgeSource from './bridge.py?raw';

export const PYODIDE_INDEX = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
let handle = null;

const post = (m) => self.postMessage(m);
async function boot() {
  try {
    post({ type: 'status', detail: 'Downloading Python runtime…' });
    const { loadPyodide } = await import(/* @vite-ignore */ PYODIDE_INDEX + 'pyodide.mjs');
    const py = await loadPyodide({ indexURL: PYODIDE_INDEX });
    post({ type: 'status', detail: 'Loading SymPy…' });
    await py.loadPackage(['mpmath', 'sympy']);
    py.runPython(bridgeSource);
    handle = py.globals.get('handle');
    post({ type: 'status', detail: 'Warming up…' });
    handle(JSON.stringify({ op: 'integrate', expr: { t: 'fn', n: 'sin', args: [{ t: 'sym', n: 'x' }] }, var: 'x' }));
    post({ type: 'ready' });
  } catch (e) {
    post({ type: 'failed', detail: String(e && e.message || e) });
  }
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
