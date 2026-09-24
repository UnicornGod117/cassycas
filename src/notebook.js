// Notebook: cells, dependency-graph recomputation, rendering, sliders, click-to-explore,
// persistence, sharing and export.
import { math, normalise, escTex, prettify } from './expr.js';
import { escH, fmtR, toTex } from './format.js';
import { state, scope, userFns, varDefs, CONSTANT_NAMES } from './state.js';
import { dispatch, classifyDef, cellUses, applyDefinition, transformSub } from './engine.js';
import { restoreBaseScope, sanitizeScope, reviveJSON, snapshotScope } from './kernel/mathjs-client.js';
import { renderTex, explorableTex } from './render.js';
import { plotInline, plotSeries, exportPlot, plotSpecInline } from './plot.js';
import { engine, SYMPY_TIMEOUT_MS } from './sympy/client.js';
import { MODES } from './modes.js';

export const cells = [];        // math cells: {id, n, kind:'math', expr, mode, res, error, explore} | text: {id, kind:'text', content}
let cellCounter = 0;
const nb = () => document.getElementById('notebook');
let hooks = { onDefsChanged: () => {}, toast: () => {}, reload: () => {}, categorizeError: (e) => e.message };
export function setNotebookHooks(h) { hooks = { ...hooks, ...h }; }

// ── Evaluation queue (never interleave recomputations) ──
let queue = Promise.resolve();
export function enqueue(task) { const p = queue.then(task, task); queue = p.catch(() => {}); return p; }
export const idle = () => queue;

// ══════════════════════════════════════════════════════
//  CELLS
// ══════════════════════════════════════════════════════
function hideWelcome() { const w = document.getElementById('welcome'); if (w) w.style.display = 'none'; }
export function createMathCell(expr, mode, { after } = {}) {
  hideWelcome();
  const cell = { id: 'c' + (++cellCounter), n: cellCounter, kind: 'math', expr, mode, res: null, error: null };
  const el = document.createElement('div');
  el.className = 'cell'; el.id = cell.id; el.dataset.mode = mode;
  el.innerHTML = `
    <div class="cin">
      <span class="cprompt"><span class="cprompt-num">${cell.n}</span><span class="cprompt-arrow">›</span></span>
      <span class="cexpr" data-action="edit" title="Click to edit in place"></span>
      <span class="cmeta"><span class="cbadge cbadge-engine"></span><span class="cbadge">${escH(mode)}</span></span>
    </div>
    <div class="cout loading"><div class="spin"></div></div>
    <div class="cslider"></div>
    <div class="steps"></div>
    <div class="cell-plot"></div>
    <div class="cacts"></div>`;
  el.querySelector('.cexpr').textContent = expr;
  if (after) { const ref = document.getElementById(after.id); ref.after(el); cells.splice(cells.indexOf(after) + 1, 0, cell); }
  else { nb().appendChild(el); cells.push(cell); }
  el.scrollIntoView({ block: 'nearest' });
  return cell;
}
export function createTextCell(content) {
  hideWelcome();
  const cell = { id: 'c' + (++cellCounter), kind: 'text', content: content || '' };
  const el = document.createElement('div');
  el.className = 'cell text-cell'; el.id = cell.id;
  el.innerHTML = `<textarea class="text-cell-edit" placeholder="Notes, headings, derivations…" rows="2"></textarea><button class="cell-del" data-action="delete" title="Delete note">✕</button>`;
  const ta = el.querySelector('textarea');
  ta.value = cell.content;
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  ta.addEventListener('input', () => { cell.content = ta.value; fit(); persistNotebook(); });
  nb().appendChild(el); cells.push(cell);
  requestAnimationFrame(fit);
  if (content === undefined) ta.focus();
  return cell;
}
const mathCells = () => cells.filter(c => c.kind === 'math');

// Names a cell defines / reads.
function cellDef(cell) { return classifyDef(normalise(cell.expr)); }

async function evaluateCell(cell) {
  const el = document.getElementById(cell.id);
  if (el) { const o = el.querySelector('.cout'); o.className = 'cout loading'; o.innerHTML = '<div class="spin"></div>'; }
  try {
    cell.res = await dispatch(cell.expr, cell.mode);
    cell.error = null;
  } catch (e) {
    cell.res = null;
    cell.error = hooks.categorizeError(e);
  }
  await renderCell(cell);
  return cell.res;
}
// Re-apply a clean cell's definition without recomputing it.
async function applyCached(cell) {
  const r = cell.res;
  if (!r) return;
  if (r.type === 'funcdef') { await applyDefinition({ kind: 'fn', name: r.name, params: r.params, rhs: r.body }); return; }
  if (r.type === 'vardef') {
    delete userFns[r.name];
    if (r.expr !== null && r.expr !== undefined) varDefs[r.name] = r.expr; else delete varDefs[r.name];
    if (r.symbolic) delete scope[r.name]; else scope[r.name] = r.value;
  }
}

// Recompute the notebook in order. Dirty cells (and anything reading a name a dirty cell
// defines) are re-evaluated; clean cells just re-apply their cached definitions.
export function recompute({ ids = [], names = [], all = false } = {}) {
  return enqueue(async () => {
    restoreBaseScope();
    const dirtyNames = new Set(names), dirtyIds = new Set(ids);
    for (const cell of mathCells()) {
      const def = cellDef(cell);
      const uses = cellUses(cell.expr);
      const dirty = all || dirtyIds.has(cell.id) || [...uses].some(n => dirtyNames.has(n));
      if (dirty) {
        await evaluateCell(cell);
        if (def) dirtyNames.add(def.name);
      } else {
        await applyCached(cell);
      }
    }
    persistNotebook();
    hooks.onDefsChanged();
  });
}
// A new cell at the end sees the current workspace; nothing downstream to update.
export function runNewCell(expr, mode) {
  const cell = createMathCell(expr, mode);
  persistNotebook();
  return enqueue(async () => {
    await new Promise(r => setTimeout(r, 0));
    await evaluateCell(cell);
    persistNotebook();
    hooks.onDefsChanged();
    return cell;
  });
}
export function editCell(cell, newExpr) {
  if (newExpr === cell.expr) return idle();
  const oldDef = cellDef(cell);
  cell.expr = newExpr;
  const el = document.getElementById(cell.id);
  el.querySelector('.cexpr').textContent = newExpr;
  persistNotebook();
  return recompute({ ids: [cell.id], names: oldDef ? [oldDef.name] : [] });
}
export function deleteCell(cell) {
  const idx = cells.indexOf(cell);
  if (idx < 0) return idle();
  cells.splice(idx, 1);
  document.getElementById(cell.id)?.remove();
  persistNotebook();
  if (cell.kind !== 'math') return idle();
  const def = cellDef(cell);
  return def ? recompute({ names: [def.name] }) : idle();
}
// Cells that used the fallback engine while SymPy was loading are upgraded once it is ready.
export function upgradePendingCells() {
  const ids = mathCells().filter(c => c.res && c.res.note === 'pending' || (c.error && /will update automatically/.test(c.error))).map(c => c.id);
  if (ids.length) return recompute({ ids });
  return idle();
}
export function clearNotebook() {
  cells.length = 0;
  cellCounter = 0;
  nb().innerHTML = '';
}

// ══════════════════════════════════════════════════════
//  RENDERING
// ══════════════════════════════════════════════════════
const ENGINE_BADGE = { sympy: ['exact', 'Computed by SymPy (exact)'], js: ['numeric', 'Computed by the JavaScript engine'] };
async function renderCell(cell) {
  const el = document.getElementById(cell.id);
  if (!el) return;
  const out = el.querySelector('.cout'), steps = el.querySelector('.steps'), acts = el.querySelector('.cacts');
  const plotEl = el.querySelector('.cell-plot'), sliderEl = el.querySelector('.cslider'), badge = el.querySelector('.cbadge-engine');
  plotEl.innerHTML = ''; plotEl.classList.remove('open'); sliderEl.innerHTML = ''; steps.innerHTML = ''; steps.classList.remove('open');
  cell.explore = null;
  if (cell.error) {
    out.className = 'cout err';
    out.innerHTML = `<div class="cout-prompt">!</div><div class="cout-body err-body"></div>`;
    out.querySelector('.err-body').textContent = cell.error;
    el.dataset.latex = `\\text{Error: ${escTex(cell.error)}}`; el.dataset.plain = 'Error: ' + cell.error;
    badge.textContent = ''; badge.style.display = 'none';
    acts.innerHTML = `<div class="cact-spacer"></div><button class="cact warm" data-action="edit">Edit</button><button class="cact" data-action="delete">Delete</button>`;
    return;
  }
  const res = cell.res;
  let latex, plain, prompt = '⇒';
  if (res.type === 'funcdef') {
    prompt = '≔';
    latex = `${res.name}(${res.params.join(',')}) = ${safeTex(res.body)}`;
    plain = `${res.name}(${res.params.join(',')}) = ${res.body}`;
  } else if (res.type === 'vardef') {
    prompt = '≔';
    const shown = res.shown;
    if (shown && (res.symbolic || state.exactMode)) {
      const irr = shown.approx && !/^-?\d+(\/\d+)?$/.test(shown.plain.replace(/\s/g, ''));
      latex = `${res.name} = ${shown.latex}${irr && !res.symbolic ? ` \\approx ${toTex(res.value)}` : ''}`;
      plain = `${res.name} = ${shown.plain}`;
    } else {
      latex = `${res.name} = ${toTex(res.value)}`;
      plain = `${res.name} = ${fmtR(res.value)}`;
    }
  } else {
    latex = res.out; plain = res.plain ?? res.out;
  }
  out.className = 'cout ok';
  out.innerHTML = `<div class="cout-prompt">${prompt}</div><div class="cout-body"><div class="mjrender"></div></div>`;
  const target = out.querySelector('.mjrender');
  // Explorable output: clickable sub-expressions.
  if (res.expr) {
    try {
      const ex = explorableTex(res.expr);
      cell.explore = ex;
      renderTex(target, (res.prefix || '') + ex.tex + (res.suffix || ''));
      target.classList.add('explorable');
    } catch { renderTex(target, latex); }
  } else renderTex(target, latex);
  if (res.note === 'pending') out.insertAdjacentHTML('beforeend', `<span class="cnote" title="Computed by the fallback engine while SymPy loads; will update automatically">⟳ upgrading</span>`);
  if (res.note === 'timeout') out.insertAdjacentHTML('beforeend', `<span class="cnote" title="SymPy took longer than ${SYMPY_TIMEOUT_MS / 1000} s on this input, so the fallback engine answered">⏱ exact engine timed out</span>`);
  if (res.note === 'numeric') out.insertAdjacentHTML('beforeend', `<span class="cnote" title="No closed form; value computed numerically">≈ numeric</span>`);
  el.dataset.latex = latex; el.dataset.plain = plain;
  const [label, title] = ENGINE_BADGE[res.engine] || ['', ''];
  badge.textContent = label; badge.title = title; badge.style.display = label && res.type !== 'funcdef' ? '' : 'none';
  badge.classList.toggle('exact', res.engine === 'sympy');

  if (res.steps && res.steps.length) {
    steps.innerHTML = res.steps.map((s, i) => `<div class="step"><div class="step-n">${i + 1}</div><div class="step-body"><div class="step-d"></div><div class="step-e"></div></div></div>`).join('');
    steps.querySelectorAll('.step').forEach((node, i) => {
      const s = res.steps[i];
      node.querySelector('.step-d').textContent = s.d;
      const e = node.querySelector('.step-e');
      if (s.tex) renderTex(e, s.tex, false);
      else if (s.e !== undefined && s.e !== null && s.e !== '') { try { math.parse(String(s.e)); renderTex(e, safeTex(String(s.e)), false); } catch { e.textContent = s.e; } }
    });
  }
  // Slider for numeric-literal definitions (a = 2)
  if (res.type === 'vardef' && /^-?\d+(\.\d+)?$/.test(cellDef(cell)?.rhs || '')) renderSlider(cell, sliderEl);

  const plot = plotCandidate(cell);
  const a = [];
  if (res.steps && res.steps.length) a.push(`<button class="cact" data-action="steps">∴ Steps</button>`);
  if (plot) a.push(`<button class="cact violet" data-action="plot">⌇ Plot</button>`);
  if (res.odeData || plot) a.push(`<button class="cact" data-action="export-plot">PNG</button>`);
  a.push(`<div class="cact-spacer"></div>`);
  if (window.CAS_ASSISTANT && window.CAS_ASSISTANT()) a.push(`<button class="cact violet" data-action="explain">✦ Explain</button>`);
  a.push(`<button class="cact" data-action="copy-latex">Copy LaTeX</button>`, `<button class="cact" data-action="copy-plain">Copy Plain</button>`,
    `<button class="cact warm" data-action="edit">Edit</button>`, `<button class="cact" data-action="delete">Delete</button>`);
  acts.innerHTML = a.join('');

  if (res.plotSpec && (res.type === 'plot' || state.autoPlot)) { plotEl.classList.add('open'); plotSpecInline(plotEl, res.plotSpec); }
  else if (res.odeData) { plotEl.classList.add('open'); plotSeries(plotEl, res.odeData.xs, res.odeData.ys, `${res.odeData.yv}(${res.odeData.xv}) — RK4`, res.odeData.xv, res.odeData.yv); }
  else if (plot && state.autoPlot && res.type !== 'val') { plotEl.classList.add('open'); plotInline(plotEl, plot.expr, plot.v, plot.title); }
}
function safeTex(s) { try { return math.parse(s).toTex({ parenthesis: 'auto' }); } catch { return `\\text{${escTex(s)}}`; } }
function plotCandidate(cell) {
  const r = cell.res;
  if (!r) return null;
  if (r.type === 'funcdef' && r.params.length === 1) return { expr: `${r.name}(${r.params[0]})`, v: r.params[0], title: `${r.name}(${r.params[0]})` };
  if (r.type === 'vardef' && r.symbolic && r.expr) {
    try { const fs = require_free(r.expr); if (fs.length === 1) return { expr: r.expr, v: fs[0], title: r.name }; } catch {}
  }
  if (r.plotSpec) return { spec: r.plotSpec };
  if (r.plot) return typeof r.plot === 'string' ? { expr: r.plot, v: 'x' } : r.plot;
  return null;
}
function require_free(expr) {
  const out = new Set();
  math.parse(expr).traverse((n, path, parent) => {
    if (n.isSymbolNode && !(parent && parent.isFunctionNode && path === 'fn') && !CONSTANT_NAMES.includes(n.name) && !(n.name in math) && scope[n.name] === undefined) out.add(n.name);
  });
  return [...out];
}

function renderSlider(cell, host) {
  const def = cellDef(cell);
  const v = parseFloat(def.rhs);
  const span = Math.max(1, Math.abs(v)) * 5;
  const step = Math.pow(10, Math.floor(Math.log10(span / 100)));
  const lo = Math.floor((v - span) / step) * step, hi = Math.ceil((v + span) / step) * step;
  host.innerHTML = `<label class="pslider"><span class="pslider-name"></span>
    <input type="range" min="${lo}" max="${hi}" step="${step}" value="${v}"/><span class="pslider-val"></span></label>`;
  host.querySelector('.pslider-name').textContent = def.name;
  host.querySelector('.pslider-val').textContent = def.rhs;
  const input = host.querySelector('input');
  let latest = null, running = false;
  const pump = async () => {
    if (running || latest === null) return;
    running = true;
    const val = latest; latest = null;
    const text = `${def.name} = ${parseFloat(val.toPrecision(10))}`;
    host.querySelector('.pslider-val').textContent = String(parseFloat(val.toPrecision(10)));
    await editCell(cell, text);
    running = false;
    if (latest !== null) pump();
  };
  input.addEventListener('input', () => { latest = parseFloat(input.value); pump(); });
}

// ══════════════════════════════════════════════════════
//  INTERACTION (delegated)
// ══════════════════════════════════════════════════════
export function findCell(el) { const c = el.closest('.cell'); return c && cells.find(x => x.id === c.id); }
export function startInlineEdit(cell) {
  const el = document.getElementById(cell.id);
  const span = el.querySelector('.cexpr');
  if (span.querySelector('input')) return;
  const input = document.createElement('input');
  input.className = 'cexpr-edit'; input.value = cell.expr; input.spellcheck = false;
  span.textContent = ''; span.appendChild(input);
  input.focus(); input.select();
  let done = false;
  const finish = (commit) => {
    if (done) return; done = true;
    const v = input.value.trim();
    span.textContent = cell.expr;
    if (commit && v && v !== cell.expr) editCell(cell, v);
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
}

const EXPLORE_ACTIONS = [
  ['simplify', 'Simplify'], ['expand', 'Expand'], ['factor', 'Factor'], ['derivative', 'd/dx'],
  ['approx', '≈ Evaluate'], ['copy', 'Copy'], ['substitute', 'Substitute…'],
];
export function openExploreMenu(cell, subIndex, x, y) {
  closeExploreMenu();
  const sub = cell.explore.subs[subIndex];
  const subText = prettify(sub.toString());
  const menu = document.createElement('div');
  menu.className = 'explore-menu'; menu.id = 'explore-menu';
  menu.innerHTML = `<div class="explore-head"></div>` + EXPLORE_ACTIONS.map(([k, l]) => `<button data-k="${k}">${l}</button>`).join('');
  menu.querySelector('.explore-head').textContent = subText.length > 48 ? subText.slice(0, 47) + '…' : subText;
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(y + 8, window.innerHeight - r.height - 8) + 'px';
  menu.addEventListener('click', async (e) => {
    const k = e.target.closest('button')?.dataset.k;
    if (!k) return;
    closeExploreMenu();
    if (k === 'copy') { navigator.clipboard?.writeText(subText).catch(() => {}); hooks.toast('Copied'); return; }
    try {
      let replacement;
      if (k === 'substitute') {
        const answer = prompt('Substitute (e.g.  x = 2):', 'x = ');
        const m = answer && answer.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.+)$/);
        if (!m) return;
        const [, name, value] = m;
        replacement = cell.explore.root.transform(n => n.isSymbolNode && n.name === name ? new math.ParenthesisNode(math.parse(value)) : n).toString();
        await runNewCell(prettify(replacement), 'algebra');
        return;
      }
      const vars = require_free(sub.toString());
      const res = await transformSub(k, sub.toString(), vars[0] || 'x');
      const newRoot = cell.explore.root.transform(n => n === sub ? new math.ParenthesisNode(math.parse(res)) : n);
      await runNewCell(prettify(newRoot.toString()), k === 'approx' ? 'numeric' : 'algebra');
    } catch (err) { hooks.toast(err.message || 'Could not apply'); }
  });
}
export function closeExploreMenu() { document.getElementById('explore-menu')?.remove(); }

export function bindNotebookEvents({ explain }) {
  const root = nb();
  root.addEventListener('click', async (e) => {
    const cell = findCell(e.target);
    if (!cell) return;
    const sub = e.target.closest('[data-p]');
    if (sub && cell.explore && e.target.closest('.explorable')) {
      e.stopPropagation();
      openExploreMenu(cell, parseInt(sub.dataset.p, 10), e.clientX, e.clientY);
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    const el = document.getElementById(cell.id);
    const plotEl = el.querySelector('.cell-plot');
    switch (action) {
      case 'edit': startInlineEdit(cell); break;
      case 'delete': deleteCell(cell); break;
      case 'steps': el.querySelector('.steps').classList.toggle('open'); break;
      case 'plot': {
        const p = plotCandidate(cell);
        if (plotEl.classList.contains('open')) { plotEl.classList.remove('open'); plotEl.innerHTML = ''; }
        else if (p && p.spec) { plotEl.classList.add('open'); plotSpecInline(plotEl, p.spec); }
        else if (p) { plotEl.classList.add('open'); plotInline(plotEl, p.expr, p.v, p.title); }
        break;
      }
      case 'export-plot': exportPlot(plotEl, 'cas-plot-' + cell.n); break;
      case 'copy-latex': copy(el.dataset.latex); break;
      case 'copy-plain': copy(el.dataset.plain); break;
      case 'explain': explain(cell, el); break;
    }
  });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#explore-menu')) closeExploreMenu(); });
}
function copy(t) { navigator.clipboard?.writeText(t || '').catch(() => {}); hooks.toast('Copied'); }

// ══════════════════════════════════════════════════════
//  PERSISTENCE / SHARING / EXPORT
// ══════════════════════════════════════════════════════
const STORE = 'cas-notebook';
export function serializeNotebook() {
  return {
    version: 4,
    exactMode: state.exactMode, angleMode: state.angleMode,
    scope: JSON.parse(JSON.stringify(state.baseScope, math.replacer)),
    cells: cells.map(c => c.kind === 'text' ? { type: 'text', content: c.content } : { type: 'math', expr: c.expr, mode: c.mode }),
  };
}
export function persistNotebook() {
  try { localStorage.setItem(STORE, JSON.stringify(serializeNotebook())); } catch {}
}
export function storedNotebook() {
  try { const s = localStorage.getItem(STORE); return s ? JSON.parse(s) : null; } catch { return null; }
}
// Load a notebook object (from storage, a file or a share link). Untrusted: every field is validated.
export async function loadNotebook(data, { replace = true } = {}) {
  if (!data || typeof data !== 'object') throw new Error('Not a CassyCAS notebook');
  const imported = sanitizeScope(JSON.parse(JSON.stringify(data.scope || {}), reviveJSON));
  const list = Array.isArray(data.cells) ? data.cells.slice(0, 1000) : [];
  await idle();
  if (replace) clearNotebook();
  Object.assign(state.baseScope, imported);
  if (data.exactMode === false || data.exactMode === true) state.exactMode = data.exactMode;
  if (data.angleMode === 'deg' || data.angleMode === 'rad') state.angleMode = data.angleMode;
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    if (c.type === 'text' && typeof c.content === 'string') createTextCell(c.content);
    else if (c.type === 'math' && typeof c.expr === 'string' && c.expr.trim() && c.expr.length < 5000)
      createMathCell(c.expr.trim(), MODES[c.mode] ? c.mode : 'algebra');
  }
  if (!cells.length) { const w = document.getElementById('welcome'); if (w) w.style.display = ''; }
  return recompute({ all: true });
}

// Share links: the notebook is deflate-compressed into the URL fragment (never sent to a server).
async function deflate(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = ''; buf.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function inflate(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const text = await new Response(stream).text();
  if (text.length > 2_000_000) throw new Error('Shared notebook is too large');
  return text;
}
export async function shareLink() {
  const data = serializeNotebook();
  const payload = await deflate(JSON.stringify({ v: 1, e: data.exactMode, a: data.angleMode, c: data.cells.map(c => c.type === 'text' ? ['#', c.content] : [c.mode, c.expr]) }));
  return location.href.split('#')[0] + '#nb=' + payload;
}
export async function notebookFromHash(hash) {
  const m = hash.match(/^#nb=([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const obj = JSON.parse(await inflate(m[1]));
  if (!obj || obj.v !== 1 || !Array.isArray(obj.c)) throw new Error('Unrecognised share link');
  return {
    exactMode: obj.e !== false, angleMode: obj.a === 'deg' ? 'deg' : 'rad', scope: {},
    cells: obj.c.filter(Array.isArray).map(([m, x]) => m === '#' ? { type: 'text', content: String(x) } : { type: 'math', mode: String(m), expr: String(x) }),
  };
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function saveSessionFile() { download('session.cas', JSON.stringify(serializeNotebook(), null, 2), 'application/json'); }
export function exportLatex() {
  const lines = ['\\documentclass{article}', '\\usepackage{amsmath,amssymb}', '\\begin{document}', '\\title{CassyCAS Session}', '\\maketitle'];
  for (const c of cells) {
    if (c.kind === 'text') { if (c.content.trim()) lines.push(escTex(c.content)); continue; }
    const el = document.getElementById(c.id);
    lines.push(`\\begin{verbatim}\nIn: ${c.expr.replace(/\\end\{verbatim\}/g, '')}\n\\end{verbatim}`);
    if (el?.dataset.latex) lines.push(`\\[ ${el.dataset.latex} \\]`);
  }
  lines.push('\\end{document}');
  download('cas-export.tex', lines.join('\n\n'), 'text/plain');
}
export function exportTxt() {
  const lines = cells.map(c => c.kind === 'text' ? '## ' + c.content : `>> ${c.expr}\n   ${document.getElementById(c.id)?.dataset.plain || ''}`);
  download('cas-export.txt', lines.join('\n\n'), 'text/plain');
}
export { snapshotScope };
