// Main-thread client for the SymPy worker: lazy start, status events, timeouts with restart.
import SympyWorker from './sympy.worker.js?worker&inline';
import { state } from '../state.js';

export const engine = { status: 'off', detail: '' };   // off | loading | ready | failed | restarting
const listeners = new Set();
let worker = null, msgId = 0;
const pending = new Map();
export const SYMPY_TIMEOUT_MS = 20000;

export class EngineUnavailable extends Error {}
// This input took longer than SYMPY_TIMEOUT_MS; retrying it automatically would time out again.
export class EngineTimeout extends EngineUnavailable {}

function setStatus(status, detail = '') {
  engine.status = status; engine.detail = detail;
  listeners.forEach(cb => { try { cb(engine); } catch {} });
}
export function onEngineStatus(cb) { listeners.add(cb); cb(engine); return () => listeners.delete(cb); }
export const engineReady = () => engine.status === 'ready';

export function startEngine() {
  if (worker || !state.engineEnabled) return;
  setStatus('loading', 'Starting…');
  worker = new SympyWorker();
  worker.onmessage = (e) => {
    const d = e.data;
    if (d.type === 'status') setStatus(engine.status === 'restarting' ? 'restarting' : 'loading', d.detail);
    else if (d.type === 'ready') setStatus('ready');
    else if (d.type === 'failed') { setStatus('failed', d.detail); stopEngine(true); }
    else if (d.id) {
      const p = pending.get(d.id);
      if (p) { pending.delete(d.id); p.resolve(d.response); }
    }
  };
  worker.onerror = (e) => { e.preventDefault(); setStatus('failed', e.message || 'worker error'); stopEngine(true); };
}
export function stopEngine(keepStatus = false) {
  if (worker) worker.terminate();
  worker = null;
  const list = [...pending.values()]; pending.clear();
  list.forEach(p => p.reject(new EngineUnavailable('SymPy engine stopped')));
  if (!keepStatus) setStatus('off');
}

// Run one bridge operation. Rejects with EngineUnavailable when SymPy is not ready (callers
// fall back to the JavaScript engine) and restarts the worker if an operation hangs.
export function sympy(op, payload = {}, timeout = SYMPY_TIMEOUT_MS) {
  if (!engineReady() || !worker) return Promise.reject(new EngineUnavailable('SymPy is not ready'));
  const request = { op, deg: false, ...payload };
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new EngineTimeout('The exact engine timed out'));
      // The interpreter cannot be interrupted: restart it (served from cache, a few seconds).
      if (worker) worker.terminate();
      worker = null;
      setStatus('restarting', 'Restarting after a timeout…');
      const list = [...pending.values()]; pending.clear();
      list.forEach(p => p.reject(new EngineUnavailable('SymPy engine restarting')));
      startEngine();
      setStatus('restarting', 'Restarting after a timeout…');
    }, timeout);
    pending.set(id, {
      resolve: (res) => {
        clearTimeout(timer);
        if (res && res.ok) resolve(res);
        else reject(new Error((res && res.error) || 'SymPy error'));
      },
      reject: (err) => { clearTimeout(timer); reject(err); },
    });
    worker.postMessage({ id, request });
  });
}
