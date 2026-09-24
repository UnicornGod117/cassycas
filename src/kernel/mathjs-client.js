// Main-thread side of the mathjs kernel: evaluation context, worker RPC, workspace persistence.
import EvalWorker from './eval.worker.js?worker&inline';
import { math } from '../expr.js';
import { makeDegFns } from './degree.js';
import { state, scope, userFns, varDefs, CONSTANT_NAMES, IDENT_RE, FORBIDDEN_NAMES } from '../state.js';

export const DEG_FNS = makeDegFns(math);
// Evaluation context: the workspace plus the angle-mode overrides.
export function ctx(extra) {
  return Object.assign({}, scope, state.angleMode === 'deg' ? DEG_FNS : null, extra);
}
export function reviveJSON(key, value) {
  if (value && value.mathjs === 'number') return Number(value.value);
  return math.reviver(key, value);
}

let worker = null, workerBroken = false, msgId = 0;
const pending = new Map();
export const EVAL_TIMEOUT_MS = 10000;

function initWorker() {
  try { worker = new EvalWorker(); } catch { workerBroken = true; return; }
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (p) { pending.delete(e.data.id); p.resolve(e.data); }
  };
  worker.onerror = (e) => {
    e.preventDefault();
    workerBroken = true;
    const list = [...pending.values()]; pending.clear();
    list.forEach(p => p.resolve(evalOnMainThread(p.expr)));
  };
}
function restartWorker(reason) {
  if (worker) worker.terminate();
  const list = [...pending.values()]; pending.clear();
  list.forEach(p => p.reject(new Error(reason)));
  initWorker();
}
function evalOnMainThread(expr) {
  try {
    let res = math.evaluate(expr, ctx());
    if (res && res.isResultSet) res = res.entries[res.entries.length - 1];
    if (typeof res === 'function') throw new Error('Expression evaluates to a function, not a value');
    return { json: JSON.stringify(res === undefined ? null : res, math.replacer) };
  } catch (err) { return { error: err.message }; }
}
function serializeScope() {
  const o = {};
  for (const k in scope) if (typeof scope[k] !== 'function') o[k] = scope[k];
  return JSON.stringify(o, math.replacer);
}
function runInWorker(expr) {
  if (!worker && !workerBroken) initWorker();
  if (workerBroken) return Promise.resolve(evalOnMainThread(expr));
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const timer = setTimeout(() => {
      // A timed-out worker is still busy; terminate it so later evaluations are not queued behind it.
      if (pending.has(id)) restartWorker('Computation timed out — try a simpler expression or smaller bounds.');
    }, EVAL_TIMEOUT_MS);
    pending.set(id, {
      expr,
      resolve: d => { clearTimeout(timer); resolve(d); },
      reject: err => { clearTimeout(timer); reject(err); },
    });
    const fns = {};
    for (const k in userFns) fns[k] = { params: userFns[k].params, body: userFns[k].body };
    worker.postMessage({ id, expr, scopeJSON: serializeScope(), fns, deg: state.angleMode === 'deg' });
  });
}
// Evaluate in the worker and return a live mathjs value (matrices, units, complex… preserved).
export async function workerEval(expr) {
  const r = await runInWorker(expr);
  if (r.error) throw new Error(r.error);
  return JSON.parse(r.json, reviveJSON);
}

// ── Workspace persistence ────────────────────────────
export function sanitizeScope(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const k of Object.keys(obj)) {
    if (!IDENT_RE.test(k) || FORBIDDEN_NAMES.has(k) || CONSTANT_NAMES.includes(k)) continue;
    let v = obj[k];
    if (v && v.isFraction) v = math.number(v);   // sessions saved by older versions
    const ok = v === null || ['number', 'boolean', 'string'].includes(typeof v)
      || (v && (v.isMatrix || v.isUnit || v.isComplex || v.isBigNumber || Array.isArray(v)));
    if (ok) out[k] = v;
  }
  return out;
}
export function snapshotScope() {
  const o = {};
  for (const k of Object.keys(scope)) if (!CONSTANT_NAMES.includes(k) && typeof scope[k] !== 'function') o[k] = scope[k];
  return o;
}
export function restoreBaseScope() {
  for (const k of Object.keys(scope)) if (!CONSTANT_NAMES.includes(k)) delete scope[k];
  Object.assign(scope, state.baseScope);
  for (const k of Object.keys(userFns)) delete userFns[k];
  for (const k of Object.keys(varDefs)) delete varDefs[k];
}
export function persistScope() {
  try { localStorage.setItem('cas2-scope', JSON.stringify(snapshotScope(), math.replacer)); } catch {}
}
export function loadStoredScope() {
  try {
    const s = localStorage.getItem('cas2-scope');
    if (s) Object.assign(scope, sanitizeScope(JSON.parse(s, reviveJSON)));
  } catch {}
  state.baseScope = snapshotScope();
}
